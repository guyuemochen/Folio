//! M10 AI assistant (v2 built-in agent) — Provider trait + shared types.
//!
//! Provider-agnostic abstraction over LLM chat-completion streaming. Each
//! concrete provider (OpenAI, Anthropic, Ollama-via-OpenAI-compat) implements
//! `Provider`; the agent loop in `mod.rs` drives the conversation through
//! this trait, unaware of wire-format specifics.
//!
//! P2 scope: tool calling (text + tool_use / tool_result blocks). The
//! `MessageContent` enum lets a single conversation hold mixed text and
//! tool calls without per-provider message types — provider impls translate
//! to their own wire format (OpenAI: messages with role=tool; Anthropic:
//! content blocks with type=tool_use/tool_result).

use async_trait::async_trait;
use futures::stream::BoxStream;
use serde_json::Value;

// =============================================================================
// Chat request / message types
// =============================================================================

/// One message in the conversation. Content is provider-agnostic — the
/// `Blocks` variant carries tool_use / tool_result blocks alongside text so
/// a single conversation history can be replayed across providers.
#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub role: Role,
    pub content: MessageContent,
}

impl ChatMessage {
    pub fn system(text: impl Into<String>) -> Self {
        Self { role: Role::System, content: MessageContent::Text(text.into()) }
    }
    pub fn user(text: impl Into<String>) -> Self {
        Self { role: Role::User, content: MessageContent::Text(text.into()) }
    }
    /// Assistant turn with plain text (no tool_use blocks). Equivalent to
    /// `assistant_blocks(vec![Block::Text(text)])` — sugar for the common
    /// case where the assistant only emitted text.
    pub fn assistant_text(text: impl Into<String>) -> Self {
        Self { role: Role::Assistant, content: MessageContent::Text(text.into()) }
    }
    /// Assistant turn with mixed content (text + tool_use blocks). Each
    /// provider translates this to its wire format.
    pub fn assistant_blocks(blocks: Vec<Block>) -> Self {
        Self { role: Role::Assistant, content: MessageContent::Blocks(blocks) }
    }
    /// Tool-result message. OpenAI: role=tool with content; Anthropic:
    /// role=user with a tool_result content block. Provider impls handle
    /// the rewrite; agent loop just stages this after executing a tool.
    pub fn tool_result(
        tool_use_id: impl Into<String>,
        content: impl Into<String>,
        is_error: bool,
    ) -> Self {
        Self {
            role: Role::Tool,
            content: MessageContent::Blocks(vec![Block::ToolResult {
                tool_use_id: tool_use_id.into(),
                content: content.into(),
                is_error,
            }]),
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
    /// Tool-result message (OpenAI: role=tool). Anthropic provider will
    /// translate this to role=user with a tool_result block at serialize
    /// time; consumers iterate Role naively.
    Tool,
}

#[derive(Clone, Debug)]
pub enum MessageContent {
    /// Plain text message (system, simple user/assistant turns).
    Text(String),
    /// Multi-block content (assistant with tool_use, user with tool_result).
    Blocks(Vec<Block>),
}

#[derive(Clone, Debug)]
pub enum Block {
    /// Text content (an assistant turn may contain several text blocks
    /// interleaved with tool_use blocks).
    Text(String),
    /// Assistant's request to call a tool. `input` is the parsed JSON
    /// arguments object sent by the model — both OpenAI (`arguments`
    /// string, parsed by us) and Anthropic (`input` object) are normalized
    /// to a `serde_json::Value` here.
    ToolUse { id: String, name: String, input: Value },
    /// Result of a tool call, returned to the model. Always wrapped in a
    /// `Role::Tool` message (OpenAI convention); Anthropic provider
    /// translates the wrapping message's role to user at serialize time.
    ToolResult { tool_use_id: String, content: String, is_error: bool },
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
    /// Tools the model may call. Empty vec = no tool calling (model is
    /// never offered tools, never emits tool_use).
    pub tools: Vec<ToolSchema>,
    /// How the model should choose to call tools. `Auto` is the default.
    pub tool_choice: ToolChoice,
}

impl ChatRequest {
    /// Builder sugar: build a request with tools set.
    #[allow(dead_code)]
    pub fn with_tools(mut self, tools: Vec<ToolSchema>) -> Self {
        self.tools = tools;
        self
    }
}

/// How the model should choose to call tools. `Auto` is the default and the
/// only value the agent loop currently sets; `Required` / `None` are kept
/// for future tool-routing heuristics.
#[allow(dead_code)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ToolChoice {
    /// Model decides whether to call a tool or answer directly (default).
    Auto,
    /// Model must call at least one tool.
    Required,
    /// Model must NOT call any tools (text-only response).
    None,
}

impl Default for ToolChoice {
    fn default() -> Self {
        ToolChoice::Auto
    }
}

/// Description of a tool the model can call. Provider impls wrap this in
/// their own envelope:
///   - OpenAI: `{"type":"function","function":{"name","description","parameters":input_schema}}`
///   - Anthropic: `{"name","description","input_schema"}`
#[derive(Clone, Debug)]
pub struct ToolSchema {
    pub name: String,
    pub description: String,
    /// JSON Schema describing the tool's input arguments. Both providers
    /// accept a subset of JSON Schema draft 7; keep descriptions inside
    /// `description` fields so the model picks correctly.
    pub input_schema: Value,
}

// =============================================================================
// Streaming events
// =============================================================================

/// One event in the streaming response. The agent loop matches on these to
/// emit Tauri events (`ai-token`, `ai-tool`, `ai-permission`, `ai-done`).
///
/// `Error` is emitted by provider impls when they hit an error mid-stream
/// (provider impls so far surface errors via the channel's `Result::Err`
/// arm instead, but the variant is part of the contract); `Finish.usage`
/// is captured for the future stats UI.
#[allow(dead_code)]
#[derive(Debug)]
pub enum StreamEvent {
    /// Incremental text token (assistant output).
    Delta(String),
    /// Reasoning/thinking token (Anthropic thinking blocks / OpenAI o1).
    /// Kept separate from `Delta` so the UI can dim/collapse it.
    ThoughtDelta(String),
    /// Tool call started — first chunk of a tool_use; carries the call id
    /// (for correlation across deltas) and the tool name. The UI shows
    /// "🔧 calling {name}".
    ToolCallStart { id: String, name: String },
    /// Partial JSON arguments for a tool call. Concatenate `partial_json`
    /// across deltas with the same `id`; the full JSON is only parseable
    /// after `ToolCallEnd`. (Anthropic calls this `input_json_delta`.)
    ToolCallDelta { id: String, partial_json: String },
    /// Tool call's arguments are complete. The agent loop parses the
    /// accumulated JSON here and stages the tool for execution. Multiple
    /// tools may be in flight (OpenAI: keyed by `index`; Anthropic: by
    /// `content_block_start`).
    ToolCallEnd { id: String },
    /// Stream completed (one provider round-trip, not necessarily the whole
    /// agent turn — agent loop may continue if reason is `Tools`).
    Finish {
        reason: FinishReason,
        usage: Option<Usage>,
    },
    /// Provider-level error mid-stream. The agent loop emits `ai-error` and
    /// terminates the turn.
    Error(ProviderError),
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
/// (cost/usage tracking).
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
