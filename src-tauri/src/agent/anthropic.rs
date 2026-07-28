//! Anthropic Messages API provider.
//!
//! Wire format reference (verified against Anthropic docs, 2026):
//!   POST {base_url}/v1/messages
//!   Headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
//!   Body:   { model, max_tokens, system, messages, stream: true, tools?, tool_choice? }
//!   Response: SSE stream of NAMED events — each frame is
//!            `event: <type>\ndata: <json>\n\n`.
//!
//! Unlike OpenAI's `data:`-only stream, every Anthropic event carries an
//! explicit `event:` line. We dispatch on `event.event` (from
//! `eventsource_stream::Event`) and parse each named type:
//!
//!   - `message_start`        → input_tokens (in `message.usage`)
//!   - `content_block_start`  + `content_block.type == "tool_use"`
//!                               → ToolCallStart { id, name }
//!   - `content_block_delta`  + `delta.type == "text_delta`
//!                               → Delta(delta.text)
//!   - `content_block_delta`  + `delta.type == "thinking_delta"`
//!                               → ThoughtDelta(delta.thinking)
//!   - `content_block_delta`  + `delta.type == "input_json_delta"`
//!                               → ToolCallDelta { id, partial_json }
//!   - `content_block_stop`   → ToolCallEnd { id } (if block was tool_use)
//!   - `message_delta`        → stop_reason + output_tokens
//!   - `message_stop`         → Finish { reason, usage }
//!   - `ping`                 → ignored (long-running-stream heartbeat)
//!
//! Tool-use accumulation: Anthropic streams `input_json_delta.partial_json`
//! fragments that aren't valid JSON alone (e.g. `{"location":"San` then
//! ` Francisco"}`). We key accumulators by the content_block `index` (same
//! value flows through `content_block_start` / `_delta` / `_stop` for one
//! block); the agent loop parses the joined string after `ToolCallEnd`.
//!
//! Implementation pattern mirrors `openai.rs`: mpsc channel + tauri's
//! runtime spawn (no direct tokio dependency), `sse_response()` to decode
//! the SSE byte stream, eager HTTP send so 4xx/5xx surface before the
//! first event.

use async_trait::async_trait;
use futures::channel::mpsc;
use futures::stream::{BoxStream, StreamExt};
use futures::SinkExt;
use serde_json::{json, Value};

use super::provider::{
    Block, ChatMessage, ChatRequest, FinishReason, MessageContent, Provider, ProviderError, Role,
    StreamEvent, ToolChoice, ToolSchema, Usage,
};
use super::stream::sse_response;

// =============================================================================
// Provider
// =============================================================================

/// Anthropic Messages API provider. Construct via [`AnthropicProvider::new`]
/// for the real Anthropic API, or [`AnthropicProvider::with_base_url`] for a
/// custom endpoint (rare — Anthropic doesn't have an official OpenAI-compat
/// shim like Ollama; mostly useful for self-hosted Anthropic-compatible
/// proxies).
pub struct AnthropicProvider {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl AnthropicProvider {
    /// Construct for the real Anthropic API. P3 Settings UI calls this with
    /// the user's key.
    #[allow(dead_code)]
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_base_url("https://api.anthropic.com", api_key)
    }

    /// Build a provider targeting a non-default endpoint. `base_url` should
    /// be the API root (e.g. `https://api.anthropic.com`); `/v1/messages` is
    /// appended internally. Trailing slash tolerated.
    pub fn with_base_url(base_url: &str, api_key: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.into(),
        }
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    async fn stream(
        &self,
        req: &ChatRequest,
    ) -> Result<BoxStream<'static, Result<StreamEvent, ProviderError>>, ProviderError> {
        if req.model.is_empty() {
            return Err(ProviderError::Config("model is empty".into()));
        }
        let body = build_request_body(req);
        let url = format!("{}/v1/messages", self.base_url);

        // Eager HTTP send so 4xx/5xx surface as Err before the stream starts.
        // Anthropic uses `x-api-key` (not bearer_auth) + a pinned
        // `anthropic-version` header.
        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(ProviderError::Network)?;

        if !resp.status().is_success() {
            return Err(map_http_error(resp).await);
        }

        // Channel + worker task: worker drains the SSE byte stream, dispatches
        // on each named event, and pushes StreamEvents into the channel.
        // Caller gets a `BoxStream` (receiver end) to poll independently — no
        // lifetime / Unpin entanglement. Same shape as `openai.rs`.
        let (mut tx, rx) = mpsc::channel::<Result<StreamEvent, ProviderError>>(32);
        tauri::async_runtime::spawn(async move {
            let mut sse = sse_response(resp);

            // Per-message state accumulated across events.
            let mut input_tokens: u64 = 0;
            let mut output_tokens: u64 = 0;
            let mut pending_finish: Option<FinishReason> = None;
            // Tool-call accumulators keyed by Anthropic's content_block
            // `index`. BTreeMap keeps iteration order stable for the
            // end-of-stream flush.
            let mut accs: std::collections::BTreeMap<u32, ToolCallAccumulator> =
                std::collections::BTreeMap::new();

            while let Some(ev) = sse.next().await {
                match ev {
                    Err(e) => {
                        let _ = tx.send(Err(e)).await;
                        return;
                    }
                    Ok(event) => {
                        let parsed = match parse_event(&event.event, &event.data) {
                            Ok(es) => es,
                            Err(e) => {
                                let _ = tx.send(Err(e)).await;
                                return;
                            }
                        };
                        for p in parsed {
                            match p {
                                ParsedEvent::Delta(text) => {
                                    if tx.send(Ok(StreamEvent::Delta(text))).await.is_err() {
                                        return; // caller dropped the receiver — cancel
                                    }
                                }
                                ParsedEvent::ThoughtDelta(text) => {
                                    if tx.send(Ok(StreamEvent::ThoughtDelta(text))).await.is_err() {
                                        return;
                                    }
                                }
                                ParsedEvent::ToolCallStart { index, id, name } => {
                                    accs.insert(
                                        index,
                                        ToolCallAccumulator {
                                            id: id.clone(),
                                            name: name.clone(),
                                            args_buf: String::new(),
                                            ended: false,
                                        },
                                    );
                                    let _ = tx
                                        .send(Ok(StreamEvent::ToolCallStart { id, name }))
                                        .await;
                                }
                                ParsedEvent::ToolCallDelta { index, partial_json } => {
                                    // Look up the accumulator created by an
                                    // earlier content_block_start; concatenate
                                    // the fragment so the joined string is
                                    // available for debugging / future surfacing.
                                    if let Some(acc) = accs.get_mut(&index) {
                                        acc.args_buf.push_str(&partial_json);
                                        let _ = tx
                                            .send(Ok(StreamEvent::ToolCallDelta {
                                                id: acc.id.clone(),
                                                partial_json,
                                            }))
                                            .await;
                                    }
                                    // No accumulator at this index — malformed
                                    // stream; drop silently (ToolCallStart
                                    // should always precede ToolCallDelta).
                                }
                                ParsedEvent::ToolCallEnd { index } => {
                                    if let Some(acc) = accs.get_mut(&index) {
                                        if !acc.ended {
                                            acc.ended = true;
                                            let _ = tx
                                                .send(Ok(StreamEvent::ToolCallEnd {
                                                    id: acc.id.clone(),
                                                }))
                                                .await;
                                        }
                                    }
                                    // Text blocks also fire content_block_stop;
                                    // we ignore those (no accumulator present).
                                }
                                ParsedEvent::InputUsage(inp) => {
                                    input_tokens = inp;
                                }
                                ParsedEvent::OutputUsage(out) => {
                                    output_tokens = out;
                                }
                                ParsedEvent::StopReason { reason, output_tokens: out } => {
                                    pending_finish = Some(reason);
                                    if let Some(o) = out {
                                        output_tokens = o;
                                    }
                                }
                                ParsedEvent::End => {
                                    // message_stop — flush any un-ended tool_use
                                    // blocks (defensive; content_block_stop
                                    // should have fired for each already).
                                    for (_, acc) in accs.iter() {
                                        if !acc.ended {
                                            let _ = tx
                                                .send(Ok(StreamEvent::ToolCallEnd {
                                                    id: acc.id.clone(),
                                                }))
                                                .await;
                                        }
                                    }
                                    let _ = tx
                                        .send(Ok(StreamEvent::Finish {
                                            reason: pending_finish
                                                .take()
                                                .unwrap_or(FinishReason::Stop),
                                            usage: Some(Usage { input_tokens, output_tokens }),
                                        }))
                                        .await;
                                    return;
                                }
                                ParsedEvent::Noop => {}
                            }
                        }
                    }
                }
            }

            // Network drop without `message_stop` — emit best-effort Finish
            // (and any pending ToolCallEnds) so the agent loop exits cleanly.
            for (_, acc) in accs.iter() {
                if !acc.ended {
                    let _ = tx.send(Ok(StreamEvent::ToolCallEnd { id: acc.id.clone() })).await;
                }
            }
            let _ = tx
                .send(Ok(StreamEvent::Finish {
                    reason: pending_finish.take().unwrap_or(FinishReason::Stop),
                    usage: Some(Usage { input_tokens, output_tokens }),
                }))
                .await;
        });

        Ok(rx.boxed())
    }
}

// =============================================================================
// Wire format parsing
// =============================================================================

/// One parsed Anthropic SSE event, pre-dispatch. The worker loop matches on
/// these to emit `StreamEvent`s into the channel. Kept distinct from
/// `StreamEvent` because some events only update message-level state
/// (`InputUsage`, `OutputUsage`, `StopReason`, `End`) without directly
/// producing a `StreamEvent` emission.
#[derive(Debug)]
#[allow(dead_code)]
enum ParsedEvent {
    Delta(String),
    ThoughtDelta(String),
    /// First chunk of a tool_use block (from `content_block_start` with
    /// `content_block.type == "tool_use"`). Carries Anthropic's block
    /// `index` (for accumulator lookup) + the tool call id + name.
    ToolCallStart { index: u32, id: String, name: String },
    /// `input_json_delta` fragment for a tool_use block. Concatenate
    /// `partial_json` across deltas with the same `index`; the joined JSON
    /// is only parseable after `ToolCallEnd`.
    ToolCallDelta { index: u32, partial_json: String },
    /// `content_block_stop` for a block. The worker decides whether this is
    /// a tool_use block (i.e. an accumulator exists at this index).
    ToolCallEnd { index: u32 },
    /// `message_start` → `message.usage.input_tokens` (input prompt size).
    InputUsage(u64),
    /// `message_delta.usage.output_tokens` without a stop_reason (rare).
    OutputUsage(u64),
    /// `message_delta.delta.stop_reason` (+ optional `usage.output_tokens`).
    StopReason { reason: FinishReason, output_tokens: Option<u64> },
    /// `message_stop` — flush Finish to the caller.
    End,
    /// Heartbeat (`ping`) or unknown event — ignored.
    Noop,
}

/// Per-tool-call accumulator (worker-local). Anthropic streams tool_use
/// piecewise: `content_block_start` carries the call id + name, then a run
/// of `input_json_delta` events carry `partial_json` fragments, then
/// `content_block_stop` closes the block. We concatenate fragments into
/// `args_buf` until `content_block_stop` (or stream end) arrives; the agent
/// loop then parses the full JSON.
struct ToolCallAccumulator {
    id: String,
    #[allow(dead_code)]
    name: String,
    /// Concatenated `partial_json` fragments. Not currently surfaced via
    /// `StreamEvent` (the agent loop concatenates `ToolCallDelta.partial_json`
    /// itself); kept here for completeness and future debugging.
    #[allow(dead_code)]
    args_buf: String,
    ended: bool,
}

fn build_request_body(req: &ChatRequest) -> Value {
    // Anthropic expects system messages at the top-level `system` field, NOT
    // in `messages`. Concatenate all role=system entries (rarely more than one).
    let system_prompt: String = req
        .messages
        .iter()
        .filter_map(|m| match (&m.role, &m.content) {
            (Role::System, MessageContent::Text(t)) => Some(t.clone()),
            (Role::System, MessageContent::Blocks(blocks)) => Some(
                blocks
                    .iter()
                    .filter_map(|b| match b {
                        Block::Text(t) => Some(t.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let messages: Vec<Value> = req
        .messages
        .iter()
        .filter(|m| m.role != Role::System)
        .map(anthropic_message)
        .collect();

    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "stream": true,
        "messages": messages,
    });

    if !system_prompt.is_empty() {
        body["system"] = json!(system_prompt);
    }

    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }

    if !req.tools.is_empty() {
        // Anthropic tool envelope: {name, description, input_schema} (no
        // `function` wrapper like OpenAI).
        let tools: Vec<Value> = req
            .tools
            .iter()
            .map(|t: &ToolSchema| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                })
            })
            .collect();
        body["tools"] = json!(tools);
        // Anthropic tool_choice types: {auto, any, tool}. We have no `tool`
        // (specific-tool) variant in ToolChoice; map auto/any and treat
        // None as auto (Anthropic has no "none" — they expect tools omitted).
        body["tool_choice"] = match req.tool_choice {
            ToolChoice::Auto => json!({"type": "auto"}),
            ToolChoice::Required => json!({"type": "any"}),
            ToolChoice::None => json!({"type": "auto"}),
        };
    }

    body
}

/// Translate a provider-agnostic `ChatMessage` to Anthropic's wire format.
///
/// Anthropic quirks vs. our internal model:
///   - System messages are extracted out into the top-level `system` field
///     (handled in `build_request_body`); they never appear in `messages`.
///   - `Role::Tool` (tool results) become `role: "user"` with a `tool_result`
///     content block — Anthropic has no separate tool role.
///   - Assistant turns serialize as `role: "assistant"` with a `content`
///     array of `{type:"text", text}` / `{type:"tool_use", id, name, input}`
///     blocks. Unlike OpenAI, `tool_use.input` is a JSON **object**, not a
///     string.
fn anthropic_message(m: &ChatMessage) -> Value {
    match (&m.role, &m.content) {
        // Tool result: rewrite as role=user with a tool_result content block.
        (Role::Tool, MessageContent::Blocks(blocks)) => {
            let content: Vec<Value> = blocks
                .iter()
                .filter_map(|b| match b {
                    Block::ToolResult { tool_use_id, content, is_error } => Some(json!({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": content,
                        "is_error": is_error,
                    })),
                    _ => None,
                })
                .collect();
            json!({ "role": "user", "content": content })
        }
        // Assistant turn with mixed content (text + tool_use blocks).
        (Role::Assistant, MessageContent::Blocks(blocks)) => {
            let content: Vec<Value> = blocks
                .iter()
                .map(|b| match b {
                    Block::Text(t) => json!({ "type": "text", "text": t }),
                    Block::ToolUse { id, name, input } => json!({
                        "type": "tool_use",
                        "id": id,
                        "name": name,
                        "input": input,
                    }),
                    // ToolResult doesn't belong in an assistant turn; emit
                    // empty text so the array stays well-formed (shouldn't
                    // happen in practice).
                    Block::ToolResult { .. } => json!({ "type": "text", "text": "" }),
                })
                .collect();
            json!({ "role": "assistant", "content": content })
        }
        // Simple text user / assistant message.
        (Role::User, MessageContent::Text(t)) => json!({ "role": "user", "content": t }),
        (Role::Assistant, MessageContent::Text(t)) => {
            json!({ "role": "assistant", "content": t })
        }
        // Fallback (system already filtered; rare paths only).
        _ => {
            let text = match &m.content {
                MessageContent::Blocks(blocks) => blocks
                    .iter()
                    .filter_map(|b| match b {
                        Block::Text(t) => Some(t.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                MessageContent::Text(t) => t.clone(),
            };
            json!({ "role": "user", "content": text })
        }
    }
}

/// Parse one Anthropic SSE event into zero or more `ParsedEvent`s. Kept as a
/// free function so unit tests can drive it directly without constructing
/// `eventsource_stream::Event` structs or spinning up an HTTP server.
///
/// `event_type` is the value of the SSE `event:` line (e.g. `message_start`,
/// `content_block_delta`); `data` is the raw JSON payload from the `data:`
/// line. Empty `data` (some heartbeat frames) returns an empty vec.
fn parse_event(event_type: &str, data: &str) -> Result<Vec<ParsedEvent>, ProviderError> {
    // Some heartbeats arrive with empty data — nothing to do.
    if data.trim().is_empty() {
        return Ok(Vec::new());
    }

    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            return Err(ProviderError::Stream(format!(
                "parse event JSON: {e} (event: {event_type:?}, data: {data:?})"
            )))
        }
    };

    let mut out = Vec::new();

    match event_type {
        "message_start" => {
            // Shape: { message: { id, model, usage: { input_tokens, output_tokens } } }
            if let Some(inp) = v
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get("input_tokens"))
                .and_then(|t| t.as_u64())
            {
                out.push(ParsedEvent::InputUsage(inp));
            }
        }
        "content_block_start" => {
            // Shape: { index, content_block: { type, ... } }
            let index = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
            if let Some(cb) = v.get("content_block") {
                let cb_type = cb.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if cb_type == "tool_use" {
                    let id = cb.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                    let name = cb.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    out.push(ParsedEvent::ToolCallStart { index, id, name });
                }
                // text blocks don't need a Start event — deltas follow.
            }
        }
        "content_block_delta" => {
            // Shape: { index, delta: { type, text? | partial_json? | thinking? } }
            let index = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
            if let Some(d) = v.get("delta") {
                let d_type = d.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match d_type {
                    "text_delta" => {
                        if let Some(text) = d.get("text").and_then(|t| t.as_str()) {
                            if !text.is_empty() {
                                out.push(ParsedEvent::Delta(text.to_string()));
                            }
                        }
                    }
                    "thinking_delta" => {
                        if let Some(text) = d.get("thinking").and_then(|t| t.as_str()) {
                            if !text.is_empty() {
                                out.push(ParsedEvent::ThoughtDelta(text.to_string()));
                            }
                        }
                    }
                    "input_json_delta" => {
                        if let Some(pj) = d.get("partial_json").and_then(|t| t.as_str()) {
                            out.push(ParsedEvent::ToolCallDelta {
                                index,
                                partial_json: pj.to_string(),
                            });
                        }
                    }
                    _ => {} // unknown delta type — ignore (forward-compat)
                }
            }
        }
        "content_block_stop" => {
            // Shape: { index }
            let index = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
            // Worker filters this — only emits ToolCallEnd if the block was
            // a tool_use (i.e. an accumulator exists at this index).
            out.push(ParsedEvent::ToolCallEnd { index });
        }
        "message_delta" => {
            // Shape: { delta: { stop_reason? }, usage: { output_tokens? } }
            let reason = v
                .get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(|r| r.as_str())
                .map(map_stop_reason);
            let output = v
                .get("usage")
                .and_then(|u| u.get("output_tokens"))
                .and_then(|t| t.as_u64());
            match (reason, output) {
                (Some(r), out_tok) => out.push(ParsedEvent::StopReason {
                    reason: r,
                    output_tokens: out_tok,
                }),
                (None, Some(o)) => out.push(ParsedEvent::OutputUsage(o)),
                (None, None) => {}
            }
        }
        "message_stop" => {
            out.push(ParsedEvent::End);
        }
        // `ping` is the long-running-stream heartbeat (~every few seconds);
        // ignore gracefully. `error` events are rare — transport-layer errors
        // surface via the SSE byte stream's Result Err path instead.
        "ping" | "error" => {}
        _ => {} // unknown event — ignore for forward-compat
    }

    Ok(out)
}

/// Map Anthropic `stop_reason` strings to our `FinishReason`.
/// - `end_turn` / `stop_sequence` → Stop (assistant finished naturally)
/// - `tool_use`                   → Tools (stopped to call tools)
/// - `max_tokens`                 → Length (hit max_tokens)
/// - anything else                → Other(string)
fn map_stop_reason(s: &str) -> FinishReason {
    match s {
        "end_turn" | "stop_sequence" => FinishReason::Stop,
        "tool_use" => FinishReason::Tools,
        "max_tokens" => FinishReason::Length,
        other => FinishReason::Other(other.to_string()),
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
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let events = parse_event("content_block_delta", data).unwrap();
        assert!(matches!(
            one(events),
            Some(ParsedEvent::Delta(ref t)) if t == "Hello"
        ));
    }

    #[test]
    fn parses_thinking_delta() {
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm..."}}"#;
        let events = parse_event("content_block_delta", data).unwrap();
        assert!(matches!(
            one(events),
            Some(ParsedEvent::ThoughtDelta(ref t)) if t == "Hmm..."
        ));
    }

    #[test]
    fn parses_tool_use_block_start() {
        // content_block_start with type=tool_use carries id + name.
        let data = r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01abc","name":"list_pages","input":{}}}"#;
        let events = parse_event("content_block_start", data).unwrap();
        match one(events) {
            Some(ParsedEvent::ToolCallStart { index, id, name }) => {
                assert_eq!(index, 1);
                assert_eq!(id, "toolu_01abc");
                assert_eq!(name, "list_pages");
            }
            other => panic!("expected ToolCallStart, got {:?}", other),
        }
    }

    #[test]
    fn parses_input_json_delta() {
        // Fragment 1 of {"location":"San Francisco"} — not valid JSON alone.
        let data = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"location\":\"San"}}"#;
        let events = parse_event("content_block_delta", data).unwrap();
        match one(events) {
            Some(ParsedEvent::ToolCallDelta { index, partial_json }) => {
                assert_eq!(index, 1);
                assert_eq!(partial_json, "{\"location\":\"San");
            }
            other => panic!("expected ToolCallDelta, got {:?}", other),
        }
    }

    #[test]
    fn parses_message_delta_end_turn() {
        // message_delta with stop_reason=end_turn → FinishReason::Stop.
        let data = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}"#;
        let events = parse_event("message_delta", data).unwrap();
        match one(events) {
            Some(ParsedEvent::StopReason { reason, output_tokens }) => {
                assert_eq!(reason, FinishReason::Stop);
                assert_eq!(output_tokens, Some(42));
            }
            other => panic!("expected StopReason, got {:?}", other),
        }
    }

    #[test]
    fn parses_message_delta_tool_use() {
        // message_delta with stop_reason=tool_use → FinishReason::Tools.
        let data = r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":100}}"#;
        let events = parse_event("message_delta", data).unwrap();
        match one(events) {
            Some(ParsedEvent::StopReason { reason, output_tokens }) => {
                assert_eq!(reason, FinishReason::Tools);
                assert_eq!(output_tokens, Some(100));
            }
            other => panic!("expected StopReason, got {:?}", other),
        }
    }

    #[test]
    fn parses_content_block_stop() {
        let data = r#"{"type":"content_block_stop","index":1}"#;
        let events = parse_event("content_block_stop", data).unwrap();
        match one(events) {
            Some(ParsedEvent::ToolCallEnd { index }) => assert_eq!(index, 1),
            other => panic!("expected ToolCallEnd, got {:?}", other),
        }
    }

    #[test]
    fn parses_message_start_usage() {
        // message_start carries input_tokens in message.usage.
        let data = r#"{"type":"message_start","message":{"id":"msg_01abc","type":"message","role":"assistant","model":"claude-3-5-sonnet-20241022","content":[],"stop_reason":null,"usage":{"input_tokens":12,"output_tokens":1}}}"#;
        let events = parse_event("message_start", data).unwrap();
        match one(events) {
            Some(ParsedEvent::InputUsage(n)) => assert_eq!(n, 12),
            other => panic!("expected InputUsage, got {:?}", other),
        }
    }

    #[test]
    fn parses_message_stop_event() {
        let data = r#"{"type":"message_stop"}"#;
        let events = parse_event("message_stop", data).unwrap();
        assert!(matches!(one(events), Some(ParsedEvent::End)));
    }

    #[test]
    fn ignores_ping() {
        // Anthropic sends `event: ping` heartbeats every few seconds on
        // long-running streams — must not error or emit anything.
        let events = parse_event("ping", r#"{"type":"ping"}"#).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn ignores_unknown_event() {
        // Forward-compat: future event types should be silently dropped.
        let events = parse_event("some_future_event", r#"{"foo":"bar"}"#).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn rejects_malformed_json() {
        let err = parse_event("content_block_delta", "not json").unwrap_err();
        assert!(matches!(err, ProviderError::Stream(_)));
    }

    #[test]
    fn skips_empty_text_delta() {
        // Empty text deltas are valid but emit nothing.
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}"#;
        let events = parse_event("content_block_delta", data).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn parses_max_tokens_stop_reason() {
        let data = r#"{"delta":{"stop_reason":"max_tokens"}}"#;
        let events = parse_event("message_delta", data).unwrap();
        match one(events) {
            Some(ParsedEvent::StopReason { reason, output_tokens }) => {
                assert_eq!(reason, FinishReason::Length);
                assert_eq!(output_tokens, None);
            }
            other => panic!("expected StopReason, got {:?}", other),
        }
    }

    #[test]
    fn maps_unknown_stop_reason_to_other() {
        let data = r#"{"delta":{"stop_reason":"refusal_precondition"}}"#;
        let events = parse_event("message_delta", data).unwrap();
        match one(events) {
            Some(ParsedEvent::StopReason { reason: FinishReason::Other(ref s), .. }) => {
                assert_eq!(s, "refusal_precondition");
            }
            other => panic!("expected Other, got {:?}", other),
        }
    }

    #[test]
    fn text_block_start_emits_nothing() {
        // content_block_start with type=text is a no-op — text arrives via
        // subsequent text_delta events. (Only tool_use blocks need a Start.)
        let data = r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#;
        let events = parse_event("content_block_start", data).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn handles_empty_data_payload() {
        // Some heartbeats arrive with empty data — should not error.
        let events = parse_event("ping", "").unwrap();
        assert!(events.is_empty());
    }
}
