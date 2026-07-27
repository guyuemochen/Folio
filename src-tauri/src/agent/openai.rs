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

use super::provider::{ChatRequest, FinishReason, Provider, ProviderError, Role, StreamEvent, Usage};
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
            //
            // Every "clean" exit path (sentinel seen / usage chunk / explicit
            // Finish with usage) returns from inside the loop, so reaching
            // past the `while let` always means a network drop — emit a
            // best-effort Finish with whatever finish_reason we last saw.
            let mut pending_finish: Option<FinishReason> = None;

            while let Some(ev) = sse.next().await {
                match ev {
                    Err(e) => {
                        let _ = tx.send(Err(e)).await;
                        return;
                    }
                    Ok(event) => {
                        if event.data == "[DONE]" {
                            let reason = pending_finish.take().unwrap_or(FinishReason::Stop);
                            let _ = tx.send(Ok(StreamEvent::Finish { reason, usage: None })).await;
                            return;
                        }
                        match parse_chunk(&event.data) {
                            Ok(Some(ParsedEvent::Delta(text))) => {
                                if tx.send(Ok(StreamEvent::Delta(text))).await.is_err() {
                                    return; // caller dropped the receiver — cancel
                                }
                            }
                            Ok(Some(ParsedEvent::Finish { reason, usage })) => {
                                if let Some(u) = usage {
                                    // Finish + usage together — emit immediately.
                                    let _ = tx
                                        .send(Ok(StreamEvent::Finish { reason, usage: Some(u) }))
                                        .await;
                                    return;
                                }
                                // Defer emit until we see usage chunk or [DONE].
                                pending_finish = Some(reason);
                            }
                            Ok(Some(ParsedEvent::Usage(u))) => {
                                let reason = pending_finish.take().unwrap_or(FinishReason::Stop);
                                let _ = tx
                                    .send(Ok(StreamEvent::Finish { reason, usage: Some(u) }))
                                    .await;
                                return;
                            }
                            Ok(None) => continue, // empty chunk (delta with empty content)
                            Err(e) => {
                                let _ = tx.send(Err(e)).await;
                                return;
                            }
                        }
                    }
                }
            }

            // Network drop: stream closed without [DONE]. Emit best-effort
            // Finish so the agent loop's `while let Some(ev) = ...` exits.
            let reason = pending_finish.take().unwrap_or(FinishReason::Stop);
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
    Finish { reason: FinishReason, usage: Option<Usage> },
    Usage(Usage), // usage-only chunk (no choices)
}

fn build_request_body(req: &ChatRequest) -> Value {
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|m| {
            json!({
                "role": role_str(m.role),
                "content": m.content,
            })
        })
        .collect();

    json!({
        "model": req.model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true },
        "max_tokens": req.max_tokens,
        "temperature": req.temperature.unwrap_or(1.0),
    })
}

fn role_str(r: Role) -> &'static str {
    match r {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

/// Parse one `data: {json}` line into a `ParsedEvent`. Kept as a free
/// function so unit tests can drive it without spinning up an HTTP server
/// or a tokio task.
fn parse_chunk(data: &str) -> Result<Option<ParsedEvent>, ProviderError> {
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => return Err(ProviderError::Stream(format!("parse chunk JSON: {e} (data: {data:?})"))),
    };

    // Usage-only chunk: choices is empty (or missing) and usage is populated.
    // OpenAI sends this as the very last data event before [DONE].
    let choices_empty = v
        .get("choices")
        .and_then(|c| c.as_array())
        .map(|a| a.is_empty())
        .unwrap_or(true);
    if choices_empty {
        if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
            return Ok(Some(ParsedEvent::Usage(parse_usage(u))));
        }
        return Ok(None);
    }

    let choice = match v.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()) {
        Some(c) => c,
        None => return Ok(None),
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
        return Ok(Some(ParsedEvent::Finish { reason, usage: None }));
    }

    // Text delta.
    if let Some(content) = choice
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
    {
        if !content.is_empty() {
            return Ok(Some(ParsedEvent::Delta(content.to_string())));
        }
    }

    Ok(None)
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

    #[test]
    fn parses_text_delta() {
        let ev = parse_chunk(r#"{"choices":[{"delta":{"content":"Hello"}}]}"#).unwrap();
        assert!(matches!(ev, Some(ParsedEvent::Delta(ref t)) if t == "Hello"));
    }

    #[test]
    fn skips_empty_delta() {
        // OpenAI sometimes sends chunks with empty delta.content (keep-alive).
        let ev = parse_chunk(r#"{"choices":[{"delta":{"content":""}}]}"#).unwrap();
        assert!(matches!(ev, None));

        let ev2 = parse_chunk(r#"{"choices":[{"delta":{}}]}"#).unwrap();
        assert!(matches!(ev2, None));
    }

    #[test]
    fn parses_finish_reason_stop() {
        let ev = parse_chunk(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#).unwrap();
        assert!(matches!(
            ev,
            Some(ParsedEvent::Finish { reason: FinishReason::Stop, usage: None })
        ));
    }

    #[test]
    fn parses_finish_reason_tool_calls() {
        let ev = parse_chunk(r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#).unwrap();
        assert!(matches!(
            ev,
            Some(ParsedEvent::Finish { reason: FinishReason::Tools, usage: None })
        ));
    }

    #[test]
    fn parses_finish_reason_unknown() {
        let ev = parse_chunk(r#"{"choices":[{"delta":{},"finish_reason":"something_new"}]}"#).unwrap();
        assert!(matches!(
            ev,
            Some(ParsedEvent::Finish { reason: FinishReason::Other(ref s), .. }) if s == "something_new"
        ));
    }

    #[test]
    fn parses_usage_only_chunk() {
        let data = r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}"#;
        let ev = parse_chunk(data).unwrap();
        match ev {
            Some(ParsedEvent::Usage(u)) => {
                assert_eq!(u.input_tokens, 10);
                assert_eq!(u.output_tokens, 2);
            }
            other => panic!("expected Usage, got {:?}", other),
        }
    }

    #[test]
    fn handles_empty_choices_without_usage() {
        // Heartbeat-style chunk with no choices and no usage — skip.
        let ev = parse_chunk(r#"{"choices":[]}"#).unwrap();
        assert!(matches!(ev, None));
    }

    #[test]
    fn rejects_malformed_json() {
        let err = parse_chunk("not json").unwrap_err();
        assert!(matches!(err, ProviderError::Stream(_)));
    }
}
