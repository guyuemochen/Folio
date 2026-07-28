//! OpenAI chat/completions provider (also covers Ollama and any
//! OpenAI-compatible endpoint by changing `base_url`).
//!
//! Wire format reference (verified against OpenAI docs, 2026):
//!   POST {base_url}/chat/completions
//!   Body: { model, messages, stream: true, stream_options: { include_usage: true }, tools?, tool_choice?, max_tokens, temperature }
//!   Response: SSE stream of `data: {json}\n\n` lines, terminated by `data: [DONE]\n\n`.
//!
//! Chunk shapes we parse:
//!   - text delta: choices[0].delta.content == "..."            → StreamEvent::Delta
//!   - finish:     choices[0].finish_reason == "stop"|"tool_calls"|... → StreamEvent::Finish
//!   - usage-only: choices == [], usage: {...}                  → merge into Finish
//!   - sentinel:   data: [DONE]                                 → flush Finish + end
//!
//! P1 scope: text-only chat. P2 will add tool_calls parsing (delta.tool_calls
//! with index-keyed accumulation).
//!
//! Implementation note — why mpsc + tokio::spawn instead of `stream::unfold`:
//! `unfold`'s worker Future captures the state (which holds a `BoxStream`,
//! itself `Pin<Box<...>>` and thus `Unpin`), but the *generated* async-block
//! Future is `!Unpin`, so `Unfold<State, F, Fut>: Stream` only holds when
//! `Fut: Unpin`. Piping through a channel sidesteps the whole Unpin dance
//! and reads more clearly: one task drains the network, the caller drains
//! the channel.

use async_trait::async_trait;
use futures::channel::mpsc;
use futures::stream::{BoxStream, StreamExt};
use futures::SinkExt;
use serde_json::{json, Value};

use super::provider::{
    Block, ChatMessage, ChatRequest, FinishReason, MessageContent, Provider, ProviderError, Role,
    StreamEvent, ToolChoice, Usage,
};
use super::stream::sse_response;

// =============================================================================
// Provider
// =============================================================================

/// OpenAI-compatible provider. Construct via [`OpenaiProvider::new`] for the
/// real OpenAI API, or [`OpenaiProvider::with_base_url`] for Ollama / custom
/// OpenAI-compatible endpoints (any server that speaks `/v1/chat/completions`).
pub struct OpenaiProvider {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl OpenaiProvider {
    /// Construct for the real OpenAI API. P1 dev uses `OPENAI_BASE_URL` env
    /// override instead (see `agent::load_config`); P3 Settings UI calls
    /// this directly with the user's key.
    #[allow(dead_code)]
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_base_url("https://api.openai.com/v1", api_key)
    }

    /// Build a provider targeting a non-default endpoint. `base_url` should
    /// be the root of the OpenAI-compatible API (e.g.
    /// `http://localhost:11434/v1` for Ollama); `/chat/completions` is
    /// appended internally. Trailing slash is tolerated.
    pub fn with_base_url(base_url: &str, api_key: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.into(),
        }
    }
}

#[async_trait]
impl Provider for OpenaiProvider {
    async fn stream(
        &self,
        req: &ChatRequest,
    ) -> Result<BoxStream<'static, Result<StreamEvent, ProviderError>>, ProviderError> {
        if req.model.is_empty() {
            return Err(ProviderError::Config("model is empty".into()));
        }
        let body = build_request_body(req);
        let url = format!("{}/chat/completions", self.base_url);

        // Eager HTTP send so 4xx/5xx surface as Err before the stream starts.
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(ProviderError::Network)?;

        if !resp.status().is_success() {
            return Err(map_http_error(resp).await);
        }

        // Channel + worker task: worker drains the SSE byte stream, parses
        // each chunk, and pushes StreamEvents into the channel. The caller
        // of `stream()` gets a `BoxStream` (the receiver end) they can poll
        // independently — no lifetime / Unpin entanglement with the worker.
        //
        // tauri::async_runtime is the same tokio runtime Tauri uses for its
        // own commands; no need to add a direct `tokio` dependency.
        let (mut tx, rx) = mpsc::channel::<Result<StreamEvent, ProviderError>>(32);
        tauri::async_runtime::spawn(async move {
            let mut sse = sse_response(resp);
            // pending_finish holds the finish_reason seen in a normal chunk
            // so we can attach usage from the later usage-only chunk to it.
            let mut pending_finish: Option<FinishReason> = None;
            // Tool-call accumulators keyed by `index` (OpenAI's per-tool id
            // within one assistant turn). BTreeMap keeps iteration order
            // stable (ascending index) for ToolCallEnd emission.
            let mut accs: std::collections::BTreeMap<u32, ToolCallAccumulator> =
                std::collections::BTreeMap::new();

            while let Some(ev) = sse.next().await {
                match ev {
                    Err(e) => {
                        let _ = tx.send(Err(e)).await;
                        return;
                    }
                    Ok(event) => {
                        if event.data == "[DONE]" {
                            let reason = pending_finish.take().unwrap_or(FinishReason::Stop);
                            // Flush pending ToolCallEnds before Finish so the
                            // agent loop knows all tool calls are staged.
                            for (_, acc) in accs.iter() {
                                if acc.started {
                                    let _ = tx
                                        .send(Ok(StreamEvent::ToolCallEnd { id: acc.id.clone() }))
                                        .await;
                                }
                            }
                            let _ = tx.send(Ok(StreamEvent::Finish { reason, usage: None })).await;
                            return;
                        }
                        let events = match parse_chunk(&event.data) {
                            Ok(events) => events,
                            Err(e) => {
                                let _ = tx.send(Err(e)).await;
                                return;
                            }
                        };
                        for parsed in events {
                            match parsed {
                                ParsedEvent::Delta(text) => {
                                    if tx.send(Ok(StreamEvent::Delta(text))).await.is_err() {
                                        return; // caller dropped the receiver — cancel
                                    }
                                }
                                ParsedEvent::ToolCallDelta {
                                    index,
                                    id,
                                    name,
                                    arguments_fragment,
                                } => {
                                    let acc = accs
                                        .entry(index)
                                        .or_insert_with(ToolCallAccumulator::new);
                                    if let Some(idv) = id {
                                        acc.id = idv.clone();
                                        if !acc.started {
                                            acc.started = true;
                                            if let Some(n) = name {
                                                acc.name = n;
                                            }
                                            let _ = tx
                                                .send(Ok(StreamEvent::ToolCallStart {
                                                    id: acc.id.clone(),
                                                    name: acc.name.clone(),
                                                }))
                                                .await;
                                        }
                                    }
                                    if !arguments_fragment.is_empty() {
                                        acc.args_buf.push_str(&arguments_fragment);
                                        let _ = tx
                                            .send(Ok(StreamEvent::ToolCallDelta {
                                                id: acc.id.clone(),
                                                partial_json: arguments_fragment,
                                            }))
                                            .await;
                                    }
                                }
                                ParsedEvent::Finish { reason, usage } => {
                                    if let Some(u) = usage {
                                        for (_, acc) in accs.iter() {
                                            if acc.started {
                                                let _ = tx
                                                    .send(Ok(StreamEvent::ToolCallEnd {
                                                        id: acc.id.clone(),
                                                    }))
                                                    .await;
                                            }
                                        }
                                        let _ = tx
                                            .send(Ok(StreamEvent::Finish {
                                                reason,
                                                usage: Some(u),
                                            }))
                                            .await;
                                        return;
                                    }
                                    pending_finish = Some(reason);
                                }
                                ParsedEvent::Usage(u) => {
                                    let reason =
                                        pending_finish.take().unwrap_or(FinishReason::Stop);
                                    for (_, acc) in accs.iter() {
                                        if acc.started {
                                            let _ = tx
                                                .send(Ok(StreamEvent::ToolCallEnd {
                                                    id: acc.id.clone(),
                                                }))
                                                .await;
                                        }
                                    }
                                    let _ = tx
                                        .send(Ok(StreamEvent::Finish {
                                            reason,
                                            usage: Some(u),
                                        }))
                                        .await;
                                    return;
                                }
                            }
                        }
                    }
                }
            }

            // Network drop: stream closed without [DONE]. Emit best-effort
            // Finish (and any pending ToolCallEnds) so the agent loop exits.
            let reason = pending_finish.take().unwrap_or(FinishReason::Stop);
            for (_, acc) in accs.iter() {
                if acc.started {
                    let _ = tx.send(Ok(StreamEvent::ToolCallEnd { id: acc.id.clone() })).await;
                }
            }
            let _ = tx.send(Ok(StreamEvent::Finish { reason, usage: None })).await;
        });

        Ok(rx.boxed())
    }
}

// =============================================================================
// Wire format parsing
// =============================================================================

#[derive(Debug)]
enum ParsedEvent {
    Delta(String),
    /// One delta entry for a tool call. OpenAI sends an array under
    /// `choices[0].delta.tool_calls[]`; the worker expands each entry to
    /// one `ToolCallDelta` (one per array element). The first delta for a
    /// given `index` carries `id` + `name`; subsequent deltas carry only
    /// the `arguments` fragment.
    ToolCallDelta {
        index: u32,
        id: Option<String>,
        name: Option<String>,
        arguments_fragment: String,
    },
    Finish { reason: FinishReason, usage: Option<Usage> },
    Usage(Usage), // usage-only chunk (no choices)
}

/// Per-tool-call accumulator (worker-local). OpenAI streams tool_calls
/// piecewise: the first delta for a given `index` carries `id` + `name`,
/// subsequent deltas carry only the `arguments` JSON fragment. We
/// concatenate fragments into `args_buf` until `finish_reason=tool_calls`
/// (or `[DONE]`) arrives, then the agent loop parses the full JSON.
struct ToolCallAccumulator {
    id: String,
    name: String,
    #[allow(dead_code)]
    args_buf: String,
    started: bool,
}

impl ToolCallAccumulator {
    fn new() -> Self {
        Self { id: String::new(), name: String::new(), args_buf: String::new(), started: false }
    }
}

fn build_request_body(req: &ChatRequest) -> Value {
    let messages: Vec<Value> = req.messages.iter().map(openai_message).collect();

    let mut body = json!({
        "model": req.model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true },
        "max_tokens": req.max_tokens,
        "temperature": req.temperature.unwrap_or(1.0),
    });

    if !req.tools.is_empty() {
        // OpenAI tool envelope: {type: "function", function: {name, description, parameters}}
        let tools: Vec<Value> = req
            .tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect();
        body["tools"] = json!(tools);
        body["tool_choice"] = match req.tool_choice {
            ToolChoice::Auto => json!("auto"),
            ToolChoice::Required => json!("required"),
            ToolChoice::None => json!("none"),
        };
    }

    body
}

/// Translate a provider-agnostic `ChatMessage` to OpenAI's wire format.
///
/// OpenAI quirks vs. our internal model:
///   - `Role::Tool` becomes `{role:"tool", tool_call_id, content}` (not role
///     string "tool" with regular content).
///   - Assistant turns with tool_use blocks must serialize as
///     `{role:"assistant", content: text|null, tool_calls: [...]}` where
///     `arguments` is a JSON **string** (not an object).
///   - Tool_use blocks share a single assistant message; multiple tool_use
///     in one turn become one tool_calls array.
fn openai_message(m: &ChatMessage) -> Value {
    match (&m.role, &m.content) {
        // Tool result: special envelope. We expect exactly one ToolResult block.
        (Role::Tool, MessageContent::Blocks(blocks)) => {
            let tr = blocks.iter().find_map(|b| match b {
                Block::ToolResult { tool_use_id, content, .. } => Some((tool_use_id, content)),
                _ => None,
            });
            match tr {
                Some((id, content)) => json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": content,
                }),
                // Malformed — emit an empty tool result so the model can recover.
                None => json!({ "role": "tool", "content": "" }),
            }
        }
        // Assistant turn with tool_use blocks: emit tool_calls array.
        (Role::Assistant, MessageContent::Blocks(blocks)) => {
            let text_parts: Vec<&str> = blocks.iter().filter_map(|b| match b {
                Block::Text(t) => Some(t.as_str()),
                _ => None,
            }).collect();
            let tool_calls: Vec<Value> = blocks.iter().filter_map(|b| match b {
                Block::ToolUse { id, name, input } => Some(json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": serde_json::to_string(input).unwrap_or_else(|_| "{}".into()),
                    }
                })),
                _ => None,
            }).collect();

            let mut obj = serde_json::Map::new();
            obj.insert("role".into(), json!("assistant"));
            // OpenAI requires content or tool_calls; null content is fine if tool_calls present.
            if text_parts.is_empty() && !tool_calls.is_empty() {
                obj.insert("content".into(), Value::Null);
            } else {
                obj.insert("content".into(), Value::String(text_parts.join("\n")));
            }
            if !tool_calls.is_empty() {
                obj.insert("tool_calls".into(), Value::Array(tool_calls));
            }
            Value::Object(obj)
        }
        // Simple text message (system / user / assistant_text).
        (_, MessageContent::Text(t)) => json!({
            "role": role_str(m.role),
            "content": t,
        }),
        // Edge: user/assistant with Blocks but no special handling (rare in
        // practice — fallback to joined text).
        _ => {
            let text = match &m.content {
                MessageContent::Blocks(blocks) => blocks.iter().filter_map(|b| match b {
                    Block::Text(t) => Some(t.clone()),
                    _ => None,
                }).collect::<Vec<_>>().join("\n"),
                MessageContent::Text(t) => t.clone(),
            };
            json!({ "role": role_str(m.role), "content": text })
        }
    }
}

fn role_str(r: Role) -> &'static str {
    match r {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        // Reached only via the fallback arm above; OpenAI Tool messages use
        // the special envelope, not a "tool" role string.
        Role::Tool => "tool",
    }
}

/// Parse one `data: {json}` line into a vec of `ParsedEvent`s (text delta,
/// tool_call deltas, finish). Empty vec = nothing notable in this chunk
/// (keep-alive). Kept as a free function so unit tests can drive it without
/// spinning up an HTTP server or a tokio task.
fn parse_chunk(data: &str) -> Result<Vec<ParsedEvent>, ProviderError> {
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => return Err(ProviderError::Stream(format!("parse chunk JSON: {e} (data: {data:?})"))),
    };

    let mut out = Vec::new();

    // Usage-only chunk: choices is empty (or missing) and usage is populated.
    // OpenAI sends this as the very last data event before [DONE].
    let choices_empty = v
        .get("choices")
        .and_then(|c| c.as_array())
        .map(|a| a.is_empty())
        .unwrap_or(true);
    if choices_empty {
        if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
            out.push(ParsedEvent::Usage(parse_usage(u)));
        }
        return Ok(out);
    }

    let choice = match v.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()) {
        Some(c) => c,
        None => return Ok(out),
    };

    // finish_reason present → emit Finish (no usage here; usage comes separately).
    if let Some(reason_str) = choice.get("finish_reason").and_then(|r| r.as_str()) {
        let reason = match reason_str {
            "stop" => FinishReason::Stop,
            "tool_calls" | "function_call" => FinishReason::Tools,
            "length" => FinishReason::Length,
            "content_filter" => FinishReason::ContentFilter,
            other => FinishReason::Other(other.to_string()),
        };
        out.push(ParsedEvent::Finish { reason, usage: None });
        return Ok(out);
    }

    // Text delta.
    if let Some(content) = choice
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
    {
        if !content.is_empty() {
            out.push(ParsedEvent::Delta(content.to_string()));
        }
    }

    // Tool calls (one or more per chunk).
    if let Some(tcs) = choice
        .get("delta")
        .and_then(|d| d.get("tool_calls"))
        .and_then(|t| t.as_array())
    {
        for tc in tcs {
            let index = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
            let id = tc.get("id").and_then(|x| x.as_str()).map(String::from);
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .map(String::from);
            let args_fragment = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("")
                .to_string();
            // Skip pure-noop deltas (no id, no name, empty args) — OpenAI
            // sometimes sends these as keepalives mid-tool-call.
            if id.is_none() && name.is_none() && args_fragment.is_empty() {
                continue;
            }
            out.push(ParsedEvent::ToolCallDelta {
                index,
                id,
                name,
                arguments_fragment: args_fragment,
            });
        }
    }

    Ok(out)
}

fn parse_usage(u: &Value) -> Usage {
    Usage {
        input_tokens: u.get("prompt_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
        output_tokens: u.get("completion_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
    }
}

async fn map_http_error(resp: reqwest::Response) -> ProviderError {
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    match status {
        401 | 403 => ProviderError::Auth { status, body },
        429 => ProviderError::RateLimited { body },
        _ => ProviderError::Api { status, body },
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: a successful parse returns exactly one event of a given shape.
    fn one(events: Vec<ParsedEvent>) -> Option<ParsedEvent> {
        if events.len() == 1 {
            events.into_iter().next()
        } else {
            None
        }
    }

    #[test]
    fn parses_text_delta() {
        let events = parse_chunk(r#"{"choices":[{"delta":{"content":"Hello"}}]}"#).unwrap();
        assert!(matches!(
            one(events),
            Some(ParsedEvent::Delta(ref t)) if t == "Hello"
        ));
    }

    #[test]
    fn skips_empty_delta() {
        // OpenAI sometimes sends chunks with empty delta.content (keep-alive).
        let events = parse_chunk(r#"{"choices":[{"delta":{"content":""}}]}"#).unwrap();
        assert!(events.is_empty());

        let events2 = parse_chunk(r#"{"choices":[{"delta":{}}]}"#).unwrap();
        assert!(events2.is_empty());
    }

    #[test]
    fn parses_finish_reason_stop() {
        let events = parse_chunk(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#).unwrap();
        assert!(matches!(
            one(events),
            Some(ParsedEvent::Finish { reason: FinishReason::Stop, usage: None })
        ));
    }

    #[test]
    fn parses_finish_reason_tool_calls() {
        let events =
            parse_chunk(r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#).unwrap();
        assert!(matches!(
            one(events),
            Some(ParsedEvent::Finish { reason: FinishReason::Tools, usage: None })
        ));
    }

    #[test]
    fn parses_finish_reason_unknown() {
        let events =
            parse_chunk(r#"{"choices":[{"delta":{},"finish_reason":"something_new"}]}"#).unwrap();
        assert!(matches!(
            one(events),
            Some(ParsedEvent::Finish { reason: FinishReason::Other(ref s), .. }) if s == "something_new"
        ));
    }

    #[test]
    fn parses_usage_only_chunk() {
        let data = r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}"#;
        let events = parse_chunk(data).unwrap();
        match one(events) {
            Some(ParsedEvent::Usage(u)) => {
                assert_eq!(u.input_tokens, 10);
                assert_eq!(u.output_tokens, 2);
            }
            other => panic!("expected Usage, got {:?}", other),
        }
    }

    #[test]
    fn handles_empty_choices_without_usage() {
        // Heartbeat-style chunk with no choices and no usage — empty vec.
        let events = parse_chunk(r#"{"choices":[]}"#).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn rejects_malformed_json() {
        let err = parse_chunk("not json").unwrap_err();
        assert!(matches!(err, ProviderError::Stream(_)));
    }

    // ----- Tool-call parsing (P2) ------------------------------------------

    #[test]
    fn parses_tool_call_start_delta() {
        // First chunk for a tool call: index + id + name, empty arguments.
        let data = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"list_pages","arguments":""}}]}}]}"#;
        let events = parse_chunk(data).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            ParsedEvent::ToolCallDelta {
                index,
                id,
                name,
                arguments_fragment,
            } => {
                assert_eq!(*index, 0);
                assert_eq!(id.as_deref(), Some("call_abc"));
                assert_eq!(name.as_deref(), Some("list_pages"));
                assert!(arguments_fragment.is_empty());
            }
            other => panic!("expected ToolCallDelta, got {:?}", other),
        }
    }

    #[test]
    fn parses_tool_call_arguments_fragment() {
        // Subsequent chunk: only index + arguments fragment (no id/name).
        let data = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"par"}}]}}]}"#;
        let events = parse_chunk(data).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            ParsedEvent::ToolCallDelta {
                index, id, name, arguments_fragment, ..
            } => {
                assert_eq!(*index, 0);
                assert!(id.is_none());
                assert!(name.is_none());
                assert_eq!(arguments_fragment, "{\"par");
            }
            other => panic!("expected ToolCallDelta, got {:?}", other),
        }
    }

    #[test]
    fn parses_multiple_tool_calls_in_one_chunk() {
        // Assistant emits two parallel tool calls in one delta.
        let data = r#"{"choices":[{"delta":{"tool_calls":[
            {"index":0,"id":"call_a","type":"function","function":{"name":"list_pages","arguments":""}},
            {"index":1,"id":"call_b","type":"function","function":{"name":"get_page","arguments":""}}
        ]}}]}"#;
        let events = parse_chunk(data).unwrap();
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], ParsedEvent::ToolCallDelta { index: 0, id, name, .. } if id.as_deref() == Some("call_a") && name.as_deref() == Some("list_pages")));
        assert!(matches!(&events[1], ParsedEvent::ToolCallDelta { index: 1, id, name, .. } if id.as_deref() == Some("call_b") && name.as_deref() == Some("get_page")));
    }
}
