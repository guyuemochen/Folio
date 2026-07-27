//! SSE (Server-Sent Events) stream helpers.
//!
//! LLM providers (OpenAI, Anthropic, Ollama) all stream responses as SSE —
//! a sequence of `event: <type>\ndata: <json>\n\n` frames over HTTP/1.1 chunked
//! transfer. We use `eventsource-stream` for the frame parser (handles
//! line-splitting, BOM, CRLF, retry fields) layered on `reqwest`'s byte
//! stream.
//!
//! Crate choice rationale (see docs/m10-ai-assistant-plan.md §5.2):
//! - `eventsource-stream 0.2` — pure SSE decoder, no HTTP, composes with
//!   reqwest.bytes_stream() and lets us handle LLM edge cases (Anthropic
//!   `event: ping` heartbeat, OpenAI `data: [DONE]` sentinel).
//! - NOT `reqwest-sse` — couples HTTP + SSE, hard to customize.
//! - NOT `async-sse` — maintenance stalled.

use eventsource_stream::{Event, Eventsource};
use futures::{stream::BoxStream, StreamExt};

use super::provider::ProviderError;

/// Wrap a reqwest response body into an SSE event stream.
///
/// The caller must have already called `.error_for_status()` if it wants
/// 4xx/5xx to surface as `reqwest::Error` (i.e., as `ProviderError::Network`)
/// rather than arriving as garbage events.
///
/// Errors from the underlying byte stream or SSE parser are unified into
/// `ProviderError::Stream` so callers don't have to deal with
/// `eventsource_stream::EventStreamError<reqwest::Error>` directly.
pub fn sse_response(resp: reqwest::Response) -> BoxStream<'static, Result<Event, ProviderError>> {
    resp.bytes_stream()
        .eventsource()
        .map(|r| r.map_err(|e| ProviderError::Stream(e.to_string())))
        .boxed()
}
