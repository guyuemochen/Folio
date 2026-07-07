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
                favorite, created_at, updated_at \
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
///
/// Per PRD §5.2.4: also creates an `auto` snapshot when (a) the doc content
/// differs from the most recent snapshot, AND (b) the most recent snapshot is
/// older than 5 seconds. The throttle check is one indexed lookup, so this
/// stays cheap on every save.
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

    // Auto-snapshot throttled to one every 5s per page (PRD §5.2.4).
    maybe_auto_snapshot(conn, page_id, doc, now)?;

    Ok(())
}

/// Snapshot the doc if (a) content differs from the latest snapshot AND
/// (b) the latest snapshot for this page is older than `AUTOSNAPSHOT_INTERVAL_MS`.
fn maybe_auto_snapshot(
    conn: &rusqlite::Connection,
    page_id: &str,
    doc: &str,
    now_ms: i64,
) -> Result<()> {
    const AUTOSNAPSHOT_INTERVAL_MS: i64 = 5_000;

    let latest: Option<(String, i64)> = conn
        .query_row(
            "SELECT content, created_at FROM page_snapshot \
             WHERE page_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![page_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .ok();

    let (same_content, recent_enough) = match latest {
        Some((content, ts)) => (content == doc, now_ms - ts < AUTOSNAPSHOT_INTERVAL_MS),
        None => (false, false),
    };
    if same_content || recent_enough {
        return Ok(());
    }

    // Pull the current page title (cheap indexed lookup) so the snapshot's
    // title field stays useful in the History UI.
    let title: String = conn
        .query_row(
            "SELECT COALESCE(title, '') FROM page WHERE id = ?1",
            params![page_id],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();

    create_snapshot(conn, page_id, doc, &title, "auto")?;
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

/// Restore a trashed page. Per PRD §5.2.4:
///   - if `parent_id` is null OR the parent itself is trashed, restore to
///     workspace root (parent_id = NULL, parent_type = 'workspace').
///   - otherwise restore to the original parent.
pub fn restore_page(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    // Look up the current parent and check whether it's still alive.
    let row: Option<(Option<String>, i64)> = conn
        .query_row(
            "SELECT p.parent_id, \
                    COALESCE((SELECT is_trashed FROM page WHERE id = p.parent_id), 1) \
             FROM page p WHERE p.id = ?1",
            params![page_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let needs_root_fallback = match row {
        // parent_id is NULL → already at root (rare, but possible) → safe to keep.
        Some((None, _)) => false,
        // parent exists and is not trashed → restore in place.
        Some((Some(_), 0)) => false,
        // parent is trashed or missing → restore to workspace root.
        _ => true,
    };

    let affected = if needs_root_fallback {
        conn.execute(
            "UPDATE page \
             SET is_trashed = 0, trashed_at = NULL, updated_at = ?1, \
                 parent_id = NULL, parent_type = 'workspace' \
             WHERE id = ?2",
            params![now, page_id],
        )?
    } else {
        conn.execute(
            "UPDATE page SET is_trashed = 0, trashed_at = NULL, updated_at = ?1 \
             WHERE id = ?2",
            params![now, page_id],
        )?
    };
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
///
/// M6 perf: uses `prepare_cached` so the planner pays the prepare cost once
/// per connection lifetime — sidebar tree expansion hits this on every click.
pub fn list_pages(
    conn: &rusqlite::Connection,
    parent_id: Option<&str>,
) -> Result<Vec<PageSummary>> {
    let rows: Vec<PageSummary> = match parent_id {
        Some(pid) => {
            let mut stmt = conn.prepare_cached(
                "SELECT id, title, icon, parent_id, parent_type, is_trashed, updated_at, favorite \
                 FROM page \
                 WHERE parent_id = ?1 AND is_trashed = 0 \
                 ORDER BY title ASC",
            )?;
            let iter = stmt.query_map(params![pid], map_page_summary)?;
            iter.collect::<std::result::Result<Vec<_>, _>>()?
        }
        None => {
            let mut stmt = conn.prepare_cached(
                "SELECT id, title, icon, parent_id, parent_type, is_trashed, updated_at, favorite \
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

    let mut stmt = conn.prepare_cached(
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
    // Column 7 (when present) is the favorite flag joined from `page.favorite`.
    // Older callers that don't select it fall back to false via get_or(false).
    let favorite_int: i64 = row.get(7).unwrap_or(0);
    Ok(PageSummary {
        id: row.get(0)?,
        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        icon: row.get(2)?,
        parent_id: row.get(3)?,
        parent_type: row.get(4)?,
        is_trashed: is_trashed_int != 0,
        updated_at: row.get(6)?,
        favorite: favorite_int != 0,
    })
}

fn map_page_full(row: &rusqlite::Row<'_>) -> rusqlite::Result<Page> {
    let full_width: i64 = row.get(8)?;
    let small_text: i64 = row.get(9)?;
    let is_archived: i64 = row.get(10)?;
    let is_trashed: i64 = row.get(11)?;
    let favorite: i64 = row.get(13)?;
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
        favorite: favorite != 0,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

// =============================================================================
// Trash (PRD §5.2.4)
// =============================================================================

/// A trashed page plus breadcrumb info (its parent's title, when present) for
/// the Trash view UI.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedPage {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub parent_type: String,
    pub parent_title: Option<String>,
    pub trashed_at: Option<i64>,
}

/// List all trashed pages (any depth), newest-trashed first.
pub fn list_trashed_pages(conn: &rusqlite::Connection) -> Result<Vec<TrashedPage>> {
    let mut stmt = conn.prepare_cached(
        "SELECT p.id, p.title, p.icon, p.parent_id, p.parent_type, \
                parent.title, p.trashed_at \
         FROM page p \
         LEFT JOIN page parent ON parent.id = p.parent_id \
         WHERE p.is_trashed = 1 \
         ORDER BY p.trashed_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TrashedPage {
            id: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            icon: row.get(2)?,
            parent_id: row.get(3)?,
            parent_type: row.get(4)?,
            parent_title: row.get(5)?,
            trashed_at: row.get(6)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

/// Hard-delete every trashed page older than `max_age_seconds`. Runs on every
/// app launch (PRD §5.2.4: "30-day auto-purge ... check-on-launch").
pub fn purge_old_trash(conn: &rusqlite::Connection, max_age_seconds: i64) -> Result<usize> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cutoff_ms = now_ms - (max_age_seconds * 1000);
    let affected = conn.execute(
        "DELETE FROM page WHERE is_trashed = 1 AND trashed_at IS NOT NULL AND trashed_at < ?1",
        params![cutoff_ms],
    )?;
    Ok(affected)
}

// =============================================================================
// Favorites (PRD §5.2.3)
// =============================================================================

/// Mark/unmark a page as favorite. Mirrors the change to both the `favorites`
/// table (source of truth for ordering) and the `page.favorite` denormalized
/// flag (cheap read for tree rows).
pub fn set_favorite(
    conn: &rusqlite::Connection,
    page_id: &str,
    is_favorite: bool,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    // Flip the denormalized flag.
    conn.execute(
        "UPDATE page SET favorite = ?1 WHERE id = ?2",
        params![if is_favorite { 1 } else { 0 }, page_id],
    )?;
    if is_favorite {
        // Append at the end of the favorites list (largest sort_order + 1).
        let max_order: f64 = conn
            .query_row("SELECT COALESCE(MAX(sort_order), 0) FROM favorites", [], |r| {
                r.get(0)
            })
            .unwrap_or(0.0);
        conn.execute(
            "INSERT OR IGNORE INTO favorites (page_id, sort_order, created_at) \
             VALUES (?1, ?2, ?3)",
            params![page_id, max_order + 1.0, now],
        )?;
    } else {
        conn.execute(
            "DELETE FROM favorites WHERE page_id = ?1",
            params![page_id],
        )?;
    }
    Ok(())
}

/// Return favorited pages ordered by their sort_order.
pub fn list_favorites(conn: &rusqlite::Connection) -> Result<Vec<PageSummary>> {
    let mut stmt = conn.prepare_cached(
        "SELECT p.id, p.title, p.icon, p.parent_id, p.parent_type, p.is_trashed, \
                p.updated_at, p.favorite \
         FROM favorites f \
         JOIN page p ON p.id = f.page_id \
         WHERE p.is_trashed = 0 \
         ORDER BY f.sort_order ASC",
    )?;
    let rows = stmt.query_map([], map_page_summary)?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

/// Rewrite favorites ordering from a client-supplied ordered id list.
/// Assigns fractional sort_order = index (1.0, 2.0, 3.0, ...).
pub fn reorder_favorites(
    conn: &rusqlite::Connection,
    ordered_page_ids: &[String],
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ordered_page_ids.iter().enumerate() {
        let order = (i as f64) + 1.0;
        tx.execute(
            "UPDATE favorites SET sort_order = ?1 WHERE page_id = ?2",
            params![order, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// =============================================================================
// Page snapshots / History (PRD §5.2.4)
// =============================================================================

/// One snapshot row.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSnapshot {
    pub id: String,
    pub page_id: String,
    pub content: String,
    pub title: String,
    pub source: String,
    pub created_at: i64,
}

/// Create a new snapshot for `page_id` and prune to the retention policy
/// (last 50 per page OR 30 days, whichever smaller).
pub fn create_snapshot(
    conn: &rusqlite::Connection,
    page_id: &str,
    content: &str,
    title: &str,
    source: &str,
) -> Result<PageSnapshot> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO page_snapshot (id, page_id, content, title, source, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, page_id, content, title, source, now],
    )?;
    prune_snapshots(conn, page_id)?;
    fetch_snapshot(conn, &id)
}

pub fn fetch_snapshot(
    conn: &rusqlite::Connection,
    snapshot_id: &str,
) -> Result<PageSnapshot> {
    let row = conn.query_row(
        "SELECT id, page_id, content, title, source, created_at \
         FROM page_snapshot WHERE id = ?1",
        params![snapshot_id],
        |r| {
            Ok(PageSnapshot {
                id: r.get(0)?,
                page_id: r.get(1)?,
                content: r.get(2)?,
                title: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                source: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )?;
    Ok(row)
}

/// List snapshots for a page, newest first.
pub fn list_snapshots(
    conn: &rusqlite::Connection,
    page_id: &str,
) -> Result<Vec<PageSnapshot>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, page_id, content, title, source, created_at \
         FROM page_snapshot WHERE page_id = ?1 \
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![page_id], |r| {
        Ok(PageSnapshot {
            id: r.get(0)?,
            page_id: r.get(1)?,
            content: r.get(2)?,
            title: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            source: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

/// Restore a snapshot: overwrite the page's current doc + bump updated_at.
/// The snapshot row itself is left intact (it stays in history).
pub fn restore_snapshot(
    conn: &rusqlite::Connection,
    snapshot_id: &str,
) -> Result<()> {
    let snap = fetch_snapshot(conn, snapshot_id)?;
    let now = chrono::Utc::now().timestamp_millis();
    let affected = conn.execute(
        "UPDATE page_doc SET doc = ?1, updated_at = ?2 WHERE page_id = ?3",
        params![snap.content, now, snap.page_id],
    )?;
    if affected == 0 {
        // page_doc missing — recreate it so the restore still takes effect.
        conn.execute(
            "INSERT INTO page_doc (page_id, doc, updated_at) VALUES (?1, ?2, ?3)",
            params![snap.page_id, snap.content, now],
        )?;
    }
    conn.execute(
        "UPDATE page SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![snap.title, now, snap.page_id],
    )?;
    Ok(())
}

/// Retention policy (PRD §5.2.4): keep the last 50 OR the last 30 days,
/// whichever is smaller in row count. Runs after every new snapshot.
fn prune_snapshots(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cutoff_ms = now_ms - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    // 1. Drop everything older than 30 days.
    conn.execute(
        "DELETE FROM page_snapshot WHERE page_id = ?1 AND created_at < ?2",
        params![page_id, cutoff_ms],
    )?;
    // 2. If more than 50 remain (within 30 days), keep newest 50.
    conn.execute(
        "DELETE FROM page_snapshot WHERE page_id = ?1 AND id NOT IN ( \
            SELECT id FROM page_snapshot WHERE page_id = ?2 \
            ORDER BY created_at DESC LIMIT 50 \
         )",
        params![page_id, page_id],
    )?;
    Ok(())
}
