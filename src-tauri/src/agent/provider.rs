//! M10 AI assistant (v2 built-in agent) — Provider trait + shared types.
//!
//! Provider-agnostic abstraction over LLM chat-completion streaming. Each
//! concrete provider (OpenAI, Anthropic, Ollama-via-OpenAI-compat) implements
//! `Provider`; the agent loop in `mod.rs` drives the conversation through
//! this trait, unaware of wire-format specifics.
//!
//! P1 scope: text-only chat (no tools). P2 will extend with tool calling:
//!   - `ChatRequest.tools` / `tool_choice` fields
//!   - `StreamEvent::ToolCallStart/Delta/End` variants
//!   - `Role::Tool` + tool-result message content
//! The types below are sized so P2 is an additive change, not a rewrite.

use async_trait::async_trait;
use futures::stream::BoxStream;

// =============================================================================
// Chat request / message types
// =============================================================================

/// One message in the conversation.
///
/// P1: content is a plain `String` (text-only).
/// P2: will become an enum (`Text(String) | Blocks(Vec<...>)`) to carry
/// tool_use / tool_result blocks for Anthropic and OpenAI tool calling.
#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: Role::System, content: content.into() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: Role::User, content: content.into() }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: Role::Assistant, content: content.into() }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
    // P2: Tool,
}

/// Provider-agnostic chat request. Provider impls translate this to their
/// own wire format (OpenAI: messages+tools+tool_choice; Anthropic:
/// system+messages+tools+tool_choice).
#[derive(Clone, Debug)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
    pub temperature: Option<f32>,
    // P2: pub tools: Vec<ToolSchema>,
    // P2: pub tool_choice: ToolChoice,
}

// =============================================================================
// Streaming events
// =============================================================================

/// One event in the streaming response. The agent loop matches on these to
/// emit Tauri events (`ai-token`, `ai-done`, `ai-error`).
///
/// P1 only emits `Delta` and `Finish` (text-only chat). `ThoughtDelta` and
/// `Error` variants are wired in P2 (thinking models + provider error
/// mid-stream) — `#[allow(dead_code)]` keeps P1 warning-free without
/// removing them.
#[allow(dead_code)]
#[derive(Debug)]
pub enum StreamEvent {
    /// Incremental text token (assistant output).
    Delta(String),
    /// Reasoning/thinking token (Anthropic thinking blocks / OpenAI o1).
    /// Kept separate from `Delta` so the UI can dim/collapse it.
    ThoughtDelta(String),
    /// Stream completed (one provider round-trip, not necessarily the whole
    /// agent turn — agent loop may continue if reason is `Tools`).
    ///
    /// `reason` and `usage` are populated but not consumed by P1's text-only
    /// loop; P2 branches on `reason == Tools` to drive the tool loop, and
    /// P3 surfaces `usage` in the Settings stats UI.
    #[allow(dead_code)]
    Finish {
        reason: FinishReason,
        usage: Option<Usage>,
    },
    /// Provider-level error mid-stream. The agent loop emits `ai-error` and
    /// terminates the turn.
    Error(ProviderError),
    // P2: ToolCallStart / ToolCallDelta / ToolCallEnd variants
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FinishReason {
    /// Assistant finished naturally (end of turn).
    Stop,
    /// Assistant stopped to invoke tools; agent loop will execute them and
    /// continue with another provider.stream() call.
    Tools,
    /// Hit max_tokens.
    Length,
    /// Provider content filter.
    ContentFilter,
    /// Any other reason; carried as a string for forward-compat.
    Other(String),
}

/// Token usage for one round-trip. Surfaced to the P3 Settings stats UI
/// (cost/usage tracking). Not consumed in P1/P2.
#[allow(dead_code)]
#[derive(Clone, Debug, Default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

// =============================================================================
// Provider trait
// =============================================================================

/// A chat-completion provider that streams responses.
///
/// The returned stream is `'static` (does not borrow `self` or `req`);
/// provider impls clone whatever they need (reqwest::Client is `Arc`-backed
/// internally, so the clone is cheap) and own all state inside the stream.
/// This keeps the trait signature simple and lets the agent loop spawn the
/// stream consumer on its own task without lifetime juggling.
///
/// `BoxStream` is used instead of `impl Trait` because stable Rust does not
/// yet support `impl Trait` in trait method returns (RPITITP).
#[async_trait]
pub trait Provider: Send + Sync {
    /// Begin a streaming chat completion. The HTTP request is sent eagerly
    /// (so auth/network errors surface before the first stream poll); SSE
    /// events arrive lazily as the caller polls the stream.
    async fn stream(
        &self,
        req: &ChatRequest,
    ) -> Result<BoxStream<'static, Result<StreamEvent, ProviderError>>, ProviderError>;
}

// =============================================================================
// Errors
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    /// 401 / 403 — API key invalid or missing.
    #[error("auth failed (HTTP {status}): {body}")]
    Auth { status: u16, body: String },

    /// 429 — rate limited or quota exhausted.
    #[error("rate limited (HTTP 429): {body}")]
    RateLimited { body: String },

    /// Any other non-2xx HTTP response.
    #[error("provider error (HTTP {status}): {body}")]
    Api { status: u16, body: String },

    /// Network failure, TLS error, connection reset, etc.
    #[error("network: {0}")]
    Network(#[from] reqwest::Error),

    /// SSE stream malformed, JSON parse failure, unexpected event shape.
    #[error("stream invalid: {0}")]
    Stream(String),

    /// Bad config (missing model, empty base_url, etc.). Surfaced before any
    /// network call.
    #[error("config: {0}")]
    Config(String),
}
