//! M10 P2-4 — Built-in agent tools.
//!
//! Tools the LLM can call to read/write the user's notes. Implementations
//! are ported from the v1 `mcp_server.rs` (now deleted) — same db layer,
//! same JSON shape, just without the JSON-RPC-over-stdio MCP envelope.
//! The agent loop in `mod.rs` calls `dispatch()` directly when the model
//! emits a tool_use block.
//!
//! Tool roster (mirrors v1):
//!   - list_pages(parentId?)           — read
//!   - get_page(pageId)                — read
//!   - search_pages(query, limit?)     — read
//!   - update_page(pageId, markdown)   — WRITE (agent loop asks user first)
//!   - list_databases(parentId?)       — read  (M10+ — table access)
//!   - query_database(databaseId)      — read  (M10+ — schema + rows)
//!
//! `is_write_tool()` lets the agent loop decide whether to emit
//! `ai-permission` and block on user approval before dispatching.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::provider::ToolSchema;

// =============================================================================
// Schema (offered to the LLM via ChatRequest.tools)
// =============================================================================

pub fn schemas() -> Vec<ToolSchema> {
    vec![
        ToolSchema {
            name: "list_pages".into(),
            description: "List Folio pages. Omit parentId (or null) for the workspace root; pass a page id to list its children. Returns [{id,title,type}] where type is 'page' or 'database'.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "parentId": { "type": "string", "description": "Parent page id; omit/null for workspace root." }
                }
            }),
        },
        ToolSchema {
            name: "get_page".into(),
            description: "Read a page's title, type, and text content by id. Use list_pages or search_pages first to find the id.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "pageId": { "type": "string" } },
                "required": ["pageId"]
            }),
        },
        ToolSchema {
            name: "search_pages".into(),
            description: "Full-text search across page titles and contents (FTS5). Returns matches with id, title, and a snippet.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "number", "description": "Max results (default 20)." }
                },
                "required": ["query"]
            }),
        },
        ToolSchema {
            name: "update_page".into(),
            description: "Replace a page's content with new Markdown. The markdown is converted into Folio's editor format. The previous content is auto-snapshotted (recoverable via Folio's page history). Use get_page first to read the current content before rewriting.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pageId": { "type": "string" },
                    "markdown": { "type": "string", "description": "The new full page content in Markdown." }
                },
                "required": ["pageId", "markdown"]
            }),
        },
        ToolSchema {
            name: "list_databases".into(),
            description: "List Folio databases (tables) in the workspace. Omit parentId for all databases workspace-wide, or pass a parent page id to scope to its children. Returns [{id,title}] — use query_database to read a database's schema and rows.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "parentId": { "type": "string", "description": "Optional parent page id; omit/null for all databases in the workspace." }
                }
            }),
        },
        ToolSchema {
            name: "query_database".into(),
            description: "Read a Folio database (table) by id. Returns its schema (property definitions: name, type, options) and all rows with their cell values. Use list_databases or list_pages first to find the id (type='database').".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "databaseId": { "type": "string" } },
                "required": ["databaseId"]
            }),
        },
    ]
}

/// Whether a tool modifies user data (vs. read-only). The agent loop uses
/// this to gate the call behind a user-approval prompt (`ai-permission`).
pub fn is_write_tool(name: &str) -> bool {
    matches!(name, "update_page")
}

// =============================================================================
// Dispatch (called by the agent loop after a tool_use arrives)
// =============================================================================
//
// Returns Ok(output_text) on success — the agent loop wraps that as a
// `ChatMessage::tool_result(id, output, is_error=false)` and pushes it
// into the conversation so the LLM can read the result.
//
// Returns Err(message) on failure — the agent loop wraps that as
// `tool_result(id, message, is_error=true)` so the model can self-correct.

pub fn dispatch(name: &str, args: &Value, conn: &Connection) -> Result<String, String> {
    match name {
        "list_pages" => tool_list_pages(conn, args),
        "get_page" => tool_get_page(conn, args),
        "search_pages" => tool_search_pages(conn, args),
        "update_page" => tool_update_page(conn, args),
        "list_databases" => tool_list_databases(conn, args),
        "query_database" => tool_query_database(conn, args),
        other => Err(format!("unknown tool: {other}")),
    }
}

fn tool_list_pages(conn: &Connection, args: &Value) -> Result<String, String> {
    let parent_id = args.get("parentId").and_then(|p| p.as_str());
    let pages = crate::db::list_pages(conn, parent_id).map_err(|e| e.to_string())?;
    let compact: Vec<Value> = pages
        .iter()
        .filter_map(|p| {
            let v = serde_json::to_value(p).ok()?;
            Some(json!({ "id": v["id"], "title": v["title"], "type": v["type"] }))
        })
        .collect();
    serde_json::to_string_pretty(&compact).map_err(|e| e.to_string())
}

fn tool_get_page(conn: &Connection, args: &Value) -> Result<String, String> {
    let page_id = args
        .get("pageId")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "pageId required".to_string())?;
    let (page, doc_json) = crate::db::fetch_page_with_doc(conn, page_id).map_err(|e| e.to_string())?;
    let doc: Value = serde_json::from_str(&doc_json).unwrap_or(Value::Null);
    let text = extract_text(&doc);
    let out = json!({
        "id": page.id,
        "title": page.title,
        "type": page.r#type,
        "content": text,
    });
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

fn tool_search_pages(conn: &Connection, args: &Value) -> Result<String, String> {
    let query = args
        .get("query")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "query required".to_string())?;
    let limit = args.get("limit").and_then(|p| p.as_i64()).unwrap_or(20);
    let hits = crate::db::search(conn, query, limit).map_err(|e| e.to_string())?;
    let compact: Vec<Value> = hits
        .iter()
        .filter_map(|h| {
            let v = serde_json::to_value(h).ok()?;
            // Tolerate camelCase (pageId) or snake_case (page_id) serialized form.
            let id = v
                .get("pageId")
                .or_else(|| v.get("page_id"))
                .cloned()
                .unwrap_or(Value::Null);
            Some(json!({ "id": id, "title": v["title"], "snippet": v["snippet"] }))
        })
        .collect();
    serde_json::to_string_pretty(&compact).map_err(|e| e.to_string())
}

fn tool_update_page(conn: &Connection, args: &Value) -> Result<String, String> {
    let page_id = args
        .get("pageId")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "pageId required".to_string())?;
    let markdown = args
        .get("markdown")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "markdown required".to_string())?;
    let page = crate::db::fetch_page(conn, page_id).map_err(|e| e.to_string())?;
    let doc_value = crate::import::markdown::convert(markdown).map_err(|e| e.to_string())?;
    let doc_json = serde_json::to_string(&doc_value).map_err(|e| e.to_string())?;
    crate::db::update_page_doc(conn, page_id, &doc_json).map_err(|e| e.to_string())?;
    Ok(format!(
        "Updated page '{}' (id={}). Previous content auto-snapshotted — revert via Folio's page history.",
        page.title, page_id
    ))
}

/// List database-typed pages. Optionally scoped to a parent. Reads the same
/// `list_pages` data and filters by `type == "database"` — no extra query.
fn tool_list_databases(conn: &Connection, args: &Value) -> Result<String, String> {
    let parent_id = args.get("parentId").and_then(|p| p.as_str());
    let pages = crate::db::list_pages(conn, parent_id).map_err(|e| e.to_string())?;
    let compact: Vec<Value> = pages
        .iter()
        .filter(|p| p.r#type == "database")
        .map(|p| json!({ "id": p.id, "title": p.title }))
        .collect();
    serde_json::to_string_pretty(&compact).map_err(|e| e.to_string())
}

/// Read a database's schema (property defs) and all rows with their cell values.
/// Output shape: `{ id, title, properties: [{id, name, type, options?}], rows: [{id, title, properties: {propId: value}}] }`.
fn tool_query_database(conn: &Connection, args: &Value) -> Result<String, String> {
    let database_id = args
        .get("databaseId")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "databaseId required".to_string())?;

    // Schema: properties + page meta. Reuse database::fetch_database which
    // validates type == "database" and returns properties + views. We only
    // need properties here (views are a UI concern).
    let db_struct = crate::database::fetch_database(conn, database_id).map_err(|e| e.to_string())?;
    let properties: Vec<Value> = db_struct
        .properties
        .iter()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "type": p.r#type,
                "options": p.options,
            })
        })
        .collect();

    // Rows: reuse database::query_database. Each row already has page info
    // flattened in (id, title) plus a `properties` map of propId -> JSON value.
    let rows_raw = crate::database::query_database(conn, database_id).map_err(|e| e.to_string())?;
    let rows: Vec<Value> = rows_raw
        .iter()
        .filter_map(|r| {
            let row_v = serde_json::to_value(r).ok()?;
            Some(json!({
                "id": row_v["id"],
                "title": row_v["title"],
                "properties": row_v.get("properties").cloned().unwrap_or(json!({})),
            }))
        })
        .collect();

    let out = json!({
        "id": db_struct.page.id,
        "title": db_struct.page.title,
        "properties": properties,
        "rows": rows,
        "rowCount": rows.len(),
    });
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

// =============================================================================
// ProseMirror text extraction (ported from v1 mcp_server.rs)
// =============================================================================

/// Walk a ProseMirror doc JSON and concatenate `text` leaves with newlines
/// between blocks. Used by `get_page` so the LLM sees readable plain text
/// instead of raw editor JSON.
fn extract_text(doc: &Value) -> String {
    let mut out = String::new();
    collect_text(doc, &mut out);
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out.trim().to_string()
}

fn collect_text(node: &Value, out: &mut String) {
    let ty = match node.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return,
    };
    if ty == "text" {
        if let Some(t) = node.get("text").and_then(|t| t.as_str()) {
            out.push_str(t);
        }
        return;
    }
    let is_block = matches!(
        ty,
        "paragraph" | "heading" | "codeBlock" | "listItem" | "blockquote" | "taskItem" | "table"
    );
    if is_block && !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_text(child, out);
        }
    }
    if is_block {
        out.push('\n');
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_cover_all_dispatched_tools() {
        let schemas = schemas();
        let names: Vec<&str> = schemas.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"list_pages"));
        assert!(names.contains(&"get_page"));
        assert!(names.contains(&"search_pages"));
        assert!(names.contains(&"update_page"));
        assert!(names.contains(&"list_databases"));
        assert!(names.contains(&"query_database"));
    }

    #[test]
    fn is_write_tool_only_flags_update_page() {
        assert!(is_write_tool("update_page"));
        assert!(!is_write_tool("list_pages"));
        assert!(!is_write_tool("get_page"));
        assert!(!is_write_tool("search_pages"));
        assert!(!is_write_tool("list_databases"));
        assert!(!is_write_tool("query_database"));
        assert!(!is_write_tool("unknown"));
    }

    #[test]
    fn dispatch_unknown_tool_errors() {
        let conn = open_test_db();
        let err = dispatch("does_not_exist", &json!({}), &conn).unwrap_err();
        assert!(err.contains("unknown tool"));
    }

    #[test]
    fn dispatch_get_page_missing_id_errors() {
        let conn = open_test_db();
        let err = dispatch("get_page", &json!({}), &conn).unwrap_err();
        assert!(err.contains("pageId required"));
    }

    #[test]
    fn dispatch_search_missing_query_errors() {
        let conn = open_test_db();
        let err = dispatch("search_pages", &json!({}), &conn).unwrap_err();
        assert!(err.contains("query required"));
    }

    #[test]
    fn dispatch_query_database_missing_id_errors() {
        let conn = open_test_db();
        let err = dispatch("query_database", &json!({}), &conn).unwrap_err();
        assert!(err.contains("databaseId required"));
    }

    #[test]
    fn list_databases_returns_only_database_typed_pages() {
        let conn = open_test_db();
        let out = dispatch("list_databases", &json!({}), &conn).unwrap();
        let parsed: Vec<Value> = serde_json::from_str(&out).unwrap();
        // The seed workspace has no databases, so this is an empty list.
        assert!(parsed.is_empty());
    }

    #[test]
    fn query_database_on_nonexistent_id_errors() {
        let conn = open_test_db();
        let err = dispatch("query_database", &json!({"databaseId": "no_such_id"}), &conn).unwrap_err();
        // fetch_database raises an error mentioning the id and/or type.
        assert!(!err.is_empty());
    }

    #[test]
    fn extract_text_walks_simple_doc() {
        let doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": "Hello world" }]
            }]
        });
        assert_eq!(extract_text(&doc), "Hello world");
    }

    #[test]
    fn extract_text_joins_blocks_with_newlines() {
        let doc = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "First" }] },
                { "type": "paragraph", "content": [{ "type": "text", "text": "Second" }] }
            ]
        });
        assert_eq!(extract_text(&doc), "First\nSecond");
    }

    /// Build a fresh in-memory SQLite with the Folio schema + a single test
    /// page. Lets the dispatch tests exercise real db calls without spinning
    /// up a workspace file.
    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::apply(&conn).unwrap();
        // Seed a workspace + page so list_pages / get_page have something
        // to return. Insert directly to avoid pulling in higher-level setup.
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO workspace (id, name, created_at, schema_version) VALUES (?1, ?2, ?3, 1)",
            rusqlite::params!["ws1", "test", now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO page (id, workspace_id, parent_id, parent_type, type, title, created_at, updated_at) \
             VALUES (?1, ?2, NULL, 'workspace', 'page', 'Test Page', ?3, ?3)",
            rusqlite::params!["p1", "ws1", now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO page_doc (page_id, doc, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![
                "p1",
                r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test content"}]}]}"#,
                now
            ],
        )
        .unwrap();
        conn
    }
}
