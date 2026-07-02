//! Database access layer.
//!
//! All SQL access goes through this module. The Connection itself is owned
//! by `AppState` (see `lib.rs`) and locked for the duration of each call.

use crate::{Error, Page, PageSummary, Result, Workspace};
use rusqlite::params;

// =============================================================================
// Workspace
// =============================================================================

/// Return the singleton workspace row, creating it on first launch.
pub fn get_or_create_workspace(conn: &rusqlite::Connection) -> Result<Workspace> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM workspace", [], |row| row.get(0))?;
    if count == 0 {
        let id = uuid::Uuid::new_v4().to_string();
        let name = "My Workspace".to_string();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO workspace (id, name, created_at, schema_version) \
             VALUES (?1, ?2, ?3, 1)",
            params![&id, &name, now],
        )?;
        return Ok(Workspace { id, name });
    }
    let ws = conn.query_row(
        "SELECT id, name FROM workspace LIMIT 1",
        [],
        |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        },
    )?;
    Ok(ws)
}

// =============================================================================
// Page CRUD
// =============================================================================

/// Create a new page under the given parent. If `parent_id` is None, the page
/// is created at the workspace root (`parent_type = 'workspace'`).
#[allow(clippy::too_many_arguments)]
pub fn create_page(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    parent_id: Option<&str>,
    parent_type: &str,
    title: Option<&str>,
    icon: Option<&str>,
) -> Result<Page> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let title = title.unwrap_or("");
    let page_type = "page";

    let (parent_id_sql, parent_type_normalized) = match parent_id {
        Some(pid) => (Some(pid.to_string()), parent_type.to_string()),
        None => (None, "workspace".to_string()),
    };

    conn.execute(
        "INSERT INTO page \
         (id, workspace_id, parent_id, parent_type, type, title, icon, \
          created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            &id,
            workspace_id,
            parent_id_sql,
            parent_type_normalized,
            page_type,
            title,
            icon,
            now,
        ],
    )?;

    // Initialize an empty doc for this page
    conn.execute(
        "INSERT INTO page_doc (page_id, doc, updated_at) \
         VALUES (?1, '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}', ?2)",
        params![&id, now],
    )?;

    fetch_page(conn, &id)
}

/// Fetch a single page by id. Returns NotFound if missing.
pub fn fetch_page(conn: &rusqlite::Connection, page_id: &str) -> Result<Page> {
    let page = conn.query_row(
        "SELECT id, workspace_id, parent_id, parent_type, type, title, icon, cover, \
                full_width, small_text, is_archived, is_trashed, trashed_at, \
                created_at, updated_at \
         FROM page WHERE id = ?1",
        params![page_id],
        map_page_full,
    )?;
    Ok(page)
}

/// Fetch a page along with its document JSON.
pub fn fetch_page_with_doc(
    conn: &rusqlite::Connection,
    page_id: &str,
) -> Result<(Page, String)> {
    let page = fetch_page(conn, page_id)?;
    let doc: String = conn.query_row(
        "SELECT doc FROM page_doc WHERE page_id = ?1",
        params![page_id],
        |row| row.get(0),
    )?;
    Ok((page, doc))
}

/// Update page metadata. Each `Option<T>` field is treated as:
/// - `None` → leave untouched
/// - `Some(value)` → update to value
/// For nullable columns (icon, cover), we use `Option<Option<T>>`:
/// - `None` → leave untouched
/// - `Some(None)` → set to NULL
/// - `Some(Some(v))` → set to v
pub fn update_page_meta(
    conn: &rusqlite::Connection,
    page_id: &str,
    title: Option<&str>,
    icon: Option<Option<&str>>,
    cover: Option<Option<&str>>,
) -> Result<Page> {
    let now = chrono::Utc::now().timestamp_millis();

    if let Some(t) = title {
        conn.execute(
            "UPDATE page SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, now, page_id],
        )?;
    }
    if let Some(icon_val) = icon {
        conn.execute(
            "UPDATE page SET icon = ?1, updated_at = ?2 WHERE id = ?3",
            params![icon_val, now, page_id],
        )?;
    }
    if let Some(cover_val) = cover {
        conn.execute(
            "UPDATE page SET cover = ?1, updated_at = ?2 WHERE id = ?3",
            params![cover_val, now, page_id],
        )?;
    }

    fetch_page(conn, page_id)
}

/// Persist the page document JSON. Called from frontend (debounced 200ms).
pub fn update_page_doc(
    conn: &rusqlite::Connection,
    page_id: &str,
    doc: &str,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let affected = conn.execute(
        "UPDATE page_doc SET doc = ?1, updated_at = ?2 WHERE page_id = ?3",
        params![doc, now, page_id],
    )?;
    if affected == 0 {
        return Err(Error::NotFound(format!("page_doc for page {}", page_id)));
    }
    // also bump page.updated_at so sidebar/list ordering stays correct
    conn.execute(
        "UPDATE page SET updated_at = ?1 WHERE id = ?2",
        params![now, page_id],
    )?;
    Ok(())
}

/// Soft-delete: move page to trash. The row stays in `page` with `is_trashed = 1`.
pub fn trash_page(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let affected = conn.execute(
        "UPDATE page SET is_trashed = 1, trashed_at = ?1, updated_at = ?1 \
         WHERE id = ?2",
        params![now, page_id],
    )?;
    if affected == 0 {
        return Err(Error::NotFound(format!("page {}", page_id)));
    }
    Ok(())
}

/// Restore a trashed page to its original parent.
pub fn restore_page(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let affected = conn.execute(
        "UPDATE page SET is_trashed = 0, trashed_at = NULL, updated_at = ?1 \
         WHERE id = ?2",
        params![now, page_id],
    )?;
    if affected == 0 {
        return Err(Error::NotFound(format!("page {}", page_id)));
    }
    Ok(())
}

/// Permanently delete a page (and its doc, via ON DELETE CASCADE).
pub fn delete_page_permanently(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    let affected = conn.execute("DELETE FROM page WHERE id = ?1", params![page_id])?;
    if affected == 0 {
        return Err(Error::NotFound(format!("page {}", page_id)));
    }
    Ok(())
}

/// List non-trashed child pages of a given parent. `parent_id = None` returns
/// workspace root pages.
pub fn list_pages(
    conn: &rusqlite::Connection,
    parent_id: Option<&str>,
) -> Result<Vec<PageSummary>> {
    let rows: Vec<PageSummary> = match parent_id {
        Some(pid) => {
            let mut stmt = conn.prepare(
                "SELECT id, title, icon, parent_id, parent_type, is_trashed, updated_at \
                 FROM page \
                 WHERE parent_id = ?1 AND is_trashed = 0 \
                 ORDER BY title ASC",
            )?;
            let iter = stmt.query_map(params![pid], map_page_summary)?;
            iter.collect::<std::result::Result<Vec<_>, _>>()?
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, title, icon, parent_id, parent_type, is_trashed, updated_at \
                 FROM page \
                 WHERE parent_id IS NULL AND parent_type = 'workspace' AND is_trashed = 0 \
                 ORDER BY title ASC",
            )?;
            let iter = stmt.query_map([], map_page_summary)?;
            iter.collect::<std::result::Result<Vec<_>, _>>()?
        }
    };
    Ok(rows)
}

// =============================================================================
// Search (M4 — FTS5)
// =============================================================================

/// A search hit, returned to the frontend.
#[derive(serde::Serialize)]
pub struct SearchHit {
    pub page_id: String,
    pub title: String,
    pub icon: Option<String>,
    pub parent_type: String,
    /// Snippet of matched content, with `...` around the match.
    /// Empty when only the title matched.
    pub snippet: String,
    /// bm25 rank — lower is better. Used as secondary sort key.
    pub rank: f64,
    /// Where the match occurred: 'title' or 'content'.
    pub matched_in: String,
}

/// Full-text search across page titles and contents.
///
/// The `query` is the user's raw input. We split on whitespace and AND the
/// terms (FTS5 default). For more relaxed matching the UI can offer OR mode
/// by prefixing terms with `OR`.
pub fn search(
    conn: &rusqlite::Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<SearchHit>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // FTS5 MATCH expression: wrap each term in quotes to escape special chars.
    // We AND all terms together (FTS5 implicit AND).
    let terms: Vec<String> = trimmed
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let match_expr = terms.join(" ");

    let mut stmt = conn.prepare(
        "SELECT \
            fts.page_id, \
            p.title, \
            p.icon, \
            p.parent_type, \
            COALESCE(snippet(page_fts, 1, '<mark>', '</mark>', '…', 12), ''), \
            COALESCE(snippet(page_fts, 2, '<mark>', '</mark>', '…', 18), ''), \
            bm25(page_fts), \
            CASE WHEN fts.title MATCH ?2 THEN 'title' ELSE 'content' END \
         FROM page_fts fts \
         JOIN page p ON p.id = fts.page_id \
         WHERE page_fts MATCH ?1 AND p.is_trashed = 0 \
         ORDER BY rank \
         LIMIT ?3",
    )?;

    let rows = stmt.query_map(params![&match_expr, &match_expr, limit], |row| {
        let title_snippet: String = row.get(4)?;
        let content_snippet: String = row.get(5)?;
        // Prefer the non-empty snippet. Title hits rank higher.
        let (snippet, matched_in) = if !title_snippet.is_empty()
            && (content_snippet.is_empty() || row.get::<_, String>(7)? == "title")
        {
            (title_snippet, "title".to_string())
        } else {
            (content_snippet, "content".to_string())
        };
        Ok(SearchHit {
            page_id: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            icon: row.get(2)?,
            parent_type: row.get(3)?,
            snippet,
            rank: row.get(6)?,
            matched_in,
        })
    })?;

    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

// =============================================================================
// Row mappers
// =============================================================================

fn map_page_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<PageSummary> {
    let is_trashed_int: i64 = row.get(5)?;
    Ok(PageSummary {
        id: row.get(0)?,
        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        icon: row.get(2)?,
        parent_id: row.get(3)?,
        parent_type: row.get(4)?,
        is_trashed: is_trashed_int != 0,
        updated_at: row.get(6)?,
    })
}

fn map_page_full(row: &rusqlite::Row<'_>) -> rusqlite::Result<Page> {
    let full_width: i64 = row.get(8)?;
    let small_text: i64 = row.get(9)?;
    let is_archived: i64 = row.get(10)?;
    let is_trashed: i64 = row.get(11)?;
    Ok(Page {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        parent_id: row.get(2)?,
        parent_type: row.get(3)?,
        r#type: row.get(4)?,
        title: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        icon: row.get(6)?,
        cover: row.get(7)?,
        full_width: full_width != 0,
        small_text: small_text != 0,
        is_archived: is_archived != 0,
        is_trashed: is_trashed != 0,
        trashed_at: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}
