//! AI conversation session persistence.
//!
//! Stores past conversations in the workspace DB (`ai_session` + `ai_message`
//! tables — see `schema.rs`) so the user can reopen them later. Each session
//! owns an ordered list of `ChatMessage`s; we serialize the provider-agnostic
//! message body to JSON and reconstruct it on load.
//!
//! The `provider::ChatMessage` / `Block` / `Role` types deliberately do NOT
//! derive Serialize/Deserialize (they exist for the wire-format boundary, not
//! for storage), so this module owns the conversion at the storage edge.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::provider::{Block, ChatMessage, MessageContent, Role};

// =============================================================================
// Stored row types (serialized across the Tauri command boundary)
// =============================================================================

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Message count in the session — cheap UI hint for "is this empty?".
    pub message_count: i64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStoredMessage {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub role: String,
    /// Provider-agnostic content JSON — same shape produced by
    /// `serialize_message_content`. The frontend reads only `text` /
    /// assistant text blocks for display; the rest is for round-tripping
    /// conversation memory on resume.
    pub content_json: Value,
    pub created_at: i64,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct AiSessionWithMessages {
    #[serde(flatten)]
    pub session: AiSessionSummary,
    pub messages: Vec<AiStoredMessage>,
}

// =============================================================================
// ChatMessage ↔ JSON
// =============================================================================

/// Render a `ChatMessage`'s content as a JSON value suitable for storage.
/// Inverse of [`deserialize_message`].
pub fn serialize_message(msg: &ChatMessage) -> (String, Value) {
    let role = match msg.role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    };
    let content = match &msg.content {
        MessageContent::Text(t) => json!({ "text": t }),
        MessageContent::Blocks(blocks) => json!({ "blocks": blocks.iter().map(serialize_block).collect::<Vec<_>>() }),
    };
    (role.to_string(), content)
}

fn serialize_block(b: &Block) -> Value {
    match b {
        Block::Text(t) => json!({ "type": "text", "text": t }),
        Block::ToolUse { id, name, input } => json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input,
        }),
        Block::ToolResult { tool_use_id, content, is_error } => json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": content,
            "is_error": is_error,
        }),
    }
}

/// Reconstruct a `ChatMessage` from its stored `(role, content_json)` form.
/// Returns `None` if the role string or content shape is unrecognized — the
/// caller treats that as "skip this row" rather than failing the whole load.
pub fn deserialize_message(role: &str, content: &Value) -> Option<ChatMessage> {
    let r = match role {
        "system" => Role::System,
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "tool" => Role::Tool,
        _ => return None,
    };
    let mc = if let Some(t) = content.get("text").and_then(|v| v.as_str()) {
        MessageContent::Text(t.to_string())
    } else if let Some(blocks_v) = content.get("blocks").and_then(|v| v.as_array()) {
        let mut blocks = Vec::with_capacity(blocks_v.len());
        for bv in blocks_v {
            let ty = bv.get("type").and_then(|v| v.as_str())?;
            let block = match ty {
                "text" => Block::Text(bv.get("text").and_then(|v| v.as_str())?.to_string()),
                "tool_use" => Block::ToolUse {
                    id: bv.get("id").and_then(|v| v.as_str())?.to_string(),
                    name: bv.get("name").and_then(|v| v.as_str())?.to_string(),
                    input: bv.get("input").cloned().unwrap_or(Value::Null),
                },
                "tool_result" => Block::ToolResult {
                    tool_use_id: bv.get("tool_use_id").and_then(|v| v.as_str())?.to_string(),
                    content: bv.get("content").and_then(|v| v.as_str())?.to_string(),
                    is_error: bv.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false),
                },
                other => {
                    eprintln!("[folio:ai:storage] skipping unknown block type {other}");
                    continue;
                }
            };
            blocks.push(block);
        }
        MessageContent::Blocks(blocks)
    } else {
        eprintln!("[folio:ai:storage] message content missing text/blocks — skipping");
        return None;
    };
    Some(ChatMessage { role: r, content: mc })
}

// =============================================================================
// Session CRUD
// =============================================================================

/// Insert a new session row. Returns the generated id.
pub fn create_session(conn: &Connection, title: &str, now: i64) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_session (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![&id, title, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Update session title and bump `updated_at`.
pub fn rename_session(conn: &Connection, session_id: &str, title: &str, now: i64) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE ai_session SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, session_id],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err(format!("session {session_id} not found"));
    }
    Ok(())
}

/// Touch `updated_at` after a turn so the session bubbles to the top of the list.
pub fn touch_session(conn: &Connection, session_id: &str, now: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE ai_session SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a session and (via ON DELETE CASCADE) its messages.
pub fn delete_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM ai_session WHERE id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// List sessions, most-recently-touched first.
pub fn list_sessions(conn: &Connection) -> Result<Vec<AiSessionSummary>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.created_at, s.updated_at, \
                    (SELECT COUNT(*) FROM ai_message m WHERE m.session_id = s.id) AS msg_count \
             FROM ai_session s \
             ORDER BY s.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AiSessionSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                message_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// =============================================================================
// Message persistence
// =============================================================================

/// Append one message at the end of a session. `seq` is provided by the caller
/// (the agent loop tracks it via `messages.len()` so seq matches in-memory order
/// — see `AgentState::last_persisted_seq`).
pub fn append_message(
    conn: &Connection,
    session_id: &str,
    seq: usize,
    msg: &ChatMessage,
    now: i64,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (role, content_json) = serialize_message(msg);
    let content_str = serde_json::to_string(&content_json).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_message (id, session_id, seq, role, content_json, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, session_id, seq as i64, &role, &content_str, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load all messages for a session, ordered by seq.
pub fn load_messages(conn: &Connection, session_id: &str) -> Result<Vec<AiStoredMessage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, seq, role, content_json, created_at \
             FROM ai_message WHERE session_id = ?1 ORDER BY seq ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id], |row| {
            let content_str: String = row.get(4)?;
            let content_json: Value = serde_json::from_str(&content_str).unwrap_or(Value::Null);
            Ok(AiStoredMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                seq: row.get(2)?,
                role: row.get(3)?,
                content_json,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_message_round_trips() {
        let original = ChatMessage::user("hello world");
        let (role, content) = serialize_message(&original);
        assert_eq!(role, "user");
        let restored = deserialize_message(&role, &content).expect("round trip");
        match restored.content {
            MessageContent::Text(t) => assert_eq!(t, "hello world"),
            _ => panic!("expected Text"),
        }
    }

    #[test]
    fn assistant_blocks_round_trip() {
        let original = ChatMessage::assistant_blocks(vec![
            Block::Text("thinking...".into()),
            Block::ToolUse {
                id: "tu_1".into(),
                name: "list_pages".into(),
                input: json!({}),
            },
        ]);
        let (role, content) = serialize_message(&original);
        assert_eq!(role, "assistant");
        let restored = deserialize_message(&role, &content).expect("round trip");
        match restored.content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 2);
                match &blocks[0] {
                    Block::Text(t) => assert_eq!(t, "thinking..."),
                    _ => panic!("expected Text block"),
                }
                match &blocks[1] {
                    Block::ToolUse { id, name, input } => {
                        assert_eq!(id, "tu_1");
                        assert_eq!(name, "list_pages");
                        assert_eq!(input, &json!({}));
                    }
                    _ => panic!("expected ToolUse block"),
                }
            }
            _ => panic!("expected Blocks"),
        }
    }

    #[test]
    fn tool_result_round_trip() {
        let original = ChatMessage::tool_result("tu_1", "[{id:1}]", false);
        let (role, content) = serialize_message(&original);
        assert_eq!(role, "tool");
        let restored = deserialize_message(&role, &content).expect("round trip");
        match restored.content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                match &blocks[0] {
                    Block::ToolResult { tool_use_id, content, is_error } => {
                        assert_eq!(tool_use_id, "tu_1");
                        assert_eq!(content, "[{id:1}]");
                        assert!(!is_error);
                    }
                    _ => panic!("expected ToolResult block"),
                }
            }
            _ => panic!("expected Blocks"),
        }
    }

    #[test]
    fn unknown_role_returns_none() {
        assert!(deserialize_message("alien", &json!({ "text": "x" })).is_none());
    }
}
