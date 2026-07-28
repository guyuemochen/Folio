//! M10 AI assistant (v2 built-in agent).
//!
//! Built-in replacement for the v1 opencode subprocess integration. The agent
//! loop lives entirely in the Folio Rust core — no external binaries, no ACP,
//! no MCP-over-stdio. LLM calls go directly over HTTPS (reqwest + rustls) and
//! stream tokens back to the frontend via Tauri events.
//!
//! Module layout:
//!   - `provider`  — Provider trait + ChatRequest/StreamEvent/ProviderError
//!   - `stream`    — SSE decoding helper (reqwest + eventsource-stream)
//!   - `openai`    — OpenAI chat/completions (also covers Ollama + custom
//!                   OpenAI-compatible endpoints via base_url override)
//!   - `anthropic` — Anthropic Messages API
//!   - `tools`     — built-in tools (list/get/search/update page)
//!
//! Frontend event contract (stable since v1; reused unchanged in v2):
//!   `ai-token`  (String)  — incremental assistant text
//!   `ai-thought`(String)  — incremental reasoning text (thinking models)
//!   `ai-tool`   (String)  — tool-call title
//!   `ai-done`   (())      — turn finished
//!   `ai-error`  (String)  — protocol/transport error
//!   `ai-permission` ({title,description}) — write-tool approval prompt
//!   `folio:ai-content-changed` (()) — write tool modified data.db

pub mod anthropic;
pub mod openai;
pub mod provider;
pub mod stream;
pub mod tools;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures::channel::oneshot;
use futures::StreamExt;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, State};

pub use provider::{
    Block, ChatMessage, ChatRequest, FinishReason, Provider, ProviderError, StreamEvent, ToolChoice,
};

// =============================================================================
// Conversation memory (per active session)
// =============================================================================

/// The agent's conversation memory: the rolling list of messages sent to /
/// received from the LLM. Stored in `AppState` so it survives across multiple
/// `ai_send` calls within a session. Reset by `ai_stop` or by changing
/// provider/model in Settings (context belongs to the old config).
///
/// Fields are wrapped in `Arc` so the spawned task that drives the LLM call
/// can hold its own reference without borrowing `AppState` (which lives
/// behind `tauri::State<'_, AppState>` and is not `'static`).
pub struct AgentState {
    /// In-memory chat history. Carries text + tool_use + tool_result blocks.
    pub messages: Arc<Mutex<Vec<ChatMessage>>>,
    /// Reentrancy guard: only one turn in flight at a time. The UI's send
    /// button also disables during a turn, but the backend guard is the
    /// source of truth (frontend state can race).
    pub busy: Arc<AtomicBool>,
    /// Pending write-tool approval. When the agent wants to call a write
    /// tool, it emits `ai-permission` and parks here until the user clicks
    /// Allow / Reject in the panel (which calls `ai_permission_respond`).
    /// One slot — only one tool asks at a time.
    pub pending_permission: Arc<Mutex<Option<oneshot::Sender<bool>>>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
            busy: Arc::new(AtomicBool::new(false)),
            pending_permission: Arc::new(Mutex::new(None)),
        }
    }

    /// Reset the conversation memory, drop any pending permission waiter,
    /// and clear the busy flag. Called by `ai_stop` and when the user
    /// changes provider/model in Settings.
    pub fn reset(&self) {
        self.messages.lock().clear();
        // Dropping the sender causes the receiver's await to return Err,
        // which `wait_for_permission` treats as a rejection — the agent
        // loop then posts a tool_result(is_error) and moves on.
        *self.pending_permission.lock() = None;
        self.busy.store(false, Ordering::SeqCst);
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Configuration (env-var fallback for dev + DB-backed Settings UI)
// =============================================================================
//
// `load_config` reads the `ai_settings` table; if no `enabled` row exists
// (first run / dev), it falls back to env vars so `OPENAI_API_KEY=... pnpm
// tauri dev` still works without touching Settings.
//
// Env vars (dev only):
//   OPENAI_API_KEY    — required (also reused for Anthropic in dev)
//   OPENAI_BASE_URL   — override endpoint
//   OPENAI_MODEL      — model id
//   AI_PROVIDER       — "openai" (default) | "anthropic" | "ollama" | "custom"
//   AI_MAX_TOKENS     — default 4096
//   AI_TEMPERATURE    — default 1.0

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
}

// =============================================================================
// Settings IO type (frontend <-> backend boundary)
// =============================================================================

/// Frontend-facing AI settings. Persisted in the `ai_settings` SQLite table
/// (one row per field, by name). Returned by `ai_get_config` and accepted by
/// `ai_save_config` / `ai_test_connection`.
///
/// `api_key` is stored plaintext for now; P4 will evaluate moving it to the
/// OS keyring (plan §7.1).
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
        ProviderKind::Anthropic => "https://api.anthropic.com",
        _ => "https://api.openai.com/v1",
    }
}

fn default_model(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Ollama => "llama3.1",
        ProviderKind::Anthropic => "claude-3-5-sonnet-latest",
        _ => "gpt-4o-mini",
    }
}

/// Build an `AiConfig` (internal) from an `AiSettings` (frontend). No IO —
/// pure conversion. Used by both `load_config` (after reading the DB) and
/// `ai_test_connection` (after receiving the form from the UI).
pub fn load_config_from_settings(s: &AiSettings) -> Result<AiConfig, String> {
    let provider_kind = ProviderKind::parse(&s.provider)?;

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

/// Read settings from the workspace DB. Falls back to env vars when the DB
/// has no `enabled` row (dev mode smoke test).
pub fn load_config(db: &rusqlite::Connection) -> Result<AiConfig, String> {
    let m = crate::db::ai_get_all_settings(db).map_err(|e| e.to_string())?;

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
/// OPENAI_MODEL / AI_PROVIDER (provider can be openai/anthropic/ollama/custom).
fn load_config_from_env() -> Result<AiConfig, String> {
    let provider_kind = ProviderKind::parse(&std::env::var("AI_PROVIDER").unwrap_or_default())?;

    // OPENAI_API_KEY is the env-var name even for Anthropic in dev mode —
    // historical, kept for P1 backwards compat. P3+ users configure via UI.
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

/// Construct a provider for the given config. P2 wires all three: OpenAI
/// (also covers Ollama + Custom via OpenAI-compatible endpoint), Anthropic.
pub fn build_provider(cfg: &AiConfig) -> Result<Box<dyn Provider>, ProviderError> {
    match cfg.provider_kind {
        ProviderKind::Openai | ProviderKind::Ollama | ProviderKind::Custom => Ok(Box::new(
            openai::OpenaiProvider::with_base_url(&cfg.base_url, &cfg.api_key),
        )),
        ProviderKind::Anthropic => Ok(Box::new(anthropic::AnthropicProvider::with_base_url(
            &cfg.base_url,
            &cfg.api_key,
        ))),
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

    // Move ownership of provider + a clone of the shared Arcs into the
    // spawned task. The task resets `busy` on completion (success or error).
    let messages = state.agent.messages.clone();
    let busy = state.agent.busy.clone();
    let pending_permission = state.agent.pending_permission.clone();
    let db = state.db.clone();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let result = run_agent_loop(
            &app_for_task,
            provider.as_ref(),
            &messages,
            &cfg,
            db,
            pending_permission,
        )
        .await;
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

/// Stop the assistant: reset conversation memory + clear the busy flag +
/// drop any pending permission waiter.
#[tauri::command]
pub fn ai_stop(state: State<'_, crate::AppState>) -> Result<(), String> {
    state.agent.reset();
    Ok(())
}

/// Respond to a pending write-tool approval request. The agent loop is
/// parked on the matching oneshot receiver; this command fulfills it.
/// Returns Err if no permission request is currently pending (user clicked
/// Allow/Reject on a stale UI, or the request already timed out / cancelled).
#[tauri::command]
pub fn ai_permission_respond(
    state: State<'_, crate::AppState>,
    approve: bool,
) -> Result<(), String> {
    let mut guard = state.agent.pending_permission.lock();
    match guard.take() {
        Some(tx) => {
            // Send error means the receiver was already dropped (agent loop
            // moved on, e.g. user hit Stop). Treat as no-op, not an error.
            let _ = tx.send(approve);
            Ok(())
        }
        None => Err("no pending permission request".into()),
    }
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
        // No tools — we just want to confirm the connection works.
        tools: vec![],
        tool_choice: ToolChoice::Auto,
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
                    return Ok(format!(
                        "ok — connection works, but model returned no tokens ({})",
                        cfg.model
                    ));
                }
                return Ok(format!("ok — provider responded (model: {})", cfg.model));
            }
            Ok(StreamEvent::ThoughtDelta(_)) => {}
            // ToolCall events shouldn't happen (req.tools is empty), but
            // drain them defensively so the match stays exhaustive.
            Ok(StreamEvent::ToolCallStart { .. })
            | Ok(StreamEvent::ToolCallDelta { .. })
            | Ok(StreamEvent::ToolCallEnd { .. }) => {}
            Ok(StreamEvent::Error(e)) => return Err(e.to_string()),
            Err(_) => return Err("stream error".into()),
        }
    }
    Ok(format!("ok — connection closed cleanly ({})", cfg.model))
}

// =============================================================================
// Agent loop (P2 — full multi-turn with tool calling)
// =============================================================================
//
// Loop:
//   1. Build ChatRequest with messages + tools::schemas().
//   2. Stream one provider round-trip; accumulate text + tool_call fragments.
//   3. On Finish { reason: Stop | Length | ContentFilter | Other } → push
//      assistant message, return Ok (caller emits `ai-done`).
//   4. On Finish { reason: Tools } → push assistant message with text + tool_use
//      blocks; execute each tool (write tools gated behind `ai-permission`);
//      push tool_result messages; loop back to step 1.
//   5. Hard cap at MAX_ITERATIONS to prevent runaway loops.

async fn run_agent_loop(
    app: &AppHandle,
    provider: &dyn Provider,
    messages: &Arc<Mutex<Vec<ChatMessage>>>,
    cfg: &AiConfig,
    db: Arc<Mutex<rusqlite::Connection>>,
    pending_permission: Arc<Mutex<Option<oneshot::Sender<bool>>>>,
) -> Result<(), ProviderError> {
    const MAX_ITERATIONS: usize = 10;

    for _ in 0..MAX_ITERATIONS {
        let req = ChatRequest {
            model: cfg.model.clone(),
            messages: messages.lock().clone(),
            max_tokens: cfg.max_tokens,
            temperature: cfg.temperature,
            tools: tools::schemas(),
            tool_choice: ToolChoice::Auto,
        };

        let mut stream = provider.stream(&req).await?;

        // Per-round accumulators.
        let mut text_buf = String::new();
        let mut tool_calls: Vec<PendingToolCall> = Vec::new();
        let mut finish_reason: Option<FinishReason> = None;

        while let Some(ev) = stream.next().await {
            match ev {
                Ok(StreamEvent::Delta(text)) => {
                    text_buf.push_str(&text);
                    let _ = app.emit("ai-token", text);
                }
                Ok(StreamEvent::ThoughtDelta(text)) => {
                    let _ = app.emit("ai-thought", text);
                }
                Ok(StreamEvent::ToolCallStart { id, name }) => {
                    let _ = app.emit("ai-tool", name.clone());
                    tool_calls.push(PendingToolCall {
                        id,
                        name,
                        args_json: String::new(),
                    });
                }
                Ok(StreamEvent::ToolCallDelta { id, partial_json }) => {
                    if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == id) {
                        tc.args_json.push_str(&partial_json);
                    }
                }
                Ok(StreamEvent::ToolCallEnd { id: _ }) => {
                    // Arguments complete for this tool; parsed when the loop
                    // executes the tool below. No event to emit here — the
                    // UI already saw `ai-tool` at ToolCallStart.
                }
                Ok(StreamEvent::Finish { reason, usage: _ }) => {
                    finish_reason = Some(reason);
                    // The provider emits Finish as the last event of its
                    // stream; keep draining to be safe.
                }
                Ok(StreamEvent::Error(e)) => return Err(e),
                Err(_) => {
                    return Err(ProviderError::Stream(
                        "unexpected double-wrapped stream error".into(),
                    ));
                }
            }
        }

        let reason = finish_reason.unwrap_or(FinishReason::Stop);
        if reason != FinishReason::Tools || tool_calls.is_empty() {
            // End of turn — push the final assistant message (text only).
            if !text_buf.trim().is_empty() {
                messages.lock().push(ChatMessage::assistant_text(text_buf));
            }
            return Ok(());
        }

        // Tool round: build assistant message with text + tool_use blocks.
        let mut blocks: Vec<Block> = Vec::new();
        if !text_buf.trim().is_empty() {
            blocks.push(Block::Text(text_buf));
        }
        for tc in &tool_calls {
            let input: serde_json::Value =
                serde_json::from_str(&tc.args_json).unwrap_or(serde_json::Value::Null);
            blocks.push(Block::ToolUse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input,
            });
        }
        messages.lock().push(ChatMessage::assistant_blocks(blocks));

        // Execute each tool call (write tools gated behind user approval).
        for tc in &tool_calls {
            let args: serde_json::Value =
                serde_json::from_str(&tc.args_json).unwrap_or(serde_json::Value::Null);

            // Write tool: ask the user first.
            if tools::is_write_tool(&tc.name) {
                let preview = serde_json::to_string_pretty(&args).unwrap_or_default();
                let preview: String = preview.chars().take(500).collect();
                let _ = app.emit(
                    "ai-permission",
                    serde_json::json!({
                        "title": format!("Allow AI to call {}?", tc.name),
                        "description": preview,
                    }),
                );
                let approved = wait_for_permission(&pending_permission).await;
                if !approved {
                    messages
                        .lock()
                        .push(ChatMessage::tool_result(&tc.id, "user rejected", true));
                    continue;
                }
            }

            // Dispatch (sync — MutexGuard dropped before any await).
            let result = {
                let guard = db.lock();
                tools::dispatch(&tc.name, &args, &guard)
            };
            let (content, is_error) = match result {
                Ok(s) => (s, false),
                Err(e) => (e, true),
            };
            messages
                .lock()
                .push(ChatMessage::tool_result(&tc.id, &content, is_error));

            // Notify editor to refresh after a successful write.
            if tools::is_write_tool(&tc.name) && !is_error {
                let _ = app.emit("folio:ai-content-changed", ());
            }
        }
        // Loop continues → next provider.stream() with tool_results in messages.
    }

    Err(ProviderError::Stream(
        "agent loop exceeded max iterations (10) — too many tool calls in one turn".into(),
    ))
}

/// One tool call being accumulated across streaming deltas.
struct PendingToolCall {
    id: String,
    name: String,
    /// Concatenated `partial_json` fragments from ToolCallDelta events.
    /// Parsed to `serde_json::Value` when the agent loop executes the tool.
    args_json: String,
}

/// Park until the user responds to an `ai-permission` prompt. Returns
/// `false` if the user rejects, or if the wait is cancelled (the sender
/// was dropped — e.g. the user hit Stop, which calls `agent.reset()` and
/// drops the sender).
async fn wait_for_permission(pending: &Arc<Mutex<Option<oneshot::Sender<bool>>>>) -> bool {
    let (tx, rx) = oneshot::channel();
    *pending.lock() = Some(tx);
    // Receiver::await returns Err when the sender is dropped without sending.
    // Treat that as a rejection so the agent loop moves on with a tool_result
    // the model can react to.
    rx.await.unwrap_or(false)
}
