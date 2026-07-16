//! Workspace registry — tracks all known workspaces (each = a folder with a
//! `data.db`) in a separate SQLite database at `{app_data_dir}/registry.db`.
//!
//! The registry is always open for the lifetime of the app. It stores the
//! list of registered workspaces and metadata (name, folder path, last opened).
//! The actual workspace data (pages, blocks, etc.) lives in each workspace's
//! own `data.db` file, opened on demand and hot-swappable at runtime.
//!
//! ## Id convention
//! The registry `id` is always identical to the `workspace.id` row inside that
//! workspace's own `data.db`. This keeps the 9 `get_or_create_workspace` callers
//! in `lib.rs` working unchanged — they re-read the active workspace's id, which
//! matches the registry entry.

use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::Result;

// =============================================================================
// Types
// =============================================================================

/// One registered workspace row. Serialized to the frontend as camelCase.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredWorkspace {
    pub id: String,
    pub name: String,
    /// Absolute, canonicalized path to the folder containing `data.db`.
    pub folder_path: String,
    /// SQLite filename inside the folder (almost always `data.db`).
    pub db_filename: String,
    pub created_at: i64,
    pub last_opened: i64,
}

// =============================================================================
// Schema
// =============================================================================

const REGISTRY_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS workspace_registry (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    folder_path   TEXT NOT NULL,
    db_filename   TEXT NOT NULL DEFAULT 'data.db',
    created_at    INTEGER NOT NULL,
    last_opened   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(folder_path, db_filename)
);

CREATE TABLE IF NOT EXISTS registry_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO registry_meta (key, value) VALUES ('migrated', '0');
"#;

/// Apply the registry schema. Idempotent.
pub fn apply_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(REGISTRY_SCHEMA)?;
    Ok(())
}

// =============================================================================
// CRUD
// =============================================================================

/// List all registered workspaces, ordered by most-recently-opened first.
pub fn list_workspaces(conn: &Connection) -> Result<Vec<RegisteredWorkspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, folder_path, db_filename, created_at, last_opened \
         FROM workspace_registry ORDER BY last_opened DESC",
    )?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

/// Look up a workspace by id.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<RegisteredWorkspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, folder_path, db_filename, created_at, last_opened \
         FROM workspace_registry WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Look up a workspace by canonicalized folder path + db filename (dedupe guard).
pub fn get_by_path(conn: &Connection, folder_path: &str, db_filename: &str) -> Result<Option<RegisteredWorkspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, folder_path, db_filename, created_at, last_opened \
         FROM workspace_registry WHERE folder_path = ?1 AND db_filename = ?2",
    )?;
    let mut rows = stmt.query_map(params![folder_path, db_filename], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Insert a new workspace entry.
pub fn insert(conn: &Connection, ws: &RegisteredWorkspace) -> Result<()> {
    conn.execute(
        "INSERT INTO workspace_registry (id, name, folder_path, db_filename, created_at, last_opened) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![ws.id, ws.name, ws.folder_path, ws.db_filename, ws.created_at, ws.last_opened],
    )?;
    Ok(())
}

/// Rename a workspace in the registry.
pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let affected = conn.execute(
        "UPDATE workspace_registry SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    if affected == 0 {
        return Err(crate::Error::NotFound(format!("workspace {id}")));
    }
    Ok(())
}

/// Update the folder path of a workspace (used by Move).
pub fn update_path(conn: &Connection, id: &str, new_folder_path: &str) -> Result<()> {
    let affected = conn.execute(
        "UPDATE workspace_registry SET folder_path = ?1 WHERE id = ?2",
        params![new_folder_path, id],
    )?;
    if affected == 0 {
        return Err(crate::Error::NotFound(format!("workspace {id}")));
    }
    Ok(())
}

/// Remove a workspace from the registry (does NOT delete files on disk).
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let affected = conn.execute("DELETE FROM workspace_registry WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(crate::Error::NotFound(format!("workspace {id}")));
    }
    Ok(())
}

/// Mark a workspace as most-recently-opened (updates `last_opened` timestamp).
pub fn touch_last_opened(conn: &Connection, id: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE workspace_registry SET last_opened = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

/// Return the most-recently-opened workspace, or None if the registry is empty.
pub fn get_last_opened(conn: &Connection) -> Result<Option<RegisteredWorkspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, folder_path, db_filename, created_at, last_opened \
         FROM workspace_registry ORDER BY last_opened DESC LIMIT 1",
    )?;
    let mut rows = stmt.query_map([], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Count registered workspaces.
#[allow(dead_code)]
pub fn count(conn: &Connection) -> Result<i64> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM workspace_registry", [], |r| r.get(0))?;
    Ok(n)
}

// =============================================================================
// Migration flag
// =============================================================================

/// Whether the legacy single-DB migration has already run.
pub fn is_migrated(conn: &Connection) -> Result<bool> {
    let value: String = conn
        .query_row(
            "SELECT value FROM registry_meta WHERE key = 'migrated'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());
    Ok(value == "1")
}

/// Mark the legacy migration as done.
pub fn mark_migrated(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO registry_meta (key, value) VALUES ('migrated', '1')",
        [],
    )?;
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

/// Resolve the full path to a workspace's data.db file.
pub fn db_file_path(ws: &RegisteredWorkspace) -> PathBuf {
    PathBuf::from(&ws.folder_path).join(&ws.db_filename)
}

/// Canonicalize a folder path for deduplication. Falls back to the original
/// string if canonicalization fails (e.g. the folder doesn't exist yet).
pub fn canonicalize_folder(path: &str) -> String {
    std::fs::canonicalize(path)
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .unwrap_or_else(|| path.to_string())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RegisteredWorkspace> {
    Ok(RegisteredWorkspace {
        id: row.get(0)?,
        name: row.get(1)?,
        folder_path: row.get(2)?,
        db_filename: row.get(3)?,
        created_at: row.get(4)?,
        last_opened: row.get(5)?,
    })
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn
    }

    fn make_ws(id: &str, name: &str, path: &str) -> RegisteredWorkspace {
        RegisteredWorkspace {
            id: id.to_string(),
            name: name.to_string(),
            folder_path: path.to_string(),
            db_filename: "data.db".to_string(),
            created_at: 1000,
            last_opened: 0,
        }
    }

    #[test]
    fn insert_and_get_by_id() {
        let conn = in_memory();
        let ws = make_ws("ws1", "My Workspace", "/tmp/ws1");
        insert(&conn, &ws).unwrap();
        let got = get_by_id(&conn, "ws1").unwrap().unwrap();
        assert_eq!(got.name, "My Workspace");
        assert_eq!(got.folder_path, "/tmp/ws1");
    }

    #[test]
    fn get_by_id_missing_returns_none() {
        let conn = in_memory();
        assert!(get_by_id(&conn, "nope").unwrap().is_none());
    }

    #[test]
    fn get_by_path_dedupes() {
        let conn = in_memory();
        let ws = make_ws("ws1", "W1", "/tmp/ws1");
        insert(&conn, &ws).unwrap();
        let dup = get_by_path(&conn, "/tmp/ws1", "data.db").unwrap();
        assert!(dup.is_some());
        assert_eq!(dup.unwrap().id, "ws1");
    }

    #[test]
    fn rename_updates_name() {
        let conn = in_memory();
        insert(&conn, &make_ws("ws1", "Old", "/tmp/ws1")).unwrap();
        rename(&conn, "ws1", "New").unwrap();
        let got = get_by_id(&conn, "ws1").unwrap().unwrap();
        assert_eq!(got.name, "New");
    }

    #[test]
    fn rename_missing_errors() {
        let conn = in_memory();
        assert!(rename(&conn, "nope", "x").is_err());
    }

    #[test]
    fn delete_removes_entry() {
        let conn = in_memory();
        insert(&conn, &make_ws("ws1", "W1", "/tmp/ws1")).unwrap();
        delete(&conn, "ws1").unwrap();
        assert!(get_by_id(&conn, "ws1").unwrap().is_none());
    }

    #[test]
    fn touch_last_opened_updates_timestamp() {
        let conn = in_memory();
        insert(&conn, &make_ws("ws1", "W1", "/tmp/ws1")).unwrap();
        touch_last_opened(&conn, "ws1").unwrap();
        let got = get_by_id(&conn, "ws1").unwrap().unwrap();
        assert!(got.last_opened > 0);
    }

    #[test]
    fn get_last_opened_returns_most_recent() {
        let conn = in_memory();
        let mut ws1 = make_ws("ws1", "W1", "/tmp/ws1");
        ws1.last_opened = 100;
        let mut ws2 = make_ws("ws2", "W2", "/tmp/ws2");
        ws2.last_opened = 200;
        insert(&conn, &ws1).unwrap();
        insert(&conn, &ws2).unwrap();
        let last = get_last_opened(&conn).unwrap().unwrap();
        assert_eq!(last.id, "ws2");
    }

    #[test]
    fn list_orders_by_last_opened_desc() {
        let conn = in_memory();
        let mut ws1 = make_ws("ws1", "W1", "/tmp/ws1");
        ws1.last_opened = 100;
        let mut ws2 = make_ws("ws2", "W2", "/tmp/ws2");
        ws2.last_opened = 300;
        let mut ws3 = make_ws("ws3", "W3", "/tmp/ws3");
        ws3.last_opened = 200;
        insert(&conn, &ws1).unwrap();
        insert(&conn, &ws2).unwrap();
        insert(&conn, &ws3).unwrap();
        let list = list_workspaces(&conn).unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].id, "ws2"); // 300
        assert_eq!(list[1].id, "ws3"); // 200
        assert_eq!(list[2].id, "ws1"); // 100
    }

    #[test]
    fn update_path_changes_folder() {
        let conn = in_memory();
        insert(&conn, &make_ws("ws1", "W1", "/tmp/old")).unwrap();
        update_path(&conn, "ws1", "/tmp/new").unwrap();
        let got = get_by_id(&conn, "ws1").unwrap().unwrap();
        assert_eq!(got.folder_path, "/tmp/new");
    }

    #[test]
    fn migration_flag_roundtrip() {
        let conn = in_memory();
        assert!(!is_migrated(&conn).unwrap());
        mark_migrated(&conn).unwrap();
        assert!(is_migrated(&conn).unwrap());
    }

    #[test]
    fn count_returns_zero_on_empty() {
        let conn = in_memory();
        assert_eq!(count(&conn).unwrap(), 0);
    }

    #[test]
    fn unique_constraint_blocks_duplicate_path() {
        let conn = in_memory();
        insert(&conn, &make_ws("ws1", "W1", "/tmp/ws1")).unwrap();
        // Same path, different id — should fail on UNIQUE(folder_path, db_filename).
        let result = insert(&conn, &make_ws("ws2", "W2", "/tmp/ws1"));
        assert!(result.is_err());
    }
}
