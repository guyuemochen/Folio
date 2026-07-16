//! Folio Rust core.
//!
//! Entry point invoked by Tauri. Owns the SQLite connection and exposes
//! commands to the frontend.

use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

mod db;
mod database;
mod export;
mod import;
#[allow(dead_code)] // media helpers — used by notion_zip import + future features
mod media;
mod prosemirror;
mod registry;
mod schema;

/// Unified error type for all backend commands. Serializes as a string
/// so the frontend gets a readable error message via `invoke()`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("db error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
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
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub parent_type: String,
    /// 'page' or 'database' — lets the frontend distinguish database nodes
    /// from regular page nodes in the sidebar tree.
    #[serde(rename = "type")]
    pub r#type: String,
    pub is_trashed: bool,
    pub updated_at: i64,
    pub favorite: bool,
}

/// Full page row. Used when opening a page for editing.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
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
    pub favorite: bool,
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

/// Input for `move_page` (drag-to-reparent in the sidebar tree).
/// `new_parent_id = None` moves the page to the workspace root.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePageInput {
    pub page_id: String,
    pub new_parent_id: Option<String>,
    /// 'workspace' | 'page'. Defaults to 'workspace' when new_parent_id is None,
    /// otherwise 'page'.
    pub new_parent_type: Option<String>,
}

// =============================================================================
// App state
// =============================================================================

/// App-wide state shared across Tauri commands. The SQLite connections are
/// behind Mutexes because Tauri commands run on a multi-threaded async runtime.
///
/// - `registry`: always-open connection to `{app_data_dir}/registry.db` tracking
///   all known workspaces.
/// - `db`: connection to the *active* workspace's `data.db`. Swapped in-place
///   under the lock when switching workspaces (`switch_workspace` command).
///   The ~60 commands that do `state.db.lock()` need zero changes — they
///   transparently see the new connection after a swap.
pub struct AppState {
    pub registry: Arc<Mutex<Connection>>,
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

// =========================================================================
// Workspace management (multi-workspace)
// =========================================================================

/// List all registered workspaces, most-recently-opened first.
#[tauri::command]
fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<RegisteredWorkspace>> {
    let reg = state.registry.lock();
    registry::list_workspaces(&reg)
}

/// Return the currently active workspace (read from the active DB's workspace
/// row, then enriched with folder path from the registry).
#[tauri::command]
fn get_current_workspace(state: State<'_, AppState>) -> Result<RegisteredWorkspace> {
    let db = state.db.lock();
    let ws = db::get_or_create_workspace(&db)?;
    drop(db);

    let reg = state.registry.lock();
    if let Some(found) = registry::get_by_id(&reg, &ws.id)? {
        return Ok(found);
    }
    // Fallback (shouldn't happen post-migration, but be robust).
    let now = chrono::Utc::now().timestamp_millis();
    Ok(RegisteredWorkspace {
        id: ws.id,
        name: ws.name,
        folder_path: String::new(),
        db_filename: "data.db".to_string(),
        created_at: now,
        last_opened: now,
    })
}

/// Create a new workspace in the user-chosen folder, then switch to it.
///
/// `folder_path` is the absolute path the user picked via the folder dialog.
/// The folder must be (or become) writable. A fresh `data.db` is initialized
/// inside it.
#[tauri::command]
fn create_workspace(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    folder_path: String,
    name: String,
) -> Result<RegisteredWorkspace> {
    // Canonicalize + create the folder if it doesn't exist.
    let canon = registry::canonicalize_folder(&folder_path);
    std::fs::create_dir_all(&canon)?;

    // Dedupe: if this folder is already registered, switch to it instead.
    {
        let reg = state.registry.lock();
        if let Some(existing) = registry::get_by_path(&reg, &canon, "data.db")? {
            drop(reg);
            return switch_workspace(state, app, existing.id);
        }
    }

    // Initialize a fresh workspace DB inside the folder.
    let db_path = PathBuf::from(&canon).join("data.db");
    if db_path.exists() {
        // The folder already has a data.db — adopt it (read its workspace row).
        let peek = Connection::open(&db_path)?;
        let row: Option<(String, String, i64)> = peek
            .query_row(
                "SELECT id, name, created_at FROM workspace LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        let (id, existing_name, created_at) = row.unwrap_or_else(|| {
            let id = uuid::Uuid::new_v4().to_string();
            (id.clone(), name.clone(), chrono::Utc::now().timestamp_millis())
        });

        let now = chrono::Utc::now().timestamp_millis();
        let ws = RegisteredWorkspace {
            id,
            name: existing_name,
            folder_path: canon.clone(),
            db_filename: "data.db".to_string(),
            created_at,
            last_opened: now,
        };
        {
            let reg = state.registry.lock();
            registry::insert(&reg, &ws)?;
        }
        return switch_workspace(state, app, ws.id);
    }

    // Fresh data.db.
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let conn = open_workspace_db(&db_path)?;
    conn.execute(
        "INSERT INTO workspace (id, name, created_at, schema_version) VALUES (?1, ?2, ?3, 1)",
        params![&id, &name, now],
    )?;
    drop(conn);

    let ws = RegisteredWorkspace {
        id,
        name,
        folder_path: canon,
        db_filename: "data.db".to_string(),
        created_at: now,
        last_opened: now,
    };
    {
        let reg = state.registry.lock();
        registry::insert(&reg, &ws)?;
    }

    switch_workspace(state, app, ws.id)
}

/// Rename a workspace. Updates the registry; if it's the active workspace,
/// also syncs the new name into the DB's `workspace` row.
#[tauri::command]
fn rename_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<RegisteredWorkspace> {
    {
        let reg = state.registry.lock();
        registry::rename(&reg, &workspace_id, &name)?;
    }

    // Check if this is the active workspace; if so, sync the name into the DB.
    let is_active = {
        let db = state.db.lock();
        let active = db::get_or_create_workspace(&db)?;
        if active.id == workspace_id {
            sync_workspace_name(&db, &workspace_id, &name)?;
            true
        } else {
            false
        }
    };
    let _ = is_active;

    let reg = state.registry.lock();
    registry::get_by_id(&reg, &workspace_id)?
        .ok_or_else(|| Error::NotFound(format!("workspace {workspace_id}")))
}

/// Remove a workspace from the registry. If `delete_files` is true, also move
/// the `data.db` (and WAL/SHM sidecars) to the OS trash.
///
/// If the deleted workspace was active, switch to another one (or create a
/// fresh default).
#[tauri::command]
fn delete_workspace(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    workspace_id: String,
    delete_files: bool,
) -> Result<()> {
    // Read the entry before deleting (need folder path for file deletion).
    let ws_entry = {
        let reg = state.registry.lock();
        registry::get_by_id(&reg, &workspace_id)?
    };

    // Check if we're deleting the active workspace.
    let was_active = {
        let db = state.db.lock();
        let active = db::get_or_create_workspace(&db)?;
        active.id == workspace_id
    };

    // Remove from registry.
    {
        let reg = state.registry.lock();
        registry::delete(&reg, &workspace_id)?;
    }

    // Optionally move files to trash.
    if delete_files {
        if let Some(ref ws) = ws_entry {
            let db_file = registry::db_file_path(ws);
            // Best-effort: remove data.db + WAL + SHM sidecars.
            let _ = std::fs::remove_file(&db_file);
            let _ = std::fs::remove_file(db_file.with_extension("db-wal"));
            let _ = std::fs::remove_file(db_file.with_extension("db-shm"));
        }
    }

    // If we deleted the active workspace, switch to another one.
    if was_active {
        let next = {
            let reg = state.registry.lock();
            registry::get_last_opened(&reg)?
        };
        if let Some(next_ws) = next {
            switch_workspace(state, app, next_ws.id)?;
        } else {
            // No workspaces left — create a fresh default.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| Error::Other(format!("app_data_dir: {e}")))?;
            let fresh = resolve_boot_workspace(
                &state.registry.lock(),
                &app_data_dir,
            )?;
            switch_workspace(state, app, fresh.id)?;
        }
    }

    Ok(())
}

/// Move a workspace's `data.db` to a new folder.
///
/// Performs a WAL checkpoint first, copies the file, verifies the copy opens,
/// updates the registry path, then deletes the old file. If the workspace is
/// active, also swaps the in-memory connection.
#[tauri::command]
fn move_workspace(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    workspace_id: String,
    new_folder: String,
) -> Result<RegisteredWorkspace> {
    let canon_new = registry::canonicalize_folder(&new_folder);
    std::fs::create_dir_all(&canon_new)?;

    // Read current entry.
    let ws = {
        let reg = state.registry.lock();
        registry::get_by_id(&reg, &workspace_id)?
            .ok_or_else(|| Error::NotFound(format!("workspace {workspace_id}")))?
    };

    // Check if the active workspace is being moved.
    let is_active = {
        let db = state.db.lock();
        let active = db::get_or_create_workspace(&db)?;
        active.id == workspace_id
    };

    let old_db_path = registry::db_file_path(&ws);
    let new_db_path = PathBuf::from(&canon_new).join(&ws.db_filename);

    // Skip if source and destination are the same.
    if old_db_path == new_db_path {
        return Ok(ws);
    }

    // Checkpoint WAL into the main DB so the copy is self-contained.
    if is_active {
        let db = state.db.lock();
        let _ = db.pragma_update(None, "wal_checkpoint", "TRUNCATE");
    } else {
        let conn = Connection::open(&old_db_path)?;
        let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
    }

    // Copy data.db to the new location.
    std::fs::copy(&old_db_path, &new_db_path)?;

    // Verify the copy opens successfully.
    {
        let verify = open_workspace_db(&new_db_path)?;
        let _ = verify; // just checking it opens + schema applies
    }

    // Move attachment/media directories so assets follow the workspace.
    let old_folder = PathBuf::from(&ws.folder_path);
    for asset_dir in ["attachments", "media"] {
        let src = old_folder.join(asset_dir);
        let dst = PathBuf::from(&canon_new).join(asset_dir);
        if src.exists() {
            move_dir_recursive(&src, &dst)?;
        }
    }

    // Update the registry path.
    {
        let reg = state.registry.lock();
        registry::update_path(&reg, &workspace_id, &canon_new)?;
    }

    // Delete the old file + sidecars.
    let _ = std::fs::remove_file(&old_db_path);
    let _ = std::fs::remove_file(old_db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(old_db_path.with_extension("db-shm"));

    // If active, swap the connection to the new path.
    if is_active {
        let new_conn = open_workspace_db(&new_db_path)?;
        let mut db = state.db.lock();
        *db = new_conn; // drops the old connection, installs the new one
        drop(db);
        // Emit the switched event so the frontend refreshes.
        let updated = {
            let reg = state.registry.lock();
            registry::get_by_id(&reg, &workspace_id)?
                .ok_or_else(|| Error::NotFound(format!("workspace {workspace_id}")))?
        };
        let _ = app.emit("folio:workspace-switched", &updated);
        return Ok(updated);
    }

    let reg = state.registry.lock();
    registry::get_by_id(&reg, &workspace_id)?
        .ok_or_else(|| Error::NotFound(format!("workspace {workspace_id}")))
}

/// Switch to a different workspace at runtime (hot-swap).
///
/// Opens the target DB, then atomically swaps it into AppState under the db
/// lock. Emits `folio:workspace-switched` so the frontend clears caches.
#[tauri::command]
fn switch_workspace(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    workspace_id: String,
) -> Result<RegisteredWorkspace> {
    // Look up the target workspace in the registry.
    let ws = {
        let reg = state.registry.lock();
        registry::get_by_id(&reg, &workspace_id)?
            .ok_or_else(|| Error::NotFound(format!("workspace {workspace_id}")))?
    };

    let db_path = registry::db_file_path(&ws);
    if !db_path.exists() {
        return Err(Error::Other(format!(
            "workspace folder not found: {}",
            db_path.display()
        )));
    }

    // Open the new connection OUTSIDE the db lock (minimizes contention).
    let new_conn = open_workspace_db(&db_path)?;

    // Swap under the db lock.
    {
        let mut db = state.db.lock();
        // Sync the registry name into the workspace table row so get_workspace
        // returns the authoritative name.
        sync_workspace_name(&new_conn, &ws.id, &ws.name)?;
        // Replace the connection (old is dropped/closed here).
        *db = new_conn;
    }

    // Update last_opened.
    {
        let reg = state.registry.lock();
        registry::touch_last_opened(&reg, &workspace_id)?;
    }

    // Read the final entry (with updated last_opened).
    let updated = {
        let reg = state.registry.lock();
        registry::get_by_id(&reg, &workspace_id)?
            .ok_or_else(|| Error::NotFound(format!("workspace {workspace_id}")))?
    };

    // Notify the frontend.
    let _ = app.emit("folio:workspace-switched", &updated);

    Ok(updated)
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
    let (page, doc) = {
        let db = state.db.lock();
        db::fetch_page_with_doc(&db, &page_id)?
    };
    // Inflate relative media paths back to data URLs so the frontend <img>
    // renders without changes. This is the inverse of the extraction in
    // update_page_doc.
    let workspace_dir = active_workspace_dir(&state)?;
    let inflated = media::inflate_media_paths(&doc, &workspace_dir)?;
    Ok(PageWithDoc { page, doc: inflated })
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
    // Extract inline base64 images to files before storing, so the doc JSON
    // stays small (images are ~33% larger as base64, and every save rewrites
    // the entire doc + every snapshot copies it).
    let workspace_dir = active_workspace_dir(&state)?;
    let cleaned = media::extract_inline_images(&doc, &page_id, &workspace_dir)?;
    let db = state.db.lock();
    db::update_page_doc(&db, &page_id, &cleaned)
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

/// Reparent a page (sidebar drag-to-move). Cycle-protected on the Rust side.
#[tauri::command]
fn move_page(state: State<'_, AppState>, input: MovePageInput) -> Result<Page> {
    let db = state.db.lock();
    let parent_type = input
        .new_parent_type
        .as_deref()
        .unwrap_or(if input.new_parent_id.is_some() {
            "page"
        } else {
            "workspace"
        });
    db::move_page(
        &db,
        &input.page_id,
        input.new_parent_id.as_deref(),
        parent_type,
    )
}

// =========================================================================
// Database commands (M3)
// =========================================================================

use database::{
    AddPropertyInput, CreateDatabaseInput, CreateTemplateInput, CreateViewInput, DatabaseRow,
    DatabaseTemplate, DatabaseWithSchema, PropertyDef, UpdateCellInput, UpdatePropertyInput,
    UpdateTemplateInput, UpdateViewInput, ViewConfig,
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

#[tauri::command]
fn duplicate_property_cmd(state: State<'_, AppState>, property_id: String) -> Result<PropertyDef> {
    let db = state.db.lock();
    database::duplicate_property(&db, &property_id)
}

#[tauri::command]
fn duplicate_database_row(state: State<'_, AppState>, row_id: String) -> Result<DatabaseRow> {
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    database::duplicate_database_row(&db, &workspace.id, &row_id)
}

#[tauri::command]
fn export_database_csv(state: State<'_, AppState>, database_id: String) -> Result<String> {
    let db = state.db.lock();
    database::export_database_csv(&db, &database_id)
}

#[tauri::command]
fn add_database_row_from_template_cmd(
    state: State<'_, AppState>,
    database_id: String,
    template_id: String,
) -> Result<DatabaseRow> {
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    database::add_database_row_from_template(&db, &workspace.id, &database_id, &template_id)
}

#[tauri::command]
fn list_templates(
    state: State<'_, AppState>,
    database_id: String,
) -> Result<Vec<DatabaseTemplate>> {
    let db = state.db.lock();
    database::list_templates(&db, &database_id)
}

#[tauri::command]
fn create_template(
    state: State<'_, AppState>,
    input: CreateTemplateInput,
) -> Result<DatabaseTemplate> {
    let db = state.db.lock();
    database::create_template(&db, input)
}

#[tauri::command]
fn update_template_cmd(
    state: State<'_, AppState>,
    template_id: String,
    input: UpdateTemplateInput,
) -> Result<DatabaseTemplate> {
    let db = state.db.lock();
    database::update_template(&db, &template_id, input)
}

#[tauri::command]
fn delete_template_cmd(state: State<'_, AppState>, template_id: String) -> Result<()> {
    let db = state.db.lock();
    database::delete_template(&db, &template_id)
}

/// Copy a file picked by the frontend into the per-database attachments dir
/// and write its metadata into the cell. Returns the stored attachment info
/// so the frontend can render the chip immediately.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[tauri::command]
fn attach_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    src_path: String,
    database_id: String,
    page_id: String,
    property_id: String,
) -> Result<AttachmentInfo> {
    let workspace_dir = active_workspace_dir(&state)?;
    let _ = app; // app handle kept for potential future use
    let src = std::path::Path::new(&src_path);
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::Other("invalid file name".into()))?
        .to_string();
    let size = std::fs::metadata(src)?.len();

    // attachments/{database_id}/{uuid}_{filename}
    let dir = workspace_dir.join("attachments").join(&database_id);
    std::fs::create_dir_all(&dir)?;
    let stored_name = format!("{}_{}", uuid::Uuid::new_v4(), file_name);
    let dest = dir.join(&stored_name);
    std::fs::copy(src, &dest)?;

    let rel_path = format!("attachments/{}/{}", database_id, stored_name);
    let info = AttachmentInfo {
        name: file_name,
        path: rel_path,
        size,
    };

    // Persist {name, path, size} as the cell value.
    let value = serde_json::json!({ "name": info.name, "path": info.path, "size": info.size });
    let db = state.db.lock();
    database::update_cell(
        &db,
        UpdateCellInput {
            page_id,
            property_id,
            value,
        },
    )?;
    Ok(info)
}

// =========================================================================
// Trash / Favorites / Snapshots (M3 PRD §5.2.4)
// =========================================================================

use db::{PageSnapshot, TrashedPage};

#[tauri::command]
fn list_trashed_pages(state: State<'_, AppState>) -> Result<Vec<TrashedPage>> {
    let db = state.db.lock();
    db::list_trashed_pages(&db)
}

#[tauri::command]
fn purge_old_trash(state: State<'_, AppState>) -> Result<usize> {
    let db = state.db.lock();
    db::purge_old_trash(&db, 30 * 24 * 60 * 60)
}

#[tauri::command]
fn empty_trash(state: State<'_, AppState>) -> Result<usize> {
    let db = state.db.lock();
    db::empty_trash(&db)
}

#[tauri::command]
fn set_favorite(state: State<'_, AppState>, page_id: String, is_favorite: bool) -> Result<()> {
    let db = state.db.lock();
    db::set_favorite(&db, &page_id, is_favorite)
}

#[tauri::command]
fn list_favorites(state: State<'_, AppState>) -> Result<Vec<PageSummary>> {
    let db = state.db.lock();
    db::list_favorites(&db)
}

#[tauri::command]
fn reorder_favorites(state: State<'_, AppState>, ordered_page_ids: Vec<String>) -> Result<()> {
    let db = state.db.lock();
    db::reorder_favorites(&db, &ordered_page_ids)
}

#[tauri::command]
fn create_snapshot_cmd(
    state: State<'_, AppState>,
    page_id: String,
    content: String,
    title: String,
    source: Option<String>,
) -> Result<PageSnapshot> {
    let db = state.db.lock();
    db::create_snapshot(
        &db,
        &page_id,
        &content,
        &title,
        source.as_deref().unwrap_or("auto"),
    )
}

#[tauri::command]
fn list_snapshots(state: State<'_, AppState>, page_id: String) -> Result<Vec<PageSnapshot>> {
    let db = state.db.lock();
    db::list_snapshots(&db, &page_id)
}

#[tauri::command]
fn restore_snapshot(state: State<'_, AppState>, snapshot_id: String) -> Result<()> {
    let db = state.db.lock();
    db::restore_snapshot(&db, &snapshot_id)
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
// Export (M5 §5.5.2) — page-level Markdown / HTML export
// =============================================================================

/// Export a single page's document as Markdown or HTML.
///
/// `format` is `"markdown"` or `"html"`. Returns the serialized content as a
/// string; the frontend wraps it in a Blob and triggers a download (matching
/// the established CSV-export pattern in `DatabaseView`).
#[tauri::command]
fn export_page(
    state: State<'_, AppState>,
    page_id: String,
    format: String,
) -> Result<String> {
    let fmt = export::ExportFormat::parse(&format)
        .ok_or_else(|| Error::Other(format!("unknown export format: {format}")))?;
    let db = state.db.lock();
    let (page, doc) = db::fetch_page_with_doc(&db, &page_id)?;
    let doc_value = prosemirror::parse_doc(&doc);
    Ok(match fmt {
        export::ExportFormat::Markdown => export::markdown::serialize(&doc_value)?,
        export::ExportFormat::Html => export::html::serialize(&doc_value, &page.title)?,
    })
}

// =============================================================================
// Import (M5 §5.5.1) — Markdown / HTML file import
// =============================================================================

/// Update a page's title, keeping database row titles in sync.
///
/// If the page is a database row (parent_type = "database"), the title is
/// written through `database::update_cell` so both `page.title` and the row's
/// `title` property cell are updated atomically — otherwise the DatabaseView
/// name column would show a stale value after an overwrite import. For regular
/// pages, falls back to a direct `update_page_meta`.
fn sync_page_title(db: &rusqlite::Connection, page_id: &str, title: &str) -> Result<()> {
    let parent: Option<(Option<String>, String)> = db
        .query_row(
            "SELECT parent_id, parent_type FROM page WHERE id = ?1",
            params![page_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    if let Some((Some(parent_id), parent_type)) = parent {
        if parent_type == "database" {
            let title_prop: Option<String> = db
                .query_row(
                    "SELECT id FROM database_property \
                     WHERE database_id = ?1 AND type = 'title' LIMIT 1",
                    params![parent_id],
                    |row| row.get(0),
                )
                .ok();
            if let Some(prop_id) = title_prop {
                database::update_cell(
                    db,
                    database::UpdateCellInput {
                        page_id: page_id.to_string(),
                        property_id: prop_id,
                        value: serde_json::Value::String(title.to_string()),
                    },
                )?;
                return Ok(());
            }
        }
    }
    db::update_page_meta(db, page_id, Some(title), None, None)?;
    Ok(())
}

/// Shared backend for the import commands: given a parsed ProseMirror doc,
/// either create a new page (with an auto-derived title) or overwrite an
/// existing page's content. `target_page_id = Some(id)` selects overwrite mode;
/// otherwise a new page is created under `parent_id`.
fn import_doc_to_page(
    db: &rusqlite::Connection,
    parent_id: Option<&str>,
    target_page_id: Option<&str>,
    doc_value: &serde_json::Value,
    workspace_dir: &std::path::Path,
) -> Result<Page> {
    let title = prosemirror::extract_title(doc_value);
    let doc_json = serde_json::to_string(doc_value)
        .map_err(|e| Error::Other(format!("doc serialize failed: {e}")))?;

    if let Some(tid) = target_page_id {
        // Overwrite mode: replace the target page's doc and bump its title
        // to reflect the imported content (only when non-empty).
        let cleaned = media::extract_inline_images(&doc_json, tid, workspace_dir)?;
        db::update_page_doc(db, tid, &cleaned)?;
        if !title.is_empty() {
            sync_page_title(db, tid, &title)?;
        }
        return db::fetch_page(db, tid);
    }

    let workspace = db::get_or_create_workspace(db)?;
    let parent_type = if parent_id.is_some() { "page" } else { "workspace" };
    let page = db::create_page(
        db,
        &workspace.id,
        parent_id,
        parent_type,
        Some(&title),
        None,
    )?;
    let cleaned = media::extract_inline_images(&doc_json, &page.id, workspace_dir)?;
    db::update_page_doc(db, &page.id, &cleaned)?;
    Ok(page)
}

/// Import a single Markdown file.
/// - `parent_id = None` + `target_page_id = None` → new page at workspace root
/// - `parent_id = Some(p)` + `target_page_id = None` → new subpage under p
/// - `target_page_id = Some(id)` → overwrite existing page's content
#[tauri::command]
fn import_markdown(
    state: State<'_, AppState>,
    md_path: String,
    parent_id: Option<String>,
    target_page_id: Option<String>,
) -> Result<Page> {
    let md = std::fs::read_to_string(&md_path)?;
    let doc_value = import::markdown::convert(&md)?;
    let workspace_dir = active_workspace_dir(&state)?;
    let db = state.db.lock();
    import_doc_to_page(
        &db,
        parent_id.as_deref(),
        target_page_id.as_deref(),
        &doc_value,
        &workspace_dir,
    )
}

/// Import a single HTML file. Same mode semantics as `import_markdown`.
#[tauri::command]
fn import_html(
    state: State<'_, AppState>,
    html_path: String,
    parent_id: Option<String>,
    target_page_id: Option<String>,
) -> Result<Page> {
    let html = std::fs::read_to_string(&html_path)?;
    let doc_value = import::html::convert(&html)?;
    let workspace_dir = active_workspace_dir(&state)?;
    let db = state.db.lock();
    import_doc_to_page(
        &db,
        parent_id.as_deref(),
        target_page_id.as_deref(),
        &doc_value,
        &workspace_dir,
    )
}

// =============================================================================
// Import (M5 §5.5.1) — CSV + Notion zip
// =============================================================================

/// Import a CSV file as a new database page.
#[tauri::command]
fn import_csv(
    state: State<'_, AppState>,
    csv_path: String,
    parent_id: Option<String>,
) -> Result<Page> {
    let csv_text = std::fs::read_to_string(&csv_path)?;
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    let db_name = std::path::Path::new(&csv_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());
    let database_id = import::csv::import_csv(
        &db,
        &workspace.id,
        parent_id.as_deref(),
        &csv_text,
        db_name.as_deref(),
    )?;
    // Fetch the database page to return.
    let (page, _doc) = db::fetch_page_with_doc(&db, &database_id)?;
    Ok(page)
}

/// Import a Notion Markdown export zip as a page tree.
#[tauri::command]
fn import_notion_zip(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    zip_path: String,
    parent_id: Option<String>,
) -> Result<import::ImportResult> {
    let _ = app;
    let workspace_dir = active_workspace_dir(&state)?;
    let db = state.db.lock();
    let workspace = db::get_or_create_workspace(&db)?;
    import::notion_zip::import_notion_zip(
        &db,
        &workspace.id,
        &workspace_dir,
        &zip_path,
        parent_id.as_deref(),
    )
}

// =============================================================================
// Export (M5 §5.5.2) — Workspace zip + Backup
// =============================================================================

/// Export the entire workspace as a base64-encoded zip.
#[tauri::command]
fn export_workspace(
    state: State<'_, AppState>,
    format: String,
) -> Result<String> {
    let fmt = export::ExportFormat::parse(&format)
        .ok_or_else(|| Error::Other(format!("unknown export format: {format}")))?;
    let db = state.db.lock();
    export::workspace::export_workspace(&db, fmt)
}

/// Create a Folio Backup (SQLite + assets) as a base64-encoded zip.
#[tauri::command]
fn create_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String> {
    let _ = app;
    let workspace_dir = active_workspace_dir(&state)?;
    let db = state.db.lock();
    export::backup::create_backup(&db, &workspace_dir)
}

/// Restore a Folio Backup from a file path. Writes files to the active
/// workspace's folder; the frontend should restart the app to reopen the DB
/// on the restored data.
#[tauri::command]
fn restore_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    backup_path: String,
) -> Result<bool> {
    let _ = app;
    let workspace_dir = active_workspace_dir(&state)?;
    // Read the backup zip, encode to base64 for the restore function.
    let bytes = std::fs::read(&backup_path)?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    export::backup::restore_backup(&workspace_dir, &b64)
}

// =============================================================================
// File saving (used by export commands to write to a user-chosen path)
// =============================================================================

/// Write text content to a file path (chosen by the frontend via save dialog).
#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<()> {
    std::fs::write(&path, content)?;
    Ok(())
}

/// Write binary content (base64-encoded) to a file path. Used for zip exports.
#[tauri::command]
fn save_binary_file(path: String, content_b64: String) -> Result<()> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        content_b64.as_bytes(),
    )
    .map_err(|e| Error::Other(format!("base64 decode: {e}")))?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

// =============================================================================
// Entry point
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// =============================================================================
// Updater (M9 — release channels: stable / beta / nightly)
// =============================================================================

/// Per-channel update manifest URLs (GitHub Releases rolling tags).
/// TODO(M9): confirm owner/repo once the GitHub mirror is set up.
const UPDATE_ENDPOINTS: &[(&str, &str)] = &[
    (
        "stable",
        "https://github.com/guyuemochen/folio/releases/download/stable-latest/latest.json",
    ),
    (
        "beta",
        "https://github.com/guyuemochen/folio/releases/download/beta-latest/latest.json",
    ),
    (
        "nightly",
        "https://github.com/guyuemochen/folio/releases/download/nightly-latest/latest.json",
    ),
];

/// Resolve a channel name to its manifest URL, falling back to stable.
fn resolve_update_endpoint(channel: &str) -> std::result::Result<&'static str, String> {
    UPDATE_ENDPOINTS
        .iter()
        .find(|(c, _)| *c == channel)
        .or_else(|| UPDATE_ENDPOINTS.iter().find(|(c, _)| *c == "stable"))
        .map(|(_, url)| *url)
        .ok_or_else(|| format!("unknown update channel: {channel}"))
}

/// Build an updater bound to the channel's endpoint.
fn build_channel_updater(
    app: &tauri::AppHandle,
    channel: &str,
) -> std::result::Result<tauri_plugin_updater::Updater, String> {
    let endpoint = resolve_update_endpoint(channel)?;
    let url = url::Url::parse(endpoint).map_err(|e| e.to_string())?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

/// Check for an available update on the given release channel.
///
/// `channel` ∈ {"stable","beta","nightly"}; an unknown value falls back to "stable".
/// Returns `Some(version)` when a newer build is available, `None` when current.
#[tauri::command]
async fn check_for_update_with_channel(
    app: tauri::AppHandle,
    channel: String,
) -> std::result::Result<Option<String>, String> {
    let update = build_channel_updater(&app, &channel)?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version))
}

/// Download and install the update on the given channel.
///
/// Re-checks (so the Update handle is fresh) then downloads + installs.
/// The frontend should call `relaunch()` from `@tauri-apps/plugin-process`
/// after this resolves, so the restart UX stays in JS.
#[tauri::command]
async fn install_update_with_channel(
    app: tauri::AppHandle,
    channel: String,
) -> std::result::Result<(), String> {
    let update = build_channel_updater(&app, &channel)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update
        .download_and_install(
            |_chunk_len, _total_opt| {},
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================================
// Workspace management (multi-workspace support)
// =============================================================================

use registry::RegisteredWorkspace;
use std::path::{Path, PathBuf};

/// Open a workspace `data.db` file with the standard pragmas + schema applied.
/// Used by both `setup()` (first boot) and `switch_workspace` (runtime swap).
fn open_workspace_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)
        .map_err(|e| Error::Other(format!("failed to open db at {}: {e}", path.display())))?;

    // WAL mode for crash-safe writes (PRD §10.2 reliability target).
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "foreign_keys", "ON").ok();

    // M6 perf tuning (PRD §10.1) + busy_timeout for multi-workspace swap safety.
    for (key, val) in [
        ("synchronous", "NORMAL"),
        ("cache_size", "-20000"),
        ("mmap_size", "268435456"),
        ("temp_store", "MEMORY"),
        ("journal_size_limit", "67108864"),
        ("wal_autocheckpoint", "1000"),
        ("busy_timeout", "5000"),
    ] {
        if let Err(e) = conn.pragma_update(None, key, val) {
            eprintln!("[folio] warning: pragma {key}={val} failed: {e}");
        }
    }

    schema::apply(&conn)?;
    Ok(conn)
}

/// Open the registry database at `{app_data_dir}/registry.db`.
fn open_registry_db(app_data_dir: &Path) -> Result<Connection> {
    let registry_path = app_data_dir.join("registry.db");
    let conn = Connection::open(&registry_path)?;
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    registry::apply_schema(&conn)?;
    Ok(conn)
}

/// Migrate the legacy single-DB layout into the registry.
///
/// On first launch after the multi-workspace upgrade, if the registry is empty
/// and a legacy `{app_data_dir}/data.db` exists, we register that DB in-place
/// (path = app_data_dir, db_filename = "data.db") so the user's existing data
/// is preserved. The DB file itself is never moved or copied.
///
/// Returns the registered workspace if a migration happened.
fn migrate_legacy_db(
    registry_conn: &Connection,
    app_data_dir: &Path,
) -> Result<Option<RegisteredWorkspace>> {
    if registry::is_migrated(registry_conn)? {
        return Ok(None);
    }

    let legacy_db_path = app_data_dir.join("data.db");
    let registered = if legacy_db_path.exists() {
        // Open read-only to peek at the workspace row without creating one.
        let peek = Connection::open(&legacy_db_path)?;
        let row: Option<(String, String, i64)> = peek
            .query_row(
                "SELECT id, name, created_at FROM workspace LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        if let Some((id, name, created_at)) = row {
            let ws = RegisteredWorkspace {
                id,
                name,
                folder_path: app_data_dir.to_string_lossy().to_string(),
                db_filename: "data.db".to_string(),
                created_at,
                last_opened: chrono::Utc::now().timestamp_millis(),
            };
            registry::insert(registry_conn, &ws)?;
            Some(ws)
        } else {
            None
        }
    } else {
        None
    };

    registry::mark_migrated(registry_conn)?;
    Ok(registered)
}

/// Resolve the active workspace to open on boot.
///
/// Priority: last-opened workspace in registry → migrated legacy workspace →
/// create a fresh default at `{app_data_dir}/data.db`.
fn resolve_boot_workspace(
    registry_conn: &Connection,
    app_data_dir: &Path,
) -> Result<RegisteredWorkspace> {
    // Try the most-recently-opened workspace first.
    if let Some(ws) = registry::get_last_opened(registry_conn)? {
        // Verify the DB file still exists on disk.
        if registry::db_file_path(&ws).exists() {
            return Ok(ws);
        }
        // The folder was deleted externally — try any other workspace.
        for candidate in registry::list_workspaces(registry_conn)? {
            if registry::db_file_path(&candidate).exists() {
                return Ok(candidate);
            }
        }
    }

    // No usable workspace found — create a fresh default.
    let id = uuid::Uuid::new_v4().to_string();
    let name = "My Workspace".to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let ws = RegisteredWorkspace {
        id: id.clone(),
        name: name.clone(),
        folder_path: app_data_dir.to_string_lossy().to_string(),
        db_filename: "data.db".to_string(),
        created_at: now,
        last_opened: now,
    };

    // Initialize the DB file with schema + workspace row.
    let db_path = registry::db_file_path(&ws);
    if !db_path.exists() {
        let conn = open_workspace_db(&db_path)?;
        // Insert the workspace row so get_or_create_workspace returns it.
        conn.execute(
            "INSERT INTO workspace (id, name, created_at, schema_version) VALUES (?1, ?2, ?3, 1)",
            params![&id, &name, now],
        )?;
    }

    registry::insert(registry_conn, &ws)?;
    registry::touch_last_opened(registry_conn, &id)?;
    Ok(ws)
}

/// Sync the registry name into the active workspace's `workspace` table row
/// so `get_workspace` always reads the authoritative name from the DB.
fn sync_workspace_name(db: &Connection, id: &str, name: &str) -> Result<()> {
    db.execute(
        "UPDATE workspace SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    Ok(())
}

/// Resolve the active workspace's folder path from the registry.
///
/// Reads the active workspace id from the DB, then looks up its `folder_path`
/// in the registry. All attachment/media/backup operations should use this
/// as the root directory instead of `app_data_dir`, so assets follow the
/// workspace when it's moved.
fn active_workspace_dir(state: &State<'_, AppState>) -> Result<PathBuf> {
    let ws_id = {
        let db = state.db.lock();
        let ws = db::get_or_create_workspace(&db)?;
        ws.id
    };
    let reg = state.registry.lock();
    let entry = registry::get_by_id(&reg, &ws_id)?
        .ok_or_else(|| Error::Other("active workspace not in registry".into()))?;
    Ok(PathBuf::from(&entry.folder_path))
}

/// Move a directory from `src` to `dst`. Tries `rename` first (instant on the
/// same filesystem); falls back to recursive copy + delete for cross-filesystem
/// moves. No-op if `src` doesn't exist.
fn move_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    if !src.exists() {
        return Ok(());
    }
    // Fast path: same-filesystem rename.
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    // Slow path: cross-filesystem copy + delete.
    copy_dir_recursive(src, dst)?;
    std::fs::remove_dir_all(src)?;
    Ok(())
}

/// Recursively copy a directory tree.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let dest = dst.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Resolve data directory: APPDATA\Folio on Windows,
            // ~/Library/Application Support/Folio on macOS,
            // ~/.local/share/Folio on Linux.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app_data_dir");
            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app_data_dir");

            // Open the workspace registry (separate DB tracking all known workspaces).
            let registry_conn = open_registry_db(&app_data_dir)
                .expect("failed to open registry.db");

            // Migrate the legacy single-DB into the registry (idempotent).
            if let Err(e) = migrate_legacy_db(&registry_conn, &app_data_dir) {
                eprintln!("[folio] warning: legacy migration failed: {e}");
            }

            // Determine which workspace to open on boot.
            let boot_ws = resolve_boot_workspace(&registry_conn, &app_data_dir)
                .expect("failed to resolve boot workspace");
            let db_path = registry::db_file_path(&boot_ws);
            eprintln!(
                "[folio] opening workspace '{}' ({}) at {}",
                boot_ws.name,
                boot_ws.id,
                db_path.display()
            );

            let conn = open_workspace_db(&db_path)
                .unwrap_or_else(|e| panic!("failed to open db at {}: {e}", db_path.display()));

            // PRD §5.2.4: hard-delete trash older than 30 days on every launch.
            match db::purge_old_trash(&conn, 30 * 24 * 60 * 60) {
                Ok(n) if n > 0 => eprintln!("[folio] purged {} old trashed pages", n),
                Ok(_) => {}
                Err(e) => eprintln!("[folio] failed to purge old trash: {}", e),
            }

            let state = AppState {
                registry: Arc::new(Mutex::new(registry_conn)),
                db: Arc::new(Mutex::new(conn)),
            };
            app.manage(state);

            // M9: register the updater plugin (desktop only). The endpoint is
            // selected per-channel at check time in check_for_update_with_channel.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

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
            move_page,
            // Workspace management (multi-workspace)
            list_workspaces,
            get_current_workspace,
            create_workspace,
            rename_workspace,
            delete_workspace,
            move_workspace,
            switch_workspace,
            // Trash + Favorites + Snapshots (M3 §5.2.4)
            list_trashed_pages,
            purge_old_trash,
            empty_trash,
            set_favorite,
            list_favorites,
            reorder_favorites,
            create_snapshot_cmd,
            list_snapshots,
            restore_snapshot,
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
            // Database — M4 extras (templates, duplicate, csv, files)
            duplicate_property_cmd,
            duplicate_database_row,
            export_database_csv,
            add_database_row_from_template_cmd,
            list_templates,
            create_template,
            update_template_cmd,
            delete_template_cmd,
            attach_file,
            // Search
            search,
            // Export (M5)
            export_page,
            // Import (M5)
            import_markdown,
            import_html,
            import_csv,
            import_notion_zip,
            // Workspace export + backup (M5)
            export_workspace,
            create_backup,
            restore_backup,
            // File saving (M5 export)
            save_text_file,
            save_binary_file,
            // Updater (M9)
            check_for_update_with_channel,
            install_update_with_channel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
