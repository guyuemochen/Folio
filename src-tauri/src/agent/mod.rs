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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderKind {
    Openai,
    Anthropic,
    Ollama,
    /// OpenAI-compatible endpoint at a user-supplied base_url (LM Studio,
    /// vLLM, DeepSeek, 智谱, etc). Treated like Openai at the wire level.
    Custom,
}

impl ProviderKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.to_ascii_lowercase().as_str() {
            "" | "openai" => Ok(ProviderKind::Openai),
            "anthropic" => Ok(ProviderKind::Anthropic),
            "ollama" => Ok(ProviderKind::Ollama),
            "custom" => Ok(ProviderKind::Custom),
            other => Err(format!("unknown provider: {other}")),
        }
    }

    /// Lowercase id used in `ai_settings.provider` row. Currently only used
    /// for documentation; P4 may use it for README generation.
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderKind::Openai => "openai",
            ProviderKind::Anthropic => "anthropic",
            ProviderKind::Ollama => "ollama",
            ProviderKind::Custom => "custom",
        }
    }
}

// =============================================================================
// Settings IO type (frontend <-> backend boundary)
// =============================================================================
//
// `AiSettings` is the wire type crossing the Tauri command boundary: a flat
// camelCase struct that the Settings UI reads/writes. `AiConfig` is the
// agent's internal, typed representation. Conversion happens in
// `load_config_from_settings`.

/// Frontend-facing AI settings. Persisted in the `ai_settings` SQLite table
/// (one row per field, by name). Returned by `ai_get_config` and accepted by
/// `ai_save_config` / `ai_test_connection`.
///
/// `api_key` is stored plaintext for now (P3); P4 will evaluate moving it
/// to the OS keyring (plan §7.1).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// Master switch. When false, `ai_send` refuses with a clear error.
    pub enabled: bool,
    /// Provider id: "openai" | "anthropic" | "ollama" | "custom".
    pub provider: String,
    /// Plaintext API key. Empty string is allowed for Ollama (local, no auth).
    pub api_key: String,
    /// Model id (e.g. "gpt-4o-mini", "llama3.1", "claude-3-5-sonnet").
    pub model: String,
    /// Base URL override. Empty means "use provider default". Always set by
    /// the UI for Ollama / custom; usually empty for OpenAI / Anthropic.
    pub base_url: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "openai".into(),
            api_key: String::new(),
            model: "gpt-4o-mini".into(),
            base_url: String::new(),
        }
    }
}

fn default_base_url(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Ollama => "http://localhost:11434/v1",
        _ => "https://api.openai.com/v1",
    }
}

fn default_model(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Ollama => "llama3.1",
        _ => "gpt-4o-mini",
    }
}

/// Build an `AiConfig` (internal) from an `AiSettings` (frontend). No IO —
/// pure conversion. Used by both `load_config` (after reading the DB) and
/// `ai_test_connection` (after receiving the form from the UI).
pub fn load_config_from_settings(s: &AiSettings) -> Result<AiConfig, String> {
    let provider_kind = ProviderKind::parse(&s.provider)?;

    // P1/P3: Anthropic provider is implemented in P2 — refuse early with a
    // clear message instead of falling through to OpenAI silently.
    if provider_kind == ProviderKind::Anthropic {
        return Err(
            "Anthropic provider not yet implemented (lands in P2). \
             Use OpenAI / Ollama / Custom (OpenAI-compatible) for now."
                .into(),
        );
    }

    if s.api_key.is_empty() && provider_kind != ProviderKind::Ollama {
        return Err(format!(
            "API key required for provider '{}' (only Ollama allows empty key)",
            s.provider
        ));
    }

    let base_url = if s.base_url.is_empty() {
        default_base_url(provider_kind).to_string()
    } else {
        s.base_url.clone()
    };
    let model = if s.model.is_empty() {
        default_model(provider_kind).to_string()
    } else {
        s.model.clone()
    };

    Ok(AiConfig {
        provider_kind,
        api_key: s.api_key.clone(),
        base_url,
        model,
        max_tokens: 4096,
        temperature: None,
    })
}

/// Read settings from the workspace DB (via `db::ai_get_all_settings`) and
/// convert to an `AiConfig`. Falls back to env vars (dev mode) when the DB
/// has no `enabled` row — keeps `OPENAI_API_KEY=... pnpm tauri dev` working
/// as a smoke test without configuring Settings UI.
pub fn load_config(db: &rusqlite::Connection) -> Result<AiConfig, String> {
    let m = crate::db::ai_get_all_settings(db).map_err(|e| e.to_string())?;

    // No `enabled` row → first-run or dev-only. Use env-var fallback.
    if !m.contains_key("enabled") {
        return load_config_from_env();
    }

    let enabled = m.get("enabled").map(|s| s == "true").unwrap_or(false);
    if !enabled {
        return Err("AI is disabled — enable it in Settings".into());
    }

    let settings = AiSettings {
        enabled: true,
        provider: m.get("provider").cloned().unwrap_or_else(|| "openai".into()),
        api_key: m.get("api_key").cloned().unwrap_or_default(),
        model: m
            .get("model")
            .cloned()
            .unwrap_or_else(|| default_model(ProviderKind::Openai).into()),
        base_url: m.get("base_url").cloned().unwrap_or_default(),
    };
    load_config_from_settings(&settings)
}

/// Env-var fallback for dev mode. Reads OPENAI_API_KEY / OPENAI_BASE_URL /
/// OPENAI_MODEL / AI_PROVIDER.
fn load_config_from_env() -> Result<AiConfig, String> {
    let provider_kind = ProviderKind::parse(&std::env::var("AI_PROVIDER").unwrap_or_default())?;

    if provider_kind == ProviderKind::Anthropic {
        return Err("Anthropic provider not yet implemented (lands in P2)".into());
    }

    let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| {
        "OPENAI_API_KEY env var not set, and AI is not configured in Settings".to_string()
    })?;
    let base_url =
        std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| default_base_url(provider_kind).into());
    let model =
        std::env::var("OPENAI_MODEL").unwrap_or_else(|_| default_model(provider_kind).into());

    Ok(AiConfig {
        provider_kind,
        api_key,
        base_url,
        model,
        max_tokens: 4096,
        temperature: None,
    })
}

/// Construct a provider for the given config. Used by `ai_send` and
/// `ai_test_connection`.
pub fn build_provider(cfg: &AiConfig) -> Result<Box<dyn Provider>, ProviderError> {
    match cfg.provider_kind {
        ProviderKind::Openai | ProviderKind::Ollama | ProviderKind::Custom => Ok(Box::new(
            openai::OpenaiProvider::with_base_url(&cfg.base_url, &cfg.api_key),
        )),
        // `load_config` already refuses Anthropic; this branch is unreachable
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
    let cfg = {
        let db = state.db.lock();
        match load_config(&db) {
            Ok(c) => c,
            Err(e) => {
                state.agent.busy.store(false, Ordering::SeqCst);
                return Err(e);
            }
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

/// Read the current AI settings from the workspace DB. Returns the default
/// (enabled=false, provider="openai", model="gpt-4o-mini") on first run —
/// never errors just because settings are uninitialized.
#[tauri::command]
pub fn ai_get_config(state: State<'_, crate::AppState>) -> Result<AiSettings, String> {
    let db = state.db.lock();
    let m = crate::db::ai_get_all_settings(&db).map_err(|e| e.to_string())?;
    if m.is_empty() {
        return Ok(AiSettings::default());
    }
    Ok(AiSettings {
        enabled: m.get("enabled").map(|s| s == "true").unwrap_or(false),
        provider: m.get("provider").cloned().unwrap_or_else(|| "openai".into()),
        api_key: m.get("api_key").cloned().unwrap_or_default(),
        model: m
            .get("model")
            .cloned()
            .unwrap_or_else(|| "gpt-4o-mini".into()),
        base_url: m.get("base_url").cloned().unwrap_or_default(),
    })
}

/// Persist AI settings to the workspace DB. Each field becomes one row in
/// `ai_settings` (upsert). After saving, the conversation memory is reset —
/// old context was for the old model/provider and should not leak in.
#[tauri::command]
pub fn ai_save_config(
    state: State<'_, crate::AppState>,
    settings: AiSettings,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        crate::db::ai_set_setting(&db, "enabled", if settings.enabled { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
        crate::db::ai_set_setting(&db, "provider", &settings.provider).map_err(|e| e.to_string())?;
        crate::db::ai_set_setting(&db, "api_key", &settings.api_key).map_err(|e| e.to_string())?;
        crate::db::ai_set_setting(&db, "model", &settings.model).map_err(|e| e.to_string())?;
        crate::db::ai_set_setting(&db, "base_url", &settings.base_url).map_err(|e| e.to_string())?;
    }
    // Reset conversation memory — config changed, old context invalid.
    state.agent.reset();
    Ok(())
}

/// Send a tiny "hi" request with the supplied settings (does NOT persist
/// them) and verify the provider responds. Used by the Settings UI's "Test
/// connection" button before the user commits to Save.
///
/// Returns Ok(message) on success where `message` describes what happened
/// ("ok — got 5 tokens"); Err(human-readable) on any failure.
#[tauri::command]
pub async fn ai_test_connection(settings: AiSettings) -> Result<String, String> {
    if !settings.enabled {
        return Err("Enable AI before testing.".into());
    }
    let cfg = load_config_from_settings(&settings)?;
    let provider = build_provider(&cfg).map_err(|e| e.to_string())?;

    let req = ChatRequest {
        model: cfg.model.clone(),
        messages: vec![ChatMessage::user("hi")],
        max_tokens: 5, // tiny to minimize cost
        temperature: None,
    };

    let mut stream = provider.stream(&req).await.map_err(|e| e.to_string())?;
    let mut got_tokens = 0u32;
    while let Some(ev) = stream.next().await {
        match ev {
            Ok(StreamEvent::Delta(_)) => {
                got_tokens += 1;
                if got_tokens >= 1 {
                    return Ok(format!("ok — provider responded (model: {})", cfg.model));
                }
            }
            Ok(StreamEvent::Finish { reason: _, usage: _ }) => {
                if got_tokens == 0 {
                    return Ok(format!("ok — connection works, but model returned no tokens ({})", cfg.model));
                }
                return Ok(format!("ok — provider responded (model: {})", cfg.model));
            }
            Ok(StreamEvent::ThoughtDelta(_)) => {}
            Ok(StreamEvent::Error(e)) => return Err(e.to_string()),
            Err(_) => return Err("stream error".into()),
        }
    }
    Ok(format!("ok — connection closed cleanly ({})", cfg.model))
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
