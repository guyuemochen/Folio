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
pub mod storage;
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
    Usage,
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
    /// Active session id (row in `ai_session`). `None` until the user starts
    /// the first turn — `ai_send` creates a session lazily and stores its id
    /// here. `ai_load_session` overwrites it with the loaded session's id.
    pub current_session_id: Arc<Mutex<Option<String>>>,
    /// How many trailing messages in `messages` have already been written to
    /// `ai_message` for the current session. The persistence pass appends
    /// messages from this index onward after a turn. Reset on session switch.
    pub last_persisted_seq: Arc<std::sync::atomic::AtomicUsize>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
            busy: Arc::new(AtomicBool::new(false)),
            pending_permission: Arc::new(Mutex::new(None)),
            current_session_id: Arc::new(Mutex::new(None)),
            last_persisted_seq: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    /// Reset the conversation memory, drop any pending permission waiter,
    /// and clear the busy flag. Called by `ai_stop` and when the user
    /// changes provider/model in Settings.
    ///
    /// Does NOT clear `current_session_id` — stopping a turn mid-flight is
    /// not the same as leaving the session. Messages already persisted to
    /// the active session remain on disk; the user can keep talking.
    pub fn reset(&self) {
        self.messages.lock().clear();
        // Dropping the sender causes the receiver's await to return Err,
        // which `wait_for_permission` treats as a rejection — the agent
        // loop then posts a tool_result(is_error) and moves on.
        *self.pending_permission.lock() = None;
        self.busy.store(false, Ordering::SeqCst);
        self.last_persisted_seq.store(0, Ordering::SeqCst);
    }

    /// Reset everything including session tracking — used by `ai_new_session`
    /// and `ai_load_session` to clear the slate before switching context.
    pub fn reset_session(&self) {
        self.reset();
        *self.current_session_id.lock() = None;
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

    /// Lowercase id used in `ai_settings.provider` row + log output.
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
        eprintln!("[folio:ai] ai_send refused: another turn is in flight");
        return Err("AI busy — stop the current turn before sending another".into());
    }

    let prompt_preview: String = message.chars().take(80).collect();
    eprintln!(
        "[folio:ai] → ai_send: prompt={:?} ({} chars total)",
        prompt_preview,
        message.chars().count()
    );

    // Load config BEFORE touching conversation memory so a config error does
    // not corrupt state. If config fails, restore the busy flag.
    let cfg = {
        let db = state.db.lock();
        match load_config(&db) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[folio:ai] ✗ config load failed: {e}");
                state.agent.busy.store(false, Ordering::SeqCst);
                return Err(e);
            }
        }
    };

    // Log provider config (mask the API key — first 8 chars only).
    let masked_key: String = cfg.api_key.chars().take(8).collect();
    eprintln!(
        "[folio:ai] config: provider={} model={} base_url={} key={}… ({} chars)",
        cfg.provider_kind.as_str(),
        cfg.model,
        cfg.base_url,
        masked_key,
        cfg.api_key.chars().count()
    );

    let provider = match build_provider(&cfg) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[folio:ai] ✗ build_provider failed: {e}");
            state.agent.busy.store(false, Ordering::SeqCst);
            return Err(e.to_string());
        }
    };

    // Stage the user message into conversation memory.
    let user_msg = ChatMessage::user(message.clone());
    state.agent.messages.lock().push(user_msg.clone());
    let msg_count = state.agent.messages.lock().len();
    eprintln!("[folio:ai] conversation memory: {msg_count} messages staged");

    // Lazily create a session row if none is active yet. The title is the
    // first user message, truncated — same UX as ChatGPT and avoids empty
    // sessions cluttering storage when the user opens the panel and closes
    // it without sending.
    let now = chrono::Utc::now().timestamp_millis();
    let session_id = {
        let mut guard = state.agent.current_session_id.lock();
        match guard.clone() {
            Some(id) => id,
            None => {
                let title: String = message.chars().take(60).collect();
                let id = {
                    let db = state.db.lock();
                    storage::create_session(&db, &title, now)
                        .map_err(|e| {
                            eprintln!("[folio:ai] ✗ create_session failed: {e}");
                            e
                        })
                        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string())
                };
                *guard = Some(id.clone());
                eprintln!("[folio:ai] new ai_session created: id={id} title={title:?}");
                id
            }
        }
    };

    // Persist the user message immediately (so a crash mid-turn still leaves
    // the user's question on disk). seq = position in the in-memory vec
    // minus one (we just pushed it).
    {
        let db = state.db.lock();
        let seq = state.agent.last_persisted_seq.load(Ordering::SeqCst);
        if let Err(e) = storage::append_message(&db, &session_id, seq, &user_msg, now) {
            eprintln!("[folio:ai] persist user message failed (continuing): {e}");
        } else {
            state.agent.last_persisted_seq.store(seq + 1, Ordering::SeqCst);
        }
        // Touch updated_at so the session bubbles to the top of the list.
        let _ = storage::touch_session(&db, &session_id, now);
    }

    // Move ownership of provider + a clone of the shared Arcs into the
    // spawned task. The task resets `busy` on completion (success or error).
    let messages = state.agent.messages.clone();
    let busy = state.agent.busy.clone();
    let pending_permission = state.agent.pending_permission.clone();
    let last_persisted_seq = state.agent.last_persisted_seq.clone();
    let db = state.db.clone();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let result = run_agent_loop(
            &app_for_task,
            provider.as_ref(),
            &messages,
            &cfg,
            db.clone(),
            pending_permission,
            // Pass the busy Arc so the loop can detect mid-stream cancellation
            // (ai_stop resets busy to false → loop checks it and breaks).
            busy.clone(),
        )
        .await;
        let elapsed = started.elapsed();

        // After the turn, persist any new messages (assistant text, tool_use,
        // tool_result). We walk from last_persisted_seq to the current length.
        // This is best-effort — persistence failure doesn't fail the turn.
        let session_id_owned = session_id.clone();
        let new_seq = persist_pending(
            &db,
            &session_id_owned,
            &last_persisted_seq,
            &messages,
        );
        if new_seq.is_some() {
            let now = chrono::Utc::now().timestamp_millis();
            let conn = db.lock();
            let _ = storage::touch_session(&conn, &session_id_owned, now);
        }

        busy.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                eprintln!("[folio:ai] ← ai-done (turn took {:.2}s)", elapsed.as_secs_f64());
                let _ = app_for_task.emit("ai-done", ());
            }
            Err(e) => {
                eprintln!("[folio:ai] ← ai-error after {:.2}s: {e}", elapsed.as_secs_f64());
                let _ = app_for_task.emit("ai-error", e.to_string());
            }
        }
    });

    Ok(())
}

/// Walk `messages` from `last_persisted_seq` to the end, append each to the
/// session row, and bump the counter. Returns the new seq value (or `None`
/// if nothing was persisted). Best-effort — log + continue on error.
fn persist_pending(
    db: &Arc<Mutex<rusqlite::Connection>>,
    session_id: &str,
    last_persisted_seq: &Arc<std::sync::atomic::AtomicUsize>,
    messages: &Arc<Mutex<Vec<ChatMessage>>>,
) -> Option<usize> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut start = last_persisted_seq.load(Ordering::SeqCst);
    let snapshot: Vec<ChatMessage> = messages.lock().clone();
    if start >= snapshot.len() {
        return None;
    }
    let conn = db.lock();
    while start < snapshot.len() {
        if let Err(e) = storage::append_message(&conn, session_id, start, &snapshot[start], now) {
            eprintln!(
                "[folio:ai] persist message seq={start} failed (continuing): {e}"
            );
            // Stop trying further messages — keep the seq counter where it is
            // so the next attempt resumes from here.
            break;
        }
        start += 1;
    }
    last_persisted_seq.store(start, Ordering::SeqCst);
    Some(start)
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

// =============================================================================
// Session history commands
// =============================================================================
//
// The user can reopen past conversations. Sessions are persisted in
// `ai_session` (+ `ai_message`) so they survive app restarts. The agent
// state holds ONE active session at a time (`current_session_id`) — these
// commands manipulate that pointer plus the storage rows.

/// List all past sessions, most-recently-touched first. Each row includes a
/// message-count hint so the UI can show "(3)" or hide empty sessions.
#[tauri::command]
pub fn ai_list_sessions(state: State<'_, crate::AppState>) -> Result<Vec<storage::AiSessionSummary>, String> {
    let db = state.db.lock();
    storage::list_sessions(&db)
}

/// Load a session: reset conversation memory, replay the stored messages into
/// it, and remember the session id so subsequent `ai_send` calls append to it.
/// Refuses if a turn is currently in flight — switching mid-turn would lose
/// the in-flight assistant message.
#[tauri::command]
pub fn ai_load_session(
    state: State<'_, crate::AppState>,
    session_id: String,
) -> Result<storage::AiSessionWithMessages, String> {
    if state.agent.busy.load(Ordering::SeqCst) {
        return Err("cannot switch sessions while AI is responding".into());
    }
    let db = state.db.lock();
    let messages = storage::load_messages(&db, &session_id)?;
    // Find session row for the summary fields.
    let session: storage::AiSessionSummary = db
        .query_row(
            "SELECT id, title, created_at, updated_at, \
                    (SELECT COUNT(*) FROM ai_message m WHERE m.session_id = s.id) \
             FROM ai_session s WHERE id = ?1",
            rusqlite::params![&session_id],
            |row| {
                Ok(storage::AiSessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    message_count: row.get(4)?,
                })
            },
        )
        .map_err(|e| format!("session {session_id} not found: {e}"))?;

    // Rebuild in-memory conversation memory from stored messages. Skip rows
    // we can't parse rather than failing the whole load.
    let mut rebuilt: Vec<ChatMessage> = Vec::with_capacity(messages.len());
    for m in &messages {
        if let Some(msg) = storage::deserialize_message(&m.role, &m.content_json) {
            rebuilt.push(msg);
        }
    }
    drop(db);

    state.agent.reset_session();
    *state.agent.messages.lock() = rebuilt.clone();
    *state.agent.current_session_id.lock() = Some(session_id.clone());
    state
        .agent
        .last_persisted_seq
        .store(rebuilt.len(), Ordering::SeqCst);

    eprintln!(
        "[folio:ai] loaded session {session_id}: {} stored rows, {} rebuilt messages",
        messages.len(),
        rebuilt.len()
    );
    Ok(storage::AiSessionWithMessages { session, messages })
}

/// Forget the current session and start fresh — clears conversation memory
/// but does NOT persist a new session row (that happens lazily on the first
/// `ai_send`). Used by the panel's "New chat" button.
#[tauri::command]
pub fn ai_new_session(state: State<'_, crate::AppState>) -> Result<(), String> {
    if state.agent.busy.load(Ordering::SeqCst) {
        return Err("cannot start a new session while AI is responding".into());
    }
    state.agent.reset_session();
    Ok(())
}

/// Delete a session row (cascades to its messages). If the deleted session
/// is the currently active one, also clears the in-memory state so the
/// panel shows an empty conversation next.
#[tauri::command]
pub fn ai_delete_session(
    state: State<'_, crate::AppState>,
    session_id: String,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        storage::delete_session(&db, &session_id)?;
    }
    let is_current = state
        .agent
        .current_session_id
        .lock()
        .as_ref()
        .map(|id| id == &session_id)
        .unwrap_or(false);
    if is_current {
        state.agent.reset_session();
    }
    Ok(())
}

/// Rename a session. The frontend uses this for inline-edit of the title in
/// the session picker, and the backend uses it from `ai_send` to set the
/// initial title (no — `ai_send` writes the title directly via
/// `create_session`; this command is for user-driven renames only).
#[tauri::command]
pub fn ai_rename_session(
    state: State<'_, crate::AppState>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    let db = state.db.lock();
    storage::rename_session(&db, &session_id, &title, now)
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

/// Flip just the master-enable flag, without touching the rest of the config
/// or resetting conversation memory. Used by the Settings panel so the enable
/// checkbox persists immediately (matching the General tab's other toggles),
/// while the provider/key/model/baseUrl fields still go through the explicit
/// Save button (and its Test → Save workflow).
#[tauri::command]
pub fn ai_set_enabled(
    state: State<'_, crate::AppState>,
    enabled: bool,
) -> Result<(), String> {
    let db = state.db.lock();
    crate::db::ai_set_setting(&db, "enabled", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
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
    eprintln!(
        "[folio:ai] ai_test_connection: provider={} model={} base_url={} key={}…",
        settings.provider,
        settings.model,
        if settings.base_url.is_empty() { "(default)" } else { &settings.base_url },
        settings.api_key.chars().take(8).collect::<String>(),
    );
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
                    eprintln!(
                        "[folio:ai] ai_test_connection: ok after 1 token (model {})",
                        cfg.model
                    );
                    return Ok(format!("ok — provider responded (model: {})", cfg.model));
                }
            }
            Ok(StreamEvent::Finish { reason: _, usage: _ }) => {
                if got_tokens == 0 {
                    eprintln!(
                        "[folio:ai] ai_test_connection: ok but no tokens (model {})",
                        cfg.model
                    );
                    return Ok(format!(
                        "ok — connection works, but model returned no tokens ({})",
                        cfg.model
                    ));
                }
                eprintln!(
                    "[folio:ai] ai_test_connection: ok after Finish (model {})",
                    cfg.model
                );
                return Ok(format!("ok — provider responded (model: {})", cfg.model));
            }
            Ok(StreamEvent::ThoughtDelta(_)) => {}
            // ToolCall events shouldn't happen (req.tools is empty), but
            // drain them defensively so the match stays exhaustive.
            Ok(StreamEvent::ToolCallStart { .. })
            | Ok(StreamEvent::ToolCallDelta { .. })
            | Ok(StreamEvent::ToolCallEnd { .. }) => {}
            Ok(StreamEvent::Error(e)) => {
                eprintln!("[folio:ai] ai_test_connection: stream error: {e}");
                return Err(e.to_string());
            }
            Err(_) => {
                eprintln!("[folio:ai] ai_test_connection: double-wrapped error");
                return Err("stream error".into());
            }
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
    busy: Arc<AtomicBool>,
) -> Result<(), ProviderError> {
    const MAX_ITERATIONS: usize = 10;

    let tool_count = tools::schemas().len();
    eprintln!(
        "[folio:ai] agent loop start: {} messages in memory, {} tools available",
        messages.lock().len(),
        tool_count
    );

    for iteration in 1..=MAX_ITERATIONS {
        // Between-iterations cancel check: ai_stop resets busy → loop bails.
        // (The task's outer `.store(false)` at the end is skipped on this path
        // because it's already false — store-if-different is idempotent.)
        if !busy.load(Ordering::SeqCst) {
            eprintln!("[folio:ai] agent loop: cancelled by user before iteration {iteration}");
            return Ok(());
        }

        eprintln!("[folio:ai] iteration {iteration}/{MAX_ITERATIONS}");

        let req = ChatRequest {
            model: cfg.model.clone(),
            messages: messages.lock().clone(),
            max_tokens: cfg.max_tokens,
            temperature: cfg.temperature,
            tools: tools::schemas(),
            tool_choice: ToolChoice::Auto,
        };

        let stream_started = std::time::Instant::now();
        eprintln!(
            "[folio:ai]   → provider.stream(): model={} messages={} tools={}",
            cfg.model,
            req.messages.len(),
            req.tools.len()
        );
        let mut stream = provider.stream(&req).await?;
        eprintln!("[folio:ai]   ← stream opened");

        // Per-round accumulators.
        let mut text_buf = String::new();
        let mut thought_total_chars: usize = 0;
        let mut tool_calls: Vec<PendingToolCall> = Vec::new();
        let mut finish_reason: Option<FinishReason> = None;
        let mut finish_usage: Option<Usage> = None;

        while let Some(ev) = stream.next().await {
            // Mid-stream cancel check (user hit Stop). Drop the stream by
            // breaking — the underlying reqwest response + worker task get
            // released when the receiver goes out of scope.
            if !busy.load(Ordering::SeqCst) {
                eprintln!("[folio:ai]   ✗ cancelled mid-stream by user");
                return Ok(());
            }
            match ev {
                Ok(StreamEvent::Delta(text)) => {
                    text_buf.push_str(&text);
                    let _ = app.emit("ai-token", text);
                }
                Ok(StreamEvent::ThoughtDelta(text)) => {
                    thought_total_chars += text.chars().count();
                    let _ = app.emit("ai-thought", text);
                }
                Ok(StreamEvent::ToolCallStart { id, name }) => {
                    eprintln!(
                        "[folio:ai]   tool_call_start: id={id} name={name}"
                    );
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
                Ok(StreamEvent::ToolCallEnd { id }) => {
                    if let Some(tc) = tool_calls.iter().find(|t| t.id == id) {
                        eprintln!(
                            "[folio:ai]   tool_call_end: id={} args={} bytes",
                            tc.id,
                            tc.args_json.len()
                        );
                    }
                }
                Ok(StreamEvent::Finish { reason, usage }) => {
                    eprintln!(
                        "[folio:ai]   finish: reason={}{}",
                        reason.as_str(),
                        usage
                            .as_ref()
                            .map(|u| format!(
                                " usage=in:{}/out:{}",
                                u.input_tokens, u.output_tokens
                            ))
                            .unwrap_or_default()
                    );
                    finish_reason = Some(reason);
                    finish_usage = usage;
                }
                Ok(StreamEvent::Error(e)) => {
                    eprintln!("[folio:ai]   ✗ stream error: {e}");
                    return Err(e);
                }
                Err(_) => {
                    eprintln!("[folio:ai]   ✗ double-wrapped stream error");
                    return Err(ProviderError::Stream(
                        "unexpected double-wrapped stream error".into(),
                    ));
                }
            }
        }

        eprintln!(
            "[folio:ai]   stream drained in {:.2?}: {} text chars, {} thought chars, {} tool calls",
            stream_started.elapsed(),
            text_buf.chars().count(),
            thought_total_chars,
            tool_calls.len()
        );
        // Keep `usage` referenced even if no log above used it.
        let _ = finish_usage;

        let reason = finish_reason.unwrap_or(FinishReason::Stop);
        if reason != FinishReason::Tools || tool_calls.is_empty() {
            // End of turn — push the final assistant message (text only).
            if !text_buf.trim().is_empty() {
                let preview: String = text_buf.chars().take(120).collect();
                eprintln!(
                    "[folio:ai]   assistant text: {} chars, preview={:?}",
                    text_buf.chars().count(),
                    preview
                );
                messages.lock().push(ChatMessage::assistant_text(text_buf));
            } else {
                eprintln!("[folio:ai]   assistant text: empty");
            }
            eprintln!(
                "[folio:ai] agent loop: turn complete (reason={})",
                reason.as_str()
            );
            return Ok(());
        }

        // Tool round: build assistant message with text + tool_use blocks.
        eprintln!(
            "[folio:ai]   assistant requested {} tool call(s); executing…",
            tool_calls.len()
        );
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
                let pretty = serde_json::to_string_pretty(&args).unwrap_or_default();
                let preview: String = pretty.chars().take(500).collect();
                eprintln!(
                    "[folio:ai]   permission requested for write tool {} (args {} bytes)",
                    tc.name,
                    args.to_string().len()
                );
                let _ = app.emit(
                    "ai-permission",
                    serde_json::json!({
                        "title": format!("Allow AI to call {}?", tc.name),
                        "description": preview,
                    }),
                );
                let approved = wait_for_permission(&pending_permission).await;
                if !approved {
                    eprintln!(
                        "[folio:ai]   permission: REJECTED → tool_result(is_error) for id={}",
                        tc.id
                    );
                    messages
                        .lock()
                        .push(ChatMessage::tool_result(&tc.id, "user rejected", true));
                    continue;
                }
                eprintln!("[folio:ai]   permission: APPROVED");
            } else {
                let args_preview: String =
                    serde_json::to_string(&args).unwrap_or_default().chars().take(200).collect();
                eprintln!(
                    "[folio:ai]   dispatch read tool: {} args={}",
                    tc.name, args_preview
                );
            }

            // Dispatch (sync — MutexGuard dropped before any await).
            let dispatch_started = std::time::Instant::now();
            let result = {
                let guard = db.lock();
                tools::dispatch(&tc.name, &args, &guard)
            };
            let dispatch_elapsed = dispatch_started.elapsed();

            let (content, is_error) = match result {
                Ok(s) => (s, false),
                Err(e) => (e, true),
            };
            let content_preview: String = content.chars().take(200).collect();
            eprintln!(
                "[folio:ai]   tool result: id={} {} in {:.2?} ({} chars) preview={:?}",
                tc.id,
                if is_error { "ERROR" } else { "ok" },
                dispatch_elapsed,
                content.chars().count(),
                content_preview,
            );
            messages
                .lock()
                .push(ChatMessage::tool_result(&tc.id, &content, is_error));

            // Notify editor to refresh after a successful write.
            if tools::is_write_tool(&tc.name) && !is_error {
                eprintln!(
                    "[folio:ai]   folio:ai-content-changed emitted (write tool succeeded)"
                );
                let _ = app.emit("folio:ai-content-changed", ());
            }
        }
        // Loop continues → next provider.stream() with tool_results in messages.
    }

    eprintln!("[folio:ai] ✗ agent loop: exceeded max iterations ({MAX_ITERATIONS})");
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
    let started = std::time::Instant::now();
    // Receiver::await returns Err when the sender is dropped without sending.
    // Treat that as a rejection so the agent loop moves on with a tool_result
    // the model can react to.
    let result = rx.await.unwrap_or(false);
    eprintln!(
        "[folio:ai]   wait_for_permission: {} after {:.2?}",
        if result { "approved" } else { "rejected/cancelled" },
        started.elapsed()
    );
    result
}
