//! Folio Rust core.
//!
//! Entry point invoked by Tauri. Owns the SQLite connection and exposes
//! commands to the frontend.

use parking_lot::Mutex;
use rusqlite::Connection;
use std::sync::Arc;
use tauri::{Manager, State};

mod db;
mod database;
mod schema;

/// Unified error type for all backend commands. Serializes as a string
/// so the frontend gets a readable error message via `invoke()`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("db error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

// =============================================================================
// Domain types (serialized to the frontend)
// =============================================================================

/// The single workspace row (MVP: only one workspace per app instance).
#[derive(serde::Serialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

/// A flattened page summary used in sidebar/lists.
#[derive(serde::Serialize)]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub parent_type: String,
    pub is_trashed: bool,
    pub updated_at: i64,
}

/// Full page row. Used when opening a page for editing.
#[derive(serde::Serialize)]
pub struct Page {
    pub id: String,
    pub workspace_id: String,
    pub parent_id: Option<String>,
    pub parent_type: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub title: String,
    pub icon: Option<String>,
    pub cover: Option<String>,
    pub full_width: bool,
    pub small_text: bool,
    pub is_archived: bool,
    pub is_trashed: bool,
    pub trashed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Page plus its TipTap document JSON.
#[derive(serde::Serialize)]
pub struct PageWithDoc {
    #[serde(flatten)]
    pub page: Page,
    pub doc: String,
}

/// Input for `create_page`. `parent_id = None` creates at workspace root.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePageInput {
    pub parent_id: Option<String>,
    /// workspace | page | database (defaults to workspace when parent_id is None)
    pub parent_type: Option<String>,
    pub title: Option<String>,
    pub icon: Option<String>,
}

/// Input for `update_page_meta`. Each field is optional; None means "leave alone".
/// For nullable columns (icon, cover), `Some(None)` sets the column to NULL.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePageMetaInput {
    pub title: Option<String>,
    pub icon: Option<Option<String>>,
    pub cover: Option<Option<String>>,
}

// =============================================================================
// App state
// =============================================================================

/// App-wide state shared across Tauri commands. The SQLite connection is
/// behind a Mutex because Tauri commands run on a multi-threaded async runtime.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
fn get_workspace(state: State<'_, AppState>) -> Result<Workspace> {
    let db = state.db.lock();
    db::get_or_create_workspace(&db)
}

#[tauri::command]
fn list_pages(
    state: State<'_, AppState>,
    parent_id: Option<String>,
) -> Result<Vec<PageSummary>> {
    let db = state.db.lock();
    db::list_pages(&db, parent_id.as_deref())
}

#[tauri::command]
fn create_page(state: State<'_, AppState>, input: CreatePageInput) -> Result<Page> {
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    db::create_page(
        &db,
        &workspace.id,
        input.parent_id.as_deref(),
        input
            .parent_type
            .as_deref()
            .unwrap_or(if input.parent_id.is_some() {
                "page"
            } else {
                "workspace"
            }),
        input.title.as_deref(),
        input.icon.as_deref(),
    )
}

#[tauri::command]
fn get_page(state: State<'_, AppState>, page_id: String) -> Result<PageWithDoc> {
    let db = state.db.lock();
    let (page, doc) = db::fetch_page_with_doc(&db, &page_id)?;
    Ok(PageWithDoc { page, doc })
}

#[tauri::command]
fn rename_page(
    state: State<'_, AppState>,
    page_id: String,
    title: String,
) -> Result<Page> {
    let db = state.db.lock();
    db::update_page_meta(&db, &page_id, Some(&title), None, None)
}

#[tauri::command]
fn update_page_meta_cmd(
    state: State<'_, AppState>,
    page_id: String,
    input: UpdatePageMetaInput,
) -> Result<Page> {
    let db = state.db.lock();
    db::update_page_meta(
        &db,
        &page_id,
        input.title.as_deref(),
        input.icon.as_ref().map(|o| o.as_deref()),
        input.cover.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
fn update_page_doc(
    state: State<'_, AppState>,
    page_id: String,
    doc: String,
) -> Result<()> {
    let db = state.db.lock();
    db::update_page_doc(&db, &page_id, &doc)
}

#[tauri::command]
fn trash_page(state: State<'_, AppState>, page_id: String) -> Result<()> {
    let db = state.db.lock();
    db::trash_page(&db, &page_id)
}

#[tauri::command]
fn restore_page(state: State<'_, AppState>, page_id: String) -> Result<()> {
    let db = state.db.lock();
    db::restore_page(&db, &page_id)
}

#[tauri::command]
fn delete_page_permanently(state: State<'_, AppState>, page_id: String) -> Result<()> {
    let db = state.db.lock();
    db::delete_page_permanently(&db, &page_id)
}

// =========================================================================
// Database commands (M3)
// =========================================================================

use database::{
    AddPropertyInput, CreateDatabaseInput, CreateViewInput, DatabaseRow, DatabaseWithSchema,
    PropertyDef, UpdateCellInput, UpdatePropertyInput, UpdateViewInput, ViewConfig,
};

#[tauri::command]
fn create_database(state: State<'_, AppState>, input: CreateDatabaseInput) -> Result<DatabaseWithSchema> {
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    database::create_database(
        &db,
        &workspace.id,
        input.parent_id.as_deref(),
        input.parent_type.as_deref(),
        input.name.as_deref(),
    )
}

#[tauri::command]
fn get_database(state: State<'_, AppState>, database_id: String) -> Result<DatabaseWithSchema> {
    let db = state.db.lock();
    database::fetch_database(&db, &database_id)
}

#[tauri::command]
fn add_property(state: State<'_, AppState>, input: AddPropertyInput) -> Result<PropertyDef> {
    let db = state.db.lock();
    database::add_property(&db, input)
}

#[tauri::command]
fn update_property_cmd(
    state: State<'_, AppState>,
    property_id: String,
    input: UpdatePropertyInput,
) -> Result<PropertyDef> {
    let db = state.db.lock();
    database::update_property(&db, &property_id, input)
}

#[tauri::command]
fn delete_property_cmd(state: State<'_, AppState>, property_id: String) -> Result<()> {
    let db = state.db.lock();
    database::delete_property(&db, &property_id)
}

#[tauri::command]
fn add_database_row(state: State<'_, AppState>, database_id: String) -> Result<DatabaseRow> {
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    database::add_database_row(&db, &workspace.id, &database_id)
}

#[tauri::command]
fn update_cell_cmd(state: State<'_, AppState>, input: UpdateCellInput) -> Result<()> {
    let db = state.db.lock();
    database::update_cell(&db, input)
}

#[tauri::command]
fn delete_database_row_cmd(state: State<'_, AppState>, page_id: String) -> Result<()> {
    let db = state.db.lock();
    database::delete_database_row(&db, &page_id)
}

#[tauri::command]
fn query_database(state: State<'_, AppState>, database_id: String) -> Result<Vec<DatabaseRow>> {
    let db = state.db.lock();
    database::query_database(&db, &database_id)
}

#[tauri::command]
fn list_views(state: State<'_, AppState>, database_id: String) -> Result<Vec<ViewConfig>> {
    let db = state.db.lock();
    database::list_views(&db, &database_id)
}

#[tauri::command]
fn create_view(state: State<'_, AppState>, input: CreateViewInput) -> Result<ViewConfig> {
    let db = state.db.lock();
    database::create_view(&db, input)
}

#[tauri::command]
fn update_view_cmd(
    state: State<'_, AppState>,
    view_id: String,
    input: UpdateViewInput,
) -> Result<ViewConfig> {
    let db = state.db.lock();
    database::update_view(&db, &view_id, input)
}

#[tauri::command]
fn delete_view_cmd(state: State<'_, AppState>, view_id: String) -> Result<()> {
    let db = state.db.lock();
    database::delete_view(&db, &view_id)
}

// =========================================================================
// Search (M4)
// =========================================================================

use db::SearchHit;

#[tauri::command]
fn search(state: State<'_, AppState>, query: String, limit: Option<i64>) -> Result<Vec<SearchHit>> {
    let db = state.db.lock();
    db::search(&db, &query, limit.unwrap_or(50))
}

// =============================================================================
// Entry point
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Resolve data directory: APPDATA\Folio on Windows,
            // ~/Library/Application Support/Folio on macOS,
            // ~/.local/share/Folio on Linux.
            // (Decision Q7-B: this is the default; custom-location picker
            // will be added later in M2 via Settings UI.)
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app_data_dir");
            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app_data_dir");

            let db_path = app_data_dir.join("data.db");
            eprintln!("[folio] opening database at {}", db_path.display());

            let conn = Connection::open(&db_path)
                .unwrap_or_else(|e| panic!("failed to open db at {}: {e}", db_path.display()));

            // WAL mode for crash-safe writes (PRD §10.2 reliability target).
            conn.pragma_update(None, "journal_mode", "WAL").ok();
            conn.pragma_update(None, "foreign_keys", "ON").ok();

            schema::apply(&conn).expect("failed to apply database schema");

            let state = AppState {
                db: Arc::new(Mutex::new(conn)),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Workspace + page
            get_workspace,
            list_pages,
            create_page,
            get_page,
            rename_page,
            update_page_meta_cmd,
            update_page_doc,
            trash_page,
            restore_page,
            delete_page_permanently,
            // Database
            create_database,
            get_database,
            add_property,
            update_property_cmd,
            delete_property_cmd,
            add_database_row,
            update_cell_cmd,
            delete_database_row_cmd,
            query_database,
            list_views,
            create_view,
            update_view_cmd,
            delete_view_cmd,
            // Search
            search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
