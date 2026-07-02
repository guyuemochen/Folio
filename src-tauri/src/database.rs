//! Database domain module (M3).
//!
//! "Database" in Folio is a special page (`page.type = 'database'`).
//! Its columns live in `database_property`, its rows are themselves pages
//! (`parent_type = 'database'`), and cell values live in `page_property`.
//!
//! This module exposes both:
//!   - Pure DB functions (in `ops`): callers pass the locked `Connection`.
//!   - Tauri command wrappers (in `commands`): wire ops to the frontend.

use crate::{Error, Page, PageSummary, Result};
use rusqlite::params;

// =============================================================================
// Domain types (serialized to the frontend)
// =============================================================================

/// One column definition of a database.
///
/// Mirrors PRD §8.1 `database_property` table.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDef {
    pub id: String,
    pub database_id: String,
    pub name: String,
    /// One of: title / rich_text / number / select / multi_select / status /
    /// date / person / checkbox / url / files.
    #[serde(rename = "type")]
    pub r#type: String,
    /// For select / multi_select / status: list of options.
    /// Stored as JSON string in DB.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<SelectOption>>,
    /// For number: 'integer' / 'decimal' / 'percent' / 'currency'.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    pub is_required: bool,
    pub order: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub value: String,
    pub color: String,
}

/// View configuration: filter / sort / group / layout / hidden cols.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewConfig {
    pub id: String,
    pub database_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: String,
    /// JSON-encoded filter tree (Op = 'and' | 'or' | 'compare').
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<serde_json::Value>,
    /// JSON-encoded sort array: [{ propertyId, direction: 'asc'|'desc' }].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<serde_json::Value>,
    /// JSON-encoded group: { propertyId }.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<serde_json::Value>,
    /// JSON-encoded hidden property ids: [propertyId].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden_properties: Option<serde_json::Value>,
    /// JSON-encoded column widths: { propertyId: pixels }.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_widths: Option<serde_json::Value>,
    pub is_default: bool,
    pub created_at: i64,
}

/// Database page + its schema + its views.
#[derive(serde::Serialize)]
pub struct DatabaseWithSchema {
    #[serde(flatten)]
    pub page: Page,
    pub properties: Vec<PropertyDef>,
    pub views: Vec<ViewConfig>,
    pub default_view_id: Option<String>,
}

/// A row in a database (= a page with its property values).
#[derive(serde::Serialize)]
pub struct DatabaseRow {
    #[serde(flatten)]
    pub page: PageSummary,
    /// Map of property_id -> raw JSON value (already parsed from string).
    /// For `title` property, value is a JSON string (the title text).
    pub properties: serde_json::Value,
}

// =============================================================================
// Input types (deserialized from the frontend)
// =============================================================================

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseInput {
    pub parent_id: Option<String>,
    pub parent_type: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPropertyInput {
    pub database_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(default)]
    pub options: Option<Vec<SelectOption>>,
    #[serde(default)]
    pub number_format: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePropertyInput {
    pub name: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<SelectOption>>,
    #[serde(default)]
    pub number_format: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCellInput {
    pub page_id: String,
    pub property_id: String,
    /// Already-JSON-encoded value (e.g. `"foo"` for text, `42` for number,
    /// `["tag1","tag2"]` for multi-select, `null` to clear).
    pub value: serde_json::Value,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateViewInput {
    pub database_id: String,
    pub name: String,
    #[serde(default = "default_view_type")]
    #[serde(rename = "type")]
    pub r#type: String,
}

fn default_view_type() -> String {
    "table".to_string()
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewInput {
    pub name: Option<String>,
    #[serde(default)]
    pub filter: Option<serde_json::Value>,
    #[serde(default)]
    pub sort: Option<serde_json::Value>,
    #[serde(default)]
    pub group: Option<serde_json::Value>,
    #[serde(default)]
    pub hidden_properties: Option<serde_json::Value>,
    #[serde(default)]
    pub column_widths: Option<serde_json::Value>,
}

// =============================================================================
// Database operations (pure functions on Connection)
// =============================================================================

/// Create a new database page. Initializes a default `title` property and a
/// default Table view.
pub fn create_database(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    parent_id: Option<&str>,
    parent_type: Option<&str>,
    name: Option<&str>,
) -> Result<DatabaseWithSchema> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let title = name.unwrap_or("Untitled database");
    let (parent_id_sql, parent_type_sql) = match parent_id {
        Some(pid) => (
            Some(pid.to_string()),
            parent_type.unwrap_or("page").to_string(),
        ),
        None => (None, "workspace".to_string()),
    };

    conn.execute(
        "INSERT INTO page \
         (id, workspace_id, parent_id, parent_type, type, title, icon, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, 'database', ?5, '🗃️', ?6, ?6)",
        params![&id, workspace_id, parent_id_sql, parent_type_sql, title, now],
    )?;

    // Empty doc (databases still get a doc field for description blocks under the table)
    conn.execute(
        "INSERT INTO page_doc (page_id, doc, updated_at) \
         VALUES (?1, '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}', ?2)",
        params![&id, now],
    )?;

    // Default `title` property
    let title_prop_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO database_property \
         (id, database_id, name, type, is_required, \"order\", created_at) \
         VALUES (?1, ?2, 'Name', 'title', 1, 0, ?3)",
        params![&title_prop_id, &id, now],
    )?;

    // Default Table view
    let view_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO database_view \
         (id, database_id, name, type, is_default, created_at) \
         VALUES (?1, ?2, 'Table', 'table', 1, ?3)",
        params![&view_id, &id, now],
    )?;

    fetch_database(conn, &id)
}

/// Fetch a database with its full schema.
pub fn fetch_database(
    conn: &rusqlite::Connection,
    database_id: &str,
) -> Result<DatabaseWithSchema> {
    let page = crate::db::fetch_page(conn, database_id)?;
    if page.r#type != "database" {
        return Err(Error::Other(format!(
            "page {} is not a database (type={})",
            database_id, page.r#type
        )));
    }
    let properties = list_properties(conn, database_id)?;
    let views = list_views(conn, database_id)?;
    let default_view_id = views.iter().find(|v| v.is_default).map(|v| v.id.clone());
    Ok(DatabaseWithSchema {
        page,
        properties,
        views,
        default_view_id,
    })
}

pub fn list_properties(
    conn: &rusqlite::Connection,
    database_id: &str,
) -> Result<Vec<PropertyDef>> {
    let mut stmt = conn.prepare(
        "SELECT id, database_id, name, type, options, number_format, \
                is_required, \"order\", created_at \
         FROM database_property WHERE database_id = ?1 ORDER BY \"order\" ASC",
    )?;
    let rows = stmt.query_map(params![database_id], map_property)?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

fn map_property(row: &rusqlite::Row<'_>) -> rusqlite::Result<PropertyDef> {
    let options_str: Option<String> = row.get(4)?;
    let options = options_str
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<SelectOption>>(s).ok());
    let is_required: i64 = row.get(6)?;
    Ok(PropertyDef {
        id: row.get(0)?,
        database_id: row.get(1)?,
        name: row.get(2)?,
        r#type: row.get(3)?,
        options,
        number_format: row.get(5)?,
        is_required: is_required != 0,
        order: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn add_property(conn: &rusqlite::Connection, input: AddPropertyInput) -> Result<PropertyDef> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    // Append after the highest existing order
    let max_order: Option<f64> = conn
        .query_row(
            "SELECT MAX(\"order\") FROM database_property WHERE database_id = ?1",
            params![&input.database_id],
            |row| row.get(0),
        )
        .ok();
    let next_order = max_order.unwrap_or(-1.0) + 1.0;
    let options_json = input
        .options
        .as_ref()
        .map(|o| serde_json::to_string(o).unwrap_or_else(|_| "[]".to_string()));

    conn.execute(
        "INSERT INTO database_property \
         (id, database_id, name, type, options, number_format, is_required, \"order\", created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        params![
            &id,
            &input.database_id,
            &input.name,
            &input.r#type,
            options_json,
            input.number_format.as_deref(),
            next_order,
            now,
        ],
    )?;

    list_properties(conn, &input.database_id)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| Error::NotFound(format!("property {}", id)))
}

pub fn update_property(
    conn: &rusqlite::Connection,
    property_id: &str,
    input: UpdatePropertyInput,
) -> Result<PropertyDef> {
    if let Some(name) = input.name.as_deref() {
        conn.execute(
            "UPDATE database_property SET name = ?1 WHERE id = ?2",
            params![name, property_id],
        )?;
    }
    if let Some(options) = input.options.as_ref() {
        let json = serde_json::to_string(options).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE database_property SET options = ?1 WHERE id = ?2",
            params![json, property_id],
        )?;
    }
    if let Some(fmt) = input.number_format.as_deref() {
        conn.execute(
            "UPDATE database_property SET number_format = ?1 WHERE id = ?2",
            params![fmt, property_id],
        )?;
    }

    let db_id: String = conn.query_row(
        "SELECT database_id FROM database_property WHERE id = ?1",
        params![property_id],
        |row| row.get(0),
    )?;
    list_properties(conn, &db_id)?
        .into_iter()
        .find(|p| p.id == property_id)
        .ok_or_else(|| Error::NotFound(format!("property {}", property_id)))
}

pub fn delete_property(conn: &rusqlite::Connection, property_id: &str) -> Result<()> {
    let affected =
        conn.execute(
            "DELETE FROM database_property WHERE id = ?1",
            params![property_id],
        )?;
    if affected == 0 {
        return Err(Error::NotFound(format!("property {}", property_id)));
    }
    Ok(())
}

// =============================================================================
// Rows
// =============================================================================

/// Add a new empty row to the database. Returns the row with empty property values.
pub fn add_database_row(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    database_id: &str,
) -> Result<DatabaseRow> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO page \
         (id, workspace_id, parent_id, parent_type, type, title, icon, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 'database', 'page', '', NULL, ?4, ?4)",
        params![&id, workspace_id, database_id, now],
    )?;
    conn.execute(
        "INSERT INTO page_doc (page_id, doc, updated_at) \
         VALUES (?1, '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}', ?2)",
        params![&id, now],
    )?;

    fetch_database_row(conn, &id)
}

/// Fetch a single database row (page summary + properties map).
pub fn fetch_database_row(
    conn: &rusqlite::Connection,
    page_id: &str,
) -> Result<DatabaseRow> {
    let summary = conn.query_row(
        "SELECT id, title, icon, parent_id, parent_type, is_trashed, updated_at \
         FROM page WHERE id = ?1",
        params![page_id],
        |row| {
            let is_trashed: i64 = row.get(5)?;
            Ok(PageSummary {
                id: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                icon: row.get(2)?,
                parent_id: row.get(3)?,
                parent_type: row.get(4)?,
                is_trashed: is_trashed != 0,
                updated_at: row.get(6)?,
            })
        },
    )?;

    let properties = load_row_properties(conn, page_id)?;
    Ok(DatabaseRow {
        page: summary,
        properties,
    })
}

/// Build a JSON object { propertyId: value } for a row.
fn load_row_properties(
    conn: &rusqlite::Connection,
    page_id: &str,
) -> Result<serde_json::Value> {
    let mut stmt = conn.prepare(
        "SELECT property_id, value FROM page_property WHERE page_id = ?1",
    )?;
    let rows = stmt.query_map(params![page_id], |row| {
        let pid: String = row.get(0)?;
        let v: Option<String> = row.get(1)?;
        Ok((pid, v))
    })?;
    let mut map = serde_json::Map::new();
    for row in rows {
        let (pid, v) = row?;
        let parsed: serde_json::Value = v
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);
        map.insert(pid, parsed);
    }
    Ok(serde_json::Value::Object(map))
}

/// Update a single cell. `value` is a JSON value already (string/number/array/null).
pub fn update_cell(conn: &rusqlite::Connection, input: UpdateCellInput) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let value_str = serde_json::to_string(&input.value)
        .map_err(|e| Error::Other(format!("encode value: {e}")))?;

    // Upsert
    let inserted = conn.execute(
        "INSERT INTO page_property (page_id, property_id, value) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(page_id, property_id) DO UPDATE SET value = ?3",
        params![&input.page_id, &input.property_id, &value_str],
    )?;
    if inserted == 0 {
        return Err(Error::NotFound(format!(
            "cell {} / {}",
            input.page_id, input.property_id
        )));
    }

    // If this is the title property, also update page.title for fast sidebar display
    let prop_type: Option<String> = conn
        .query_row(
            "SELECT type FROM database_property WHERE id = ?1",
            params![&input.property_id],
            |row| row.get(0),
        )
        .ok();
    if prop_type.as_deref() == Some("title") {
        if let Some(s) = input.value.as_str() {
            conn.execute(
                "UPDATE page SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![s, now, &input.page_id],
            )?;
        }
    } else {
        conn.execute(
            "UPDATE page SET updated_at = ?1 WHERE id = ?2",
            params![now, &input.page_id],
        )?;
    }
    Ok(())
}

pub fn delete_database_row(conn: &rusqlite::Connection, page_id: &str) -> Result<()> {
    // Soft-delete via trash_page; the row will then be filtered out by query_database
    crate::db::trash_page(conn, page_id)
}

/// List all non-trashed rows of a database with their property values.
pub fn query_database(
    conn: &rusqlite::Connection,
    database_id: &str,
) -> Result<Vec<DatabaseRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, icon, parent_id, parent_type, is_trashed, updated_at \
         FROM page \
         WHERE parent_id = ?1 AND parent_type = 'database' AND is_trashed = 0 \
         ORDER BY created_at ASC",
    )?;
    let row_ids: Vec<String> = stmt
        .query_map(params![database_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut out = Vec::with_capacity(row_ids.len());
    for id in row_ids {
        out.push(fetch_database_row(conn, &id)?);
    }
    Ok(out)
}

// =============================================================================
// Views
// =============================================================================

pub fn list_views(
    conn: &rusqlite::Connection,
    database_id: &str,
) -> Result<Vec<ViewConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, database_id, name, type, filter, sort, \"group\", \
                hidden_properties, column_widths, is_default, created_at \
         FROM database_view WHERE database_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![database_id], map_view)?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
}

fn map_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<ViewConfig> {
    let filter: Option<String> = row.get(4)?;
    let sort: Option<String> = row.get(5)?;
    let group: Option<String> = row.get(6)?;
    let hidden: Option<String> = row.get(7)?;
    let widths: Option<String> = row.get(8)?;
    let is_default: i64 = row.get(9)?;
    Ok(ViewConfig {
        id: row.get(0)?,
        database_id: row.get(1)?,
        name: row.get(2)?,
        r#type: row.get(3)?,
        filter: filter.and_then(|s| serde_json::from_str(&s).ok()),
        sort: sort.and_then(|s| serde_json::from_str(&s).ok()),
        group: group.and_then(|s| serde_json::from_str(&s).ok()),
        hidden_properties: hidden.and_then(|s| serde_json::from_str(&s).ok()),
        column_widths: widths.and_then(|s| serde_json::from_str(&s).ok()),
        is_default: is_default != 0,
        created_at: row.get(10)?,
    })
}

pub fn create_view(conn: &rusqlite::Connection, input: CreateViewInput) -> Result<ViewConfig> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO database_view (id, database_id, name, type, is_default, created_at) \
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![&id, &input.database_id, &input.name, &input.r#type, now],
    )?;
    list_views(conn, &input.database_id)?
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| Error::NotFound(format!("view {}", id)))
}

pub fn update_view(
    conn: &rusqlite::Connection,
    view_id: &str,
    input: UpdateViewInput,
) -> Result<ViewConfig> {
    if let Some(name) = input.name.as_deref() {
        conn.execute(
            "UPDATE database_view SET name = ?1 WHERE id = ?2",
            params![name, view_id],
        )?;
    }
    if let Some(filter) = input.filter.as_ref() {
        let json = serde_json::to_string(filter).unwrap_or_else(|_| "null".to_string());
        conn.execute(
            "UPDATE database_view SET filter = ?1 WHERE id = ?2",
            params![json, view_id],
        )?;
    }
    if let Some(sort) = input.sort.as_ref() {
        let json = serde_json::to_string(sort).unwrap_or_else(|_| "null".to_string());
        conn.execute(
            "UPDATE database_view SET sort = ?1 WHERE id = ?2",
            params![json, view_id],
        )?;
    }
    if let Some(group) = input.group.as_ref() {
        let json = serde_json::to_string(group).unwrap_or_else(|_| "null".to_string());
        conn.execute(
            "UPDATE database_view SET \"group\" = ?1 WHERE id = ?2",
            params![json, view_id],
        )?;
    }
    if let Some(hidden) = input.hidden_properties.as_ref() {
        let json = serde_json::to_string(hidden).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE database_view SET hidden_properties = ?1 WHERE id = ?2",
            params![json, view_id],
        )?;
    }
    if let Some(widths) = input.column_widths.as_ref() {
        let json = serde_json::to_string(widths).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "UPDATE database_view SET column_widths = ?1 WHERE id = ?2",
            params![json, view_id],
        )?;
    }

    let db_id: String = conn.query_row(
        "SELECT database_id FROM database_view WHERE id = ?1",
        params![view_id],
        |row| row.get(0),
    )?;
    list_views(conn, &db_id)?
        .into_iter()
        .find(|v| v.id == view_id)
        .ok_or_else(|| Error::NotFound(format!("view {}", view_id)))
}

pub fn delete_view(conn: &rusqlite::Connection, view_id: &str) -> Result<()> {
    let affected =
        conn.execute("DELETE FROM database_view WHERE id = ?1", params![view_id])?;
    if affected == 0 {
        return Err(Error::NotFound(format!("view {}", view_id)));
    }
    Ok(())
}
