//! M10 AI assistant (v2 built-in agent).
//!
//! Built-in replacement for the v1 opencode subprocess integration. The agent
//! loop lives entirely in the Folio Rust core — no external binaries, no ACP,
//! no MCP-over-stdio. LLM calls go directly over HTTPS (reqwest + rustls) and
//! stream tokens back to the frontend via Tauri events.
//!
//! Module layout:
//!   - `provider` — Provider trait + ChatRequest/StreamEvent/ProviderError
//!   - `stream`   — SSE decoding helper (reqwest + eventsource-stream)
//!   - `openai`   — OpenAI chat/completions implementation (also covers
//!                  Ollama via the OpenAI-compatible /v1 endpoint)
//!   - (P2) `anthropic` — Anthropic Messages API implementation
//!   - (P2) `tools`     — built-in tools (read/search/update page)
//!
//! Frontend event contract (stable since v1; reused unchanged in v2):
//!   `ai-token`  (String)  — incremental assistant text
//!   `ai-thought`(String)  — incremental reasoning text (P2 thinking models)
//!   `ai-tool`   (String)  — tool-call title (P2)
//!   `ai-done`   (())      — turn finished
//!   `ai-error`  (String)  — protocol/transport error
//!   `ai-permission` ({title,description}) — write-tool approval prompt (P2)
//!   `folio:ai-content-changed` (()) — write tool modified data.db (P2)

pub mod openai;
pub mod provider;
pub mod stream;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures::StreamExt;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, State};

pub use provider::{ChatMessage, ChatRequest, Provider, ProviderError, StreamEvent};

// =============================================================================
// Conversation memory (per active session)
// =============================================================================

/// The agent's conversation memory: the rolling list of messages sent to /
/// received from the LLM. Stored in `AppState` so it survives across multiple
/// `ai_send` calls within a session. Reset by `ai_stop` (P1) or by changing
/// provider/model in Settings (P3 — context belongs to the old config).
///
/// Fields are wrapped in `Arc` so the spawned task that drives the LLM call
/// can hold its own reference without borrowing `AppState` (which lives
/// behind `tauri::State<'_, AppState>` and is not `'static`).
pub struct AgentState {
    /// In-memory chat history. P1 holds text-only messages; P2 will carry
    /// tool calls + tool results as additional message variants.
    pub messages: Arc<Mutex<Vec<ChatMessage>>>,
    /// Reentrancy guard: only one turn in flight at a time. The UI's send
    /// button also disables during a turn, but the backend guard is the
    /// source of truth (frontend state can race).
    pub busy: Arc<AtomicBool>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
            busy: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Reset the conversation memory and clear the busy flag. Called by
    /// `ai_stop` and (P3) when the user changes provider/model in Settings.
    pub fn reset(&self) {
        self.messages.lock().clear();
        self.busy.store(false, Ordering::SeqCst);
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// P1 dev-time configuration (env vars)
// =============================================================================
//
// P3 replaces `load_config` with one that reads `ai_settings` + keyring; the
// `AiConfig` shape stays the same so the agent loop is unchanged.
//
// Supported env vars (dev only — see docs/m10-ai-assistant-plan.md §3.1):
//   OPENAI_API_KEY    — required for OpenAI/Ollama providers
//   OPENAI_BASE_URL   — override endpoint (default https://api.openai.com/v1,
//                       or http://localhost:11434/v1 when AI_PROVIDER=ollama)
//   OPENAI_MODEL      — model id (default gpt-4o-mini, or llama3.1 for ollama)
//   AI_PROVIDER       — "openai" (default) | "anthropic" (P2) | "ollama"
//   AI_MAX_TOKENS     — default 4096
//   AI_TEMPERATURE    — default 1.0; parsed as f32

#[derive(Clone, Debug)]
pub struct AiConfig {
    pub provider_kind: ProviderKind,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: Option<f32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProviderKind {
    Openai,
    Anthropic,
    Ollama,
}

impl ProviderKind {
    fn parse(s: &str) -> Result<Self, String> {
        match s.to_ascii_lowercase().as_str() {
            "" | "openai" => Ok(ProviderKind::Openai),
            "anthropic" => Ok(ProviderKind::Anthropic),
            "ollama" => Ok(ProviderKind::Ollama),
            other => Err(format!("unknown AI_PROVIDER: {other}")),
        }
    }
}

fn load_config() -> Result<AiConfig, String> {
    let provider_kind = ProviderKind::parse(&std::env::var("AI_PROVIDER").unwrap_or_default())?;

    // P1: Anthropic provider is implemented in P2 — refuse early with a clear
    // message instead of falling through to OpenAI silently.
    if provider_kind == ProviderKind::Anthropic {
        return Err(
            "Anthropic provider not yet implemented (lands in P2). \
             Set AI_PROVIDER=openai or AI_PROVIDER=ollama for now."
                .into(),
        );
    }

    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY env var not set (P1 dev config)".to_string())?;

    let base_url = match provider_kind {
        ProviderKind::Ollama => {
            std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "http://localhost:11434/v1".into())
        }
        _ => std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".into()),
    };

    let model = match provider_kind {
        ProviderKind::Ollama => std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "llama3.1".into()),
        _ => std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into()),
    };

    let max_tokens = std::env::var("AI_MAX_TOKENS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4096);
    let temperature = std::env::var("AI_TEMPERATURE")
        .ok()
        .and_then(|s| s.parse().ok());

    Ok(AiConfig {
        provider_kind,
        api_key,
        base_url,
        model,
        max_tokens,
        temperature,
    })
}

/// Construct a provider for the given config. P1 only wires OpenAI
/// (which also covers Ollama via the OpenAI-compatible endpoint).
fn build_provider(cfg: &AiConfig) -> Result<Box<dyn Provider>, ProviderError> {
    match cfg.provider_kind {
        ProviderKind::Openai | ProviderKind::Ollama => Ok(Box::new(
            openai::OpenaiProvider::with_base_url(&cfg.base_url, &cfg.api_key),
        )),
        // P1 refuses Anthropic in `load_config`; this branch is unreachable
        // until P2 adds `agent::anthropic::AnthropicProvider`.
        ProviderKind::Anthropic => Err(ProviderError::Config("anthropic provider lands in P2".into())),
    }
}

// =============================================================================
// Tauri commands
// =============================================================================

/// Send a prompt to the assistant. Returns immediately after the user
/// message is staged; the assistant reply streams via `ai-token` events and
/// `ai-done` fires when the turn ends. Errors after the request is in flight
/// come back as `ai-error` events (not via the invoke rejection) so the UI
/// always learns about them on the event channel.
#[tauri::command]
pub async fn ai_send(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    message: String,
) -> Result<(), String> {
    // Reentrancy guard. swap returns the OLD value; if old was true, someone
    // is already mid-turn — refuse without disturbing their flag.
    if state.agent.busy.swap(true, Ordering::SeqCst) {
        return Err("AI busy — stop the current turn before sending another".into());
    }

    // Load config BEFORE touching conversation memory so a config error does
    // not corrupt state. If config fails, restore the busy flag.
    let cfg = match load_config() {
        Ok(c) => c,
        Err(e) => {
            state.agent.busy.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    let provider = match build_provider(&cfg) {
        Ok(p) => p,
        Err(e) => {
            state.agent.busy.store(false, Ordering::SeqCst);
            return Err(e.to_string());
        }
    };

    // Stage the user message into conversation memory.
    state.agent.messages.lock().push(ChatMessage::user(message));

    // Move ownership of provider + a clone of the conversation Arc into the
    // spawned task. The task resets `busy` on completion (success or error).
    let messages = state.agent.messages.clone();
    let busy = state.agent.busy.clone();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let result = run_turn(&app_for_task, provider.as_ref(), &messages, &cfg).await;
        busy.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = app_for_task.emit("ai-done", ());
            }
            Err(e) => {
                let _ = app_for_task.emit("ai-error", e.to_string());
            }
        }
    });

    Ok(())
}

/// Stop the assistant: reset conversation memory + clear the busy flag.
///
/// P1 semantics: this fully resets the conversation (next send starts fresh).
/// P2 will distinguish "stop current turn" (keep history) from "reset
/// conversation" (clear history). For P1 a single `ai_stop` is enough.
#[tauri::command]
pub fn ai_stop(state: State<'_, crate::AppState>) -> Result<(), String> {
    state.agent.reset();
    Ok(())
}

// =============================================================================
// Turn execution (P1 — single provider round-trip, no tool loop)
// =============================================================================
//
// P2 wraps this in a loop: when StreamEvent::Finish { reason: Tools, .. }
// arrives, execute tool calls, push tool results into messages, and call
// run_turn again. P1 just consumes one round and emits the text.

async fn run_turn(
    app: &AppHandle,
    provider: &dyn Provider,
    messages: &Arc<Mutex<Vec<ChatMessage>>>,
    cfg: &AiConfig,
) -> Result<(), ProviderError> {
    let req = ChatRequest {
        model: cfg.model.clone(),
        messages: messages.lock().clone(),
        max_tokens: cfg.max_tokens,
        temperature: cfg.temperature,
    };

    let mut stream = provider.stream(&req).await?;

    let mut assistant_text = String::new();
    while let Some(ev) = stream.next().await {
        match ev {
            Ok(StreamEvent::Delta(text)) => {
                assistant_text.push_str(&text);
                let _ = app.emit("ai-token", text);
            }
            Ok(StreamEvent::ThoughtDelta(text)) => {
                let _ = app.emit("ai-thought", text);
            }
            Ok(StreamEvent::Finish { reason: _, usage: _ }) => {
                // Turn complete; usage captured in P3's stats UI. The outer
                // task emits `ai-done` after this function returns Ok.
            }
            Ok(StreamEvent::Error(e)) => {
                return Err(e);
            }
            Err(_) => {
                // StreamEvent::Error is already wrapped in Ok; this arm is
                // structurally unreachable but kept defensively.
                eprintln!("[folio:ai] unexpected double-wrapped error in stream");
            }
        }
    }

    // Push the assistant reply into conversation memory so the next ai_send
    // carries multi-turn context.
    if !assistant_text.trim().is_empty() {
        messages.lock().push(ChatMessage::assistant(assistant_text));
    }

    Ok(())
}
