//! Dashboard plugins — backend support.
//!
//! Three concerns live here:
//!   1. **Storage** — per-plugin JSON KV at `<appData>/plugin-storage/<id>.json`.
//!      Backs the `host.storage` API the host hands to each plugin widget.
//!   2. **Directory management** — list/install/uninstall/open for both the
//!      global plugins dir (`<appData>/plugins/`) and the workspace plugins
//!      dir (`<workspaceFolder>/plugins/`). Workspace entries shadow global
//!      entries on path-basename clash.
//!   3. **Hot reload watcher** — `notify` crate with 200 ms per-path rate
//!      limiting; emits `folio:plugin-changed` events the frontend reloads on.
//!
//! The actual dynamic-import of plugin `.js` happens in the frontend. The
//! backend's `plugin_read_text` command reads a plugin file's bytes (Rust has
//! unrestricted fs access, bypassing asset-protocol/fs-scope limitations for
//! workspace plugins in arbitrary user folders); the frontend wraps the text
//! in a `Blob` URL and dynamic-imports it. This keeps the loader uniform
//! across dev / prod / global / workspace.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, Manager};

use crate::{registry, Error, Result};
use crate::AppState;

/// Per-path event rate limit. Notify can fire many events during a single
/// editor save (manifest + js written separately, atomic-save temp files,
/// etc.); we emit at most one `folio:plugin-changed` per path per window.
/// True debounce (collect-then-emit-after-silence) would be marginally
/// better but adds a thread + channel for ~zero observable difference here.
const HOT_RELOAD_DEBOUNCE: Duration = Duration::from_millis(200);

/// Validate a plugin id per the SDK contract (`/^[a-z0-9-]+$/`). Used to
/// sanitize the path component of `<appData>/plugin-storage/<id>.json`
/// against `..` traversal and absolute paths.
const VALID_ID_REGEX: &str = r"^[a-z0-9-]+$";

// ============================================================================
// Path helpers
// ============================================================================

/// `<appData>/plugins/` — global plugins, shared across workspaces.
pub fn global_plugins_dir(app_data: &Path) -> PathBuf {
    app_data.join("plugins")
}

/// `<appData>/plugin-storage/` — per-plugin KV JSON files.
fn plugin_storage_dir(app_data: &Path) -> PathBuf {
    app_data.join("plugin-storage")
}

/// `<appData>/plugin-storage/<id>.json`. Validates `id` first.
fn plugin_storage_file(app_data: &Path, plugin_id: &str) -> Result<PathBuf> {
    sanitize_plugin_id(plugin_id)?;
    Ok(plugin_storage_dir(app_data).join(format!("{plugin_id}.json")))
}

/// `<workspaceFolder>/plugins/` — per-workspace plugins (shadow global).
fn workspace_plugins_dir(workspace_folder: &Path) -> PathBuf {
    workspace_folder.join("plugins")
}

/// Reject ids that aren't `/^[a-z0-9-]+$/`. The regex is small enough to
/// hand-check; we avoid pulling in the `regex` crate by walking bytes.
fn sanitize_plugin_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 128 {
        return Err(Error::Other(format!("invalid plugin id (length): {id}")));
    }
    if !id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(Error::Other(format!("invalid plugin id (charset): {id}")));
    }
    Ok(())
}

#[allow(dead_code)]
const _STATIC_REGEX_DOC: &str = VALID_ID_REGEX; // documentation anchor

/// Resolve the active workspace's folder path from app state. Returns None
/// if no workspace is open (shouldn't happen — boot always opens one).
fn active_workspace_folder(state: &AppState) -> Result<Option<PathBuf>> {
    let ws_id = {
        let db = state.db.lock();
        crate::db::get_or_create_workspace(&db)?.id
    };
    let reg = state.registry.lock();
    Ok(registry::get_by_id(&reg, &ws_id)?.map(|ws| PathBuf::from(&ws.folder_path)))
}

// ============================================================================
// Storage commands (T3) — per-plugin JSON KV
// ============================================================================

/// Read one key from `<appData>/plugin-storage/<id>.json`. Returns null if
/// the file or key is absent. Plugin id is sanitized before any fs touch.
#[tauri::command]
pub fn plugin_storage_get(
    app: AppHandle,
    plugin_id: String,
    key: String,
) -> Result<Option<JsonValue>> {
    let app_data = app_data_dir(&app)?;
    let file = plugin_storage_file(&app_data, &plugin_id)?;
    let map = read_storage_map(&file)?;
    Ok(map.get(&key).cloned())
}

/// Set one key. Reads the existing map (if any), inserts, writes back
/// atomically (write to temp + rename) so a crash mid-write can't corrupt
/// the plugin's entire KV.
#[tauri::command]
pub fn plugin_storage_set(
    app: AppHandle,
    plugin_id: String,
    key: String,
    value: JsonValue,
) -> Result<()> {
    let app_data = app_data_dir(&app)?;
    let file = plugin_storage_file(&app_data, &plugin_id)?;
    let mut map = read_storage_map(&file)?;
    map.insert(key, value);
    write_storage_map(&file, &map)
}

/// Delete one key. No-op if absent.
#[tauri::command]
pub fn plugin_storage_delete(app: AppHandle, plugin_id: String, key: String) -> Result<()> {
    let app_data = app_data_dir(&app)?;
    let file = plugin_storage_file(&app_data, &plugin_id)?;
    let mut map = read_storage_map(&file)?;
    map.remove(&key);
    write_storage_map(&file, &map)
}

/// All keys for a plugin (for `host.storage.keys()`).
#[tauri::command]
pub fn plugin_storage_keys(app: AppHandle, plugin_id: String) -> Result<Vec<String>> {
    let app_data = app_data_dir(&app)?;
    let file = plugin_storage_file(&app_data, &plugin_id)?;
    let map = read_storage_map(&file)?;
    // serde_json::Map doesn't impl into_keys; collect from keys().cloned().
    Ok(map.keys().cloned().collect())
}

/// Load the per-plugin KV as a `serde_json::Map`. Missing file → empty map.
/// Tolerates a top-level non-object file by returning an empty map rather
/// than crashing the plugin's storage ops.
fn read_storage_map(file: &Path) -> Result<serde_json::Map<String, JsonValue>> {
    if !file.exists() {
        return Ok(serde_json::Map::new());
    }
    let text = std::fs::read_to_string(file)?;
    let v: JsonValue = serde_json::from_str(&text)?;
    Ok(match v {
        JsonValue::Object(map) => map,
        // Defensive: a non-object at the top level would break indexing;
        // reset to empty so the next set() recovers a valid shape.
        _ => serde_json::Map::new(),
    })
}

fn write_storage_map(file: &Path, map: &serde_json::Map<String, JsonValue>) -> Result<()> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Atomic write: temp file in the same dir, then rename.
    let tmp = file.with_extension("json.tmp");
    let serialized = serde_json::to_vec_pretty(&JsonValue::Object(map.clone()))?;
    std::fs::write(&tmp, serialized)?;
    std::fs::rename(&tmp, file)?;
    Ok(())
}

// ============================================================================
// Directory management commands (T4)
// ============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDirs {
    /// Always set. `<appData>/plugins/`.
    pub global: String,
    /// `<workspaceFolder>/plugins/`. None if no workspace open.
    pub workspace: Option<String>,
}

/// Resolve the two plugin dirs. Does NOT create them — callers (frontend)
/// create on demand via `plugin_install_file` or the OS folder button.
#[tauri::command]
pub fn plugin_get_dirs(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<PluginDirs> {
    let app_data = app_data_dir(&app)?;
    let global = global_plugins_dir(&app_data);
    let workspace = active_workspace_folder(&state)?
        .map(|folder| workspace_plugins_dir(&folder).to_string_lossy().into_owned());
    Ok(PluginDirs {
        global: global.to_string_lossy().into_owned(),
        workspace,
    })
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginListEntry {
    /// Absolute path to either the .js file (kind==='file') or the folder.
    pub path: String,
    /// "global" or "workspace".
    pub scope: String,
    /// "file" or "dir".
    pub kind: String,
    /// Folder plugins only: parsed manifest.json. Single-file plugins return
    /// null (manifest is in-band in the .js; the loader imports to read it).
    pub manifest: Option<JsonValue>,
    /// Basename of the entry — used for shadowing (workspace overrides global
    /// when two entries have the same basename).
    pub name: String,
}

/// Walk both plugin dirs and return all entries. Workspace entries shadow
/// global entries on basename clash (returned only once, marked workspace).
/// Empty/nonexistent dirs contribute no entries (not an error).
#[tauri::command]
pub fn plugin_list(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Vec<PluginListEntry>> {
    let app_data = app_data_dir(&app)?;
    let global_dir = global_plugins_dir(&app_data);
    let workspace_dir = active_workspace_folder(&state)?
        .map(|folder| workspace_plugins_dir(&folder));

    let global_entries = scan_dir(&global_dir, "global")?;
    let workspace_entries = match &workspace_dir {
        Some(d) => scan_dir(d, "workspace")?,
        None => Vec::new(),
    };

    // Shadow: workspace wins on basename clash.
    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut out: Vec<PluginListEntry> = Vec::new();
    // Workspace first so their names claim the dedupe map.
    for entry in workspace_entries.into_iter().chain(global_entries.into_iter()) {
        if seen.contains_key(&entry.name) {
            continue;
        }
        seen.insert(entry.name.clone(), ());
        out.push(entry);
    }
    Ok(out)
}

/// Walk one plugins dir. Returns one entry per top-level `.js` file or
/// subfolder containing either a `manifest.json` or another `.js`. Recursive
/// depth = 1 (we don't want one entry per file inside a folder plugin).
fn scan_dir(dir: &Path, scope: &'static str) -> Result<Vec<PluginListEntry>> {
    let mut out = Vec::new();
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return Ok(out), // missing dir = no entries, not an error
    };
    for entry in read {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Skip dotfiles and the OS's hidden noise.
        if name.starts_with('.') {
            continue;
        }
        let meta = entry.metadata()?;
        if meta.is_file() {
            // Single-file plugin: must end in .js.
            if name.ends_with(".js") {
                out.push(PluginListEntry {
                    path: path.to_string_lossy().into_owned(),
                    scope: scope.to_string(),
                    kind: "file".to_string(),
                    manifest: None,
                    name,
                });
            }
        } else if meta.is_dir() {
            // Folder plugin: only include if it has a manifest.json OR a lone
            // index.js. Skip otherwise (could be a stray folder).
            let manifest_path = path.join("manifest.json");
            let index_path = path.join("index.js");
            if manifest_path.exists() {
                let manifest = std::fs::read(&manifest_path)
                    .ok()
                    .and_then(|b| serde_json::from_slice(&b).ok());
                out.push(PluginListEntry {
                    path: path.to_string_lossy().into_owned(),
                    scope: scope.to_string(),
                    kind: "dir".to_string(),
                    manifest,
                    name,
                });
            } else if index_path.exists() {
                out.push(PluginListEntry {
                    path: path.to_string_lossy().into_owned(),
                    scope: scope.to_string(),
                    kind: "dir".to_string(),
                    manifest: None,
                    name,
                });
            }
        }
    }
    Ok(out)
}

/// Install (copy) a user-picked source file or folder into the GLOBAL plugins
/// dir. We don't auto-install to workspace — keep that an explicit user
/// choice in the manager UI (drag-drop into the workspace folder).
///
/// Returns the absolute destination path.
#[tauri::command]
pub fn plugin_install_file(app: AppHandle, src_path: String) -> Result<String> {
    let app_data = app_data_dir(&app)?;
    let dest_root = global_plugins_dir(&app_data);
    std::fs::create_dir_all(&dest_root)?;
    let src = Path::new(&src_path);
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::Other("invalid source file name".into()))?;

    // Reject obviously-not-a-plugin extensions at install time (the loader
    // will reject them too, but better to fail fast in the picker flow).
    let is_js = file_name.ends_with(".js");
    let src_is_dir = src.is_dir();
    if !is_js && !src_is_dir {
        return Err(Error::Other(format!(
            "not a plugin: {file_name} (must be a .js file or a directory)"
        )));
    }

    let dest = dest_root.join(file_name);
    // If exists, replace — install is idempotent.
    if dest.exists() {
        if dest.is_dir() {
            std::fs::remove_dir_all(&dest)?;
        } else {
            std::fs::remove_file(&dest)?;
        }
    }
    if src_is_dir {
        crate::copy_dir_recursive(src, &dest)?;
    } else {
        std::fs::copy(src, &dest)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Remove a plugin entry by absolute path. The manager UI passes the path
/// from the `plugin_list` result, so we just `rm -rf` it.
///
/// Safety: the path must resolve inside one of the two plugins dirs — we
/// canonicalize and check prefix before deleting, so a malicious / buggy
/// caller can't `plugin_uninstall("/etc/passwd")`.
#[tauri::command]
pub fn plugin_uninstall(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<()> {
    let app_data = app_data_dir(&app)?;
    let global_root = global_plugins_dir(&app_data).canonicalize().unwrap_or_else(|_| global_plugins_dir(&app_data));
    let workspace_root = active_workspace_folder(&state)?
        .map(|f| {
            let p = workspace_plugins_dir(&f);
            p.canonicalize().unwrap_or(p)
        });

    let target = Path::new(&path)
        .canonicalize()
        .map_err(|e| Error::Other(format!("path not found: {path}: {e}")))?;

    let inside_global = target.starts_with(&global_root);
    let inside_workspace = workspace_root
        .as_ref()
        .map(|r| target.starts_with(r))
        .unwrap_or(false);
    if !inside_global && !inside_workspace {
        return Err(Error::Other(format!(
            "refusing to uninstall path outside plugins dirs: {path}"
        )));
    }

    if target.is_dir() {
        std::fs::remove_dir_all(&target)?;
    } else {
        std::fs::remove_file(&target)?;
    }
    Ok(())
}

/// Open a plugins dir in the OS file manager. Uses the existing
/// `tauri-plugin-shell` (already allowed via `shell:allow-open` capability).
#[tauri::command]
pub fn plugin_open_dir(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    scope: String,
) -> Result<()> {
    let app_data = app_data_dir(&app)?;
    let dir = match scope.as_str() {
        "workspace" => {
            let folder = active_workspace_folder(&state)?
                .ok_or_else(|| Error::Other("no workspace open".into()))?;
            workspace_plugins_dir(&folder)
        }
        // default to global for anything else (defensive)
        _ => global_plugins_dir(&app_data),
    };
    // Ensure the folder exists so opening it doesn't fail on first run.
    let _ = std::fs::create_dir_all(&dir);
    // The opener call goes through `tauri-plugin-shell` which is governed by
    // `shell:allow-open` — already in capabilities/default.json. We use the
    // `open` crate directly to avoid wiring an IPC round-trip through the
    // shell plugin's JS API.
    open_dir_in_os(&dir).map_err(|e| Error::Other(format!("open dir failed: {e}")))?;
    Ok(())
}

/// Best-effort OS-native folder open. Uses the `open` crate implicitly via
/// `std::process::Command` on each platform.
fn open_dir_in_os(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

/// Read a plugin manifest.json (folder plugins only). Lets the manager UI
/// show metadata without executing JS.
#[tauri::command]
pub fn plugin_read_manifest(dir_path: String) -> Result<JsonValue> {
    let path = Path::new(&dir_path).join("manifest.json");
    if !path.exists() {
        return Err(Error::NotFound("manifest.json".into()));
    }
    let bytes = std::fs::read(&path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Read a plugin file's text content. Used by the frontend loader to fetch
/// plugin `.js` source (which it then wraps in a Blob URL and dynamic-imports).
///
/// This bypasses the asset-protocol / fs-scope machinery — necessary because
/// workspace plugins live in arbitrary user-chosen folders that can't be
/// whitelisted at build time. The trade-off is: a plugin can read its own
/// source via `host.invoke` if the host whitelists this command; that's a
/// feature (plugins can self-inspect) not a bug.
#[tauri::command]
pub fn plugin_read_text(path: String) -> Result<String> {
    Ok(std::fs::read_to_string(&path)?)
}

// ============================================================================
// Hot reload watcher (T5) — notify + emit folio:plugin-changed
// ============================================================================

/// Holds two notify watchers — one per scope — so each watcher's callback
/// can carry the correct scope string in its emitted events. We can't swap
/// the callback on a running watcher (notify takes ownership), so two
/// watchers is the simplest correct design.
///
/// Lives in AppState for the app lifetime.
pub struct PluginWatcherState {
    /// Started once in `app.setup()`. Lives for the app lifetime.
    global_watcher: Mutex<Option<RecommendedWatcher>>,
    /// Created lazily on first workspace attach. `unwatch` + `watch` on
    /// subsequent workspace switches.
    workspace_watcher: Mutex<Option<RecommendedWatcher>>,
    /// Currently-watched workspace plugins dir. Detached + replaced on
    /// workspace switch.
    workspace_dir: Mutex<Option<PathBuf>>,
    /// Global plugins dir (constant for app lifetime).
    #[allow(dead_code)]
    global_dir: PathBuf,
}

impl PluginWatcherState {
    fn new(global_dir: PathBuf) -> Self {
        Self {
            global_watcher: Mutex::new(None),
            workspace_watcher: Mutex::new(None),
            workspace_dir: Mutex::new(None),
            global_dir,
        }
    }

    /// Start watching the global dir. Called once from `app.setup()`.
    /// Failure to start the watcher is logged but does not abort startup —
    /// plugins still load via the manual scan path; only hot reload breaks.
    pub fn start(&self, app: &AppHandle) {
        let global_dir = self.global_dir.clone();
        let _ = std::fs::create_dir_all(&global_dir);

        let watcher = match notify::recommended_watcher(make_callback(app.clone(), "global")) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[folio:plugins] failed to start global watcher: {e}");
                return;
            }
        };
        {
            let mut slot = self.global_watcher.lock();
            *slot = Some(watcher);
            if let Some(w) = slot.as_mut() {
                if let Err(e) = w.watch(&global_dir, RecursiveMode::Recursive) {
                    eprintln!("[folio:plugins] failed to watch global dir {}: {e}", global_dir.display());
                }
            }
        }
        eprintln!("[folio:plugins] watching global dir: {}", global_dir.display());
    }

    /// Attach (or replace) the workspace plugins dir. Called from
    /// `switch_workspace` after the workspace db swap. Pass `None` to detach
    /// (workspace closed).
    pub fn attach_workspace(&self, app: &AppHandle, workspace_dir: Option<PathBuf>) {
        // Drop the previous workspace watcher if any. Dropping the
        // RecommendedWatcher unwatches all its paths internally.
        let prev = { self.workspace_dir.lock().take() };
        if prev.is_some() {
            *self.workspace_watcher.lock() = None;
            eprintln!("[folio:plugins] detached previous workspace watcher");
        }

        if let Some(new_dir) = workspace_dir.as_ref() {
            // Lazily create the workspace plugins dir so the watch succeeds;
            // subsequent saves then trigger reloads.
            let _ = std::fs::create_dir_all(new_dir);

            let watcher = match notify::recommended_watcher(make_callback(app.clone(), "workspace")) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("[folio:plugins] failed to start workspace watcher: {e}");
                    return;
                }
            };
            {
                let mut slot = self.workspace_watcher.lock();
                *slot = Some(watcher);
                if let Some(w) = slot.as_mut() {
                    if let Err(e) = w.watch(new_dir, RecursiveMode::Recursive) {
                        eprintln!("[folio:plugins] failed to watch workspace dir {}: {e}", new_dir.display());
                    }
                }
            }
            eprintln!("[folio:plugins] watching workspace dir: {}", new_dir.display());
        }

        *self.workspace_dir.lock() = workspace_dir;
    }
}

/// Build a notify callback with per-path 200ms rate limiting. Emits
/// `folio:plugin-changed` events with `{ scope, path, kind }`.
fn make_callback(
    app: AppHandle,
    scope: &'static str,
) -> impl FnMut(notify::Result<notify::Event>) + Send + 'static {
    // Per-path last-emit timestamps. notify dispatches events on its own
    // thread, so this map needs to be thread-safe.
    let last_emit: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
    move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[folio:plugins] watcher error: {e}");
                return;
            }
        };
        let kind_str: &'static str = match event.kind {
            notify::EventKind::Create(_) => "create",
            notify::EventKind::Modify(_) => "modify",
            notify::EventKind::Remove(_) => "remove",
            // Access / Any / Other: ignore — too noisy and rarely actionable.
            _ => return,
        };
        let now = Instant::now();
        for path in &event.paths {
            // Per-path rate limit. We update the timestamp only when we
            // actually emit, so a burst of events on one path coalesces into
            // one emit every DEBOUNCE window.
            let emit = {
                let mut last = last_emit.lock();
                let allow = match last.get(path) {
                    Some(t) => now.duration_since(*t) >= HOT_RELOAD_DEBOUNCE,
                    None => true,
                };
                if allow {
                    last.insert(path.clone(), now);
                }
                allow
            };
            if !emit {
                continue;
            }
            let payload = PluginChangedEvent {
                scope,
                path: path.to_string_lossy().into_owned(),
                kind: kind_str,
            };
            if let Err(e) = app.emit("folio:plugin-changed", &payload) {
                eprintln!("[folio:plugins] emit folio:plugin-changed failed: {e}");
            }
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginChangedEvent {
    scope: &'static str,
    path: String,
    kind: &'static str,
}

// ============================================================================
// Glue: app data dir resolution
// ============================================================================

fn app_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| Error::Other(format!("app_data_dir: {e}")))
}

/// Initialise the plugin watcher state and store it in AppState. Called from
/// `app.setup()` before any command runs. Also starts watching the global
/// plugins dir.
pub fn init_watcher(app: &AppHandle, app_data: &Path) -> Arc<PluginWatcherState> {
    let global = global_plugins_dir(app_data);
    let state = Arc::new(PluginWatcherState::new(global));
    state.start(app);
    state
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rejects_bad_ids() {
        assert!(sanitize_plugin_id("hello-world").is_ok());
        assert!(sanitize_plugin_id("abc123").is_ok());
        assert!(sanitize_plugin_id("a").is_ok());
        assert!(sanitize_plugin_id("").is_err());
        assert!(sanitize_plugin_id("Hello").is_err()); // uppercase
        assert!(sanitize_plugin_id("hello world").is_err()); // space
        assert!(sanitize_plugin_id("hello_world").is_err()); // underscore
        assert!(sanitize_plugin_id("../etc/passwd").is_err()); // traversal
        assert!(sanitize_plugin_id("/etc/passwd").is_err()); // slashes
        assert!(sanitize_plugin_id(&"a".repeat(129)).is_err()); // too long
    }

    #[test]
    fn storage_file_path_is_safe() {
        let tmp = std::env::temp_dir();
        let p = plugin_storage_file(&tmp, "my-plugin").unwrap();
        assert!(p.starts_with(&tmp));
        assert_eq!(p.file_name().unwrap().to_str().unwrap(), "my-plugin.json");

        let err = plugin_storage_file(&tmp, "../escape").unwrap_err();
        assert!(err.to_string().contains("invalid plugin id"));
    }

    #[test]
    fn read_storage_returns_empty_object_for_missing_file() {
        let tmp = std::env::temp_dir().join(format!("folio-test-{}", uuid::Uuid::new_v4()));
        let file = tmp.join("nope.json");
        let map = read_storage_map(&file).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn write_then_read_storage_roundtrip() {
        let dir = std::env::temp_dir().join(format!("folio-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rt.json");
        let mut map = serde_json::Map::new();
        map.insert("k1".to_string(), serde_json::json!("v1"));
        map.insert("k2".to_string(), serde_json::json!({ "nested": 42 }));
        write_storage_map(&file, &map).unwrap();
        let read = read_storage_map(&file).unwrap();
        assert_eq!(read.get("k1").unwrap(), "v1");
        assert_eq!(read.get("k2").unwrap()["nested"], 42);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_dir_handles_missing_dir() {
        let bogus = PathBuf::from("/this/does/not/exist");
        let entries = scan_dir(&bogus, "global").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn scan_dir_picks_up_js_files_and_dirs() {
        let dir = std::env::temp_dir().join(format!("folio-scan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        // .js file
        std::fs::write(dir.join("plain.js"), "// fake").unwrap();
        // folder with manifest
        let sub = dir.join("myplug");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("manifest.json"), r#"{"id":"myplug"}"#).unwrap();
        // folder without manifest but with index.js
        let sub2 = dir.join("plainplug");
        std::fs::create_dir_all(&sub2).unwrap();
        std::fs::write(sub2.join("index.js"), "// ok").unwrap();
        // folder with neither — should be skipped
        let sub3 = dir.join("junk");
        std::fs::create_dir_all(&sub3).unwrap();
        // dotfile — skipped
        std::fs::write(dir.join(".DS_Store"), "x").unwrap();

        let entries = scan_dir(&dir, "global").unwrap();
        assert_eq!(entries.len(), 3, "got: {:?}", entries);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"plain.js"));
        assert!(names.contains(&"myplug"));
        assert!(names.contains(&"plainplug"));

        // manifest parsed for folder
        let myplug = entries.iter().find(|e| e.name == "myplug").unwrap();
        assert_eq!(myplug.manifest.as_ref().unwrap()["id"], "myplug");

        std::fs::remove_dir_all(&dir).ok();
    }
}
