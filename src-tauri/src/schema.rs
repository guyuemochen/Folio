//! SQLite schema definitions.
//!
//! Implements a subset of PRD §8.1 for the M1 milestone:
//! - `workspace`, `page`, `block`, `preference`, `schema_meta`
//! - Indexes on parent / workspace / trashed columns
//!
//! The full schema (database_property, page_property, database_view,
//! database_template, file, page_snapshot) will be added in M3 (Table view)
//! and M4 (Database). See PRD §8.1 for the complete picture.

use crate::Result;

/// Single source of truth for the M1 schema. Wrapped in `IF NOT EXISTS` so
/// it's safe to call on every startup.
const SCHEMA_SQL: &str = r#"
-- Workspace (MVP: singleton)
CREATE TABLE IF NOT EXISTS workspace (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1
);

-- Page (also covers databases: type='database' row stores schema in `properties`)
CREATE TABLE IF NOT EXISTS page (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id),
    parent_id    TEXT REFERENCES page(id),
    parent_type  TEXT NOT NULL CHECK (parent_type IN ('workspace', 'page', 'database')),
    type         TEXT NOT NULL CHECK (type IN ('page', 'database')),
    title        TEXT NOT NULL DEFAULT '',
    icon         TEXT,
    cover        TEXT,
    properties   TEXT,
    full_width   INTEGER NOT NULL DEFAULT 0,
    small_text   INTEGER NOT NULL DEFAULT 0,
    is_archived  INTEGER NOT NULL DEFAULT 0,
    is_trashed   INTEGER NOT NULL DEFAULT 0,
    trashed_at   INTEGER,
    created_at   INTEGER NOT NULL,
    created_by   TEXT NOT NULL DEFAULT 'local',
    updated_at   INTEGER NOT NULL,
    updated_by   TEXT NOT NULL DEFAULT 'local'
);

CREATE INDEX IF NOT EXISTS idx_page_parent    ON page(parent_id, parent_type);
CREATE INDEX IF NOT EXISTS idx_page_workspace ON page(workspace_id);
CREATE INDEX IF NOT EXISTS idx_page_trashed   ON page(is_trashed, trashed_at);

-- Block (each row = one Notion-like block)
-- `content` JSON uses the custom intermediate schema (PRD §8.4, decision Q1-B).
-- `order` uses fractional indexing for drag-reorder (M2).
CREATE TABLE IF NOT EXISTS block (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    parent_block_id TEXT REFERENCES block(id),
    type            TEXT NOT NULL,
    content         TEXT NOT NULL,
    props           TEXT NOT NULL DEFAULT '{}',
    "order"         REAL NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_block_page ON block(page_id, parent_block_id, "order");
CREATE INDEX IF NOT EXISTS idx_block_type ON block(page_id, type);

-- User preferences (Settings UI values, persisted as JSON)
CREATE TABLE IF NOT EXISTS preference (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Schema metadata (for future versioned migrations)
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- M2: page_doc stores the TipTap/ProseMirror document JSON for each page.
-- This is a pragmatic shortcut for M2 — one row per page, full doc stored as JSON.
-- The block-level schema (PRD §8.1 `block` table) remains defined and will be
-- populated in M3+ when we migrate to per-block storage for true incremental sync.
CREATE TABLE IF NOT EXISTS page_doc (
    page_id    TEXT PRIMARY KEY REFERENCES page(id) ON DELETE CASCADE,
    doc        TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
    updated_at INTEGER NOT NULL
);

-- M3: Database schema definition. One row per property (column) of a database.
-- `database_id` references a page row with type='database'.
CREATE TABLE IF NOT EXISTS database_property (
    id            TEXT PRIMARY KEY,
    database_id   TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,            -- 'title'/'rich_text'/'number'/'select'/'multi_select'/'status'/'date'/'person'/'checkbox'/'url'
    options       TEXT,                     -- JSON for select/multi_select/status: [{ value, color }]
    number_format TEXT,                     -- 'integer'/'decimal'/'percent'/'currency'
    is_required   INTEGER NOT NULL DEFAULT 0,
    "order"       REAL NOT NULL,
    created_at    INTEGER NOT NULL,
    UNIQUE(database_id, name)
);
CREATE INDEX IF NOT EXISTS idx_dbprop_db ON database_property(database_id, "order");

-- M3: Cell values. Each row = one (page, property) pair.
-- `page_id` references a page row whose parent_type='database'.
CREATE TABLE IF NOT EXISTS page_property (
    page_id     TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL REFERENCES database_property(id) ON DELETE CASCADE,
    value       TEXT,                       -- JSON, varies by property type
    PRIMARY KEY (page_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_pageprop_value ON page_property(property_id, value);

-- M3: Database view configuration (filter/sort/group/layout per view).
CREATE TABLE IF NOT EXISTS database_view (
    id                TEXT PRIMARY KEY,
    database_id       TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    name              TEXT NOT NULL DEFAULT 'Table',
    type              TEXT NOT NULL DEFAULT 'table',  -- 'table' (M3) / 'board' / 'calendar' / ... (later)
    filter            TEXT,               -- JSON
    sort              TEXT,               -- JSON
    "group"           TEXT,               -- JSON (quoted: group is a SQL keyword)
    hidden_properties TEXT,               -- JSON
    column_widths     TEXT,               -- JSON
    is_default        INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dbview_db ON database_view(database_id);

-- M3: Database row templates (deferred to M3.5 — schema only for now)
CREATE TABLE IF NOT EXISTS database_template (
    id                      TEXT PRIMARY KEY,
    database_id             TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    icon                    TEXT,
    default_property_values TEXT,           -- JSON
    content_blocks          TEXT,           -- JSON
    is_default              INTEGER NOT NULL DEFAULT 0,
    created_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dbtemplate_db ON database_template(database_id);

-- Seed schema_meta on first install
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('installed_at', strftime('%s','now'));

-- M4: Full-text search index (FTS5).
-- Indexes page titles + page_doc content. Triggers keep it in sync.
-- The content column stores the raw TipTap JSON string for now — JSON noise
-- like {"type":"paragraph"} does get indexed but search matches still work
-- because user-visible text lives as plain string values inside the JSON.
-- (M5+ may swap to json_extract-based text-only indexing.)
CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
    page_id UNINDEXED,
    title,
    content,
    tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Page triggers (title changes)
CREATE TRIGGER IF NOT EXISTS page_fts_ai AFTER INSERT ON page BEGIN
    INSERT INTO page_fts(page_id, title, content)
    VALUES (new.id, new.title, COALESCE((SELECT doc FROM page_doc WHERE page_id = new.id), ''));
END;
CREATE TRIGGER IF NOT EXISTS page_fts_ad AFTER DELETE ON page BEGIN
    DELETE FROM page_fts WHERE page_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS page_fts_au_title AFTER UPDATE OF title ON page BEGIN
    UPDATE page_fts SET title = new.title WHERE page_id = new.id;
END;

-- page_doc triggers (content changes)
CREATE TRIGGER IF NOT EXISTS page_fts_doc_ai AFTER INSERT ON page_doc BEGIN
    UPDATE page_fts SET content = new.doc WHERE page_id = new.page_id;
END;
CREATE TRIGGER IF NOT EXISTS page_fts_doc_au AFTER UPDATE OF doc ON page_doc BEGIN
    UPDATE page_fts SET content = new.doc WHERE page_id = new.page_id;
END;

-- Backfill: index any pages + docs that already exist (no-op on first install).
INSERT OR IGNORE INTO page_fts(page_id, title, content)
    SELECT p.id, p.title, COALESCE(d.doc, '')
    FROM page p
    LEFT JOIN page_doc d ON d.page_id = p.id
    WHERE p.is_trashed = 0 AND NOT EXISTS (
        SELECT 1 FROM page_fts f WHERE f.page_id = p.id
    );

-- M3: Page snapshots for History (PRD §5.2.4). One row per snapshot.
-- `content` stores the full TipTap doc JSON at the snapshot point.
-- `source` is 'auto' (debounced save) or 'manual' (user action).
CREATE TABLE IF NOT EXISTS page_snapshot (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,                 -- TipTap doc JSON
    title       TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshot_page ON page_snapshot(page_id, created_at DESC);

-- M3: Favorites (PRD §5.2.3 sidebar). One row per favorited page.
-- `sort_order` uses fractional indexing for drag-rearrange (matches block pattern).
CREATE TABLE IF NOT EXISTS favorites (
    page_id     TEXT PRIMARY KEY REFERENCES page(id) ON DELETE CASCADE,
    sort_order  REAL NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_favorites_order ON favorites(sort_order);
"#;

/// Apply the schema. Idempotent — safe to call on every startup.
///
/// After the base schema runs, lightweight in-place migrations are applied
/// (additive column additions wrapped in "ignore if exists" so re-running on
/// an already-migrated DB is a no-op). Existing data is never touched.
pub fn apply(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    apply_migrations(conn)?;
    Ok(())
}

/// Additive, idempotent column additions for tables that already exist on
/// older installs. Each statement is allowed to fail with "duplicate column"
/// — that just means the column was added on a previous launch.
fn apply_migrations(conn: &rusqlite::Connection) -> Result<()> {
    // M3: add `favorite` flag on page for quick "is this page favorited?"
    // checks without a join. The `favorites` table remains the source of
    // truth for ordering; this column is a denormalized boolean mirror.
    add_column_if_missing(conn, "page", "favorite", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

fn add_column_if_missing(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<()> {
    // PRAGMA table_info returns one row per column; match by name.
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let exists: bool = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|c| c == column);
    if !exists {
        conn.execute(&format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl), [])?;
    }
    Ok(())
}
