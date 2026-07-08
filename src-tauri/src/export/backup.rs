//! Folio Backup create / restore (PRD §5.5.2).
//!
//! A backup is a zip containing the SQLite database file (`data.db`),
//! the `attachments/` directory (file attachments), the `media/` directory
//! (imported images), and a `manifest.json` with version metadata.
//!
//! **Create**: `VACUUM INTO` produces a clean copy of the DB; we zip it with
//! the asset directories and base64-encode the result.
//!
//! **Restore**: decode the base64, unzip, validate the manifest, and overwrite
//! the live files. Because the DB connection is held by `AppState`, the
//! restore writes the files and signals the frontend to restart — the app
//! reopens the restored DB on next launch.

use std::io::{Cursor, Write};
use std::path::Path;

use crate::Result;
use rusqlite::Connection;

const BACKUP_VERSION: u32 = 1;

/// Create a backup. Returns a base64-encoded zip string.
///
/// `db_path` is the live `data.db` file path; `app_data_dir` is the root
/// containing `attachments/` and `media/`.
pub fn create_backup(conn: &Connection, app_data_dir: &Path) -> Result<String> {
    // VACUUM INTO a temp file for a clean, defragmented copy.
    let temp_db = app_data_dir.join(format!(".folio-backup-{}.db", uuid::Uuid::new_v4()));
    let vacuum_sql = format!("VACUUM INTO '{}'", temp_db.display().to_string().replace('\'', "''"));
    conn.execute_batch(&vacuum_sql)?;

    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();

        // manifest.json
        let workspace_id: String = conn
            .query_row("SELECT id FROM workspace LIMIT 1", [], |r| r.get(0))
            .unwrap_or_default();
        let manifest = serde_json::json!({
            "version": BACKUP_VERSION,
            "workspaceId": workspace_id,
            "createdAt": chrono::Utc::now().to_rfc3339(),
            "app": "folio",
        });
        zip.start_file("manifest.json", opts)
            .map_err(|e| crate::Error::Other(format!("zip manifest: {e}")))?;
        zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;

        // data.db
        zip.start_file("data.db", opts)
            .map_err(|e| crate::Error::Other(format!("zip data.db: {e}")))?;
        let db_bytes = std::fs::read(&temp_db)?;
        zip.write_all(&db_bytes)?;

        // attachments/ (if it exists)
        add_dir_to_zip(&mut zip, &app_data_dir.join("attachments"), "attachments", opts)?;

        // media/ (if it exists)
        add_dir_to_zip(&mut zip, &app_data_dir.join("media"), "media", opts)?;

        zip.finish()
            .map_err(|e| crate::Error::Other(format!("zip finish: {e}")))?;
    }

    // Clean up temp DB.
    let _ = std::fs::remove_file(&temp_db);

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf.into_inner());
    Ok(b64)
}

/// Restore a backup. Writes the files to `app_data_dir`; the caller should
/// signal the frontend to restart so the DB connection reopens on the new file.
///
/// Returns `true` if a restart is needed (files were overwritten).
pub fn restore_backup(app_data_dir: &Path, backup_b64: &str) -> Result<bool> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, backup_b64)
        .map_err(|e| crate::Error::Other(format!("base64 decode: {e}")))?;
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| crate::Error::Other(format!("zip open: {e}")))?;

    // Validate manifest before touching any files.
    let manifest_entry = archive
        .by_name("manifest.json")
        .map_err(|_| crate::Error::Other("backup missing manifest.json".into()))?;
    let manifest: serde_json::Value = serde_json::from_reader(manifest_entry)
        .map_err(|e| crate::Error::Other(format!("manifest parse: {e}")))?;
    let version = manifest
        .get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if version > BACKUP_VERSION as u64 {
        return Err(crate::Error::Other(format!(
            "backup version {version} is newer than supported {BACKUP_VERSION}"
        )));
    }

    // Extract everything to app_data_dir.
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| crate::Error::Other(format!("zip entry {i}: {e}")))?;
        let name = entry.name().to_string();
        if name == "manifest.json" || name.starts_with('/') || name.contains("..") {
            continue;
        }
        let out_path = app_data_dir.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }

    Ok(true) // restart needed
}

/// Recursively add a directory's contents to the zip under `prefix`.
fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<&mut Cursor<Vec<u8>>>,
    dir: &Path,
    prefix: &str,
    opts: zip::write::SimpleFileOptions,
) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|e| crate::Error::Other(format!("read {}: {e}", dir.display())))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let zip_name = format!("{prefix}/{name}");
        if path.is_dir() {
            add_dir_to_zip(zip, &path, &zip_name, opts)?;
        } else {
            zip.start_file(&zip_name, opts)
                .map_err(|e| crate::Error::Other(format!("zip {zip_name}: {e}")))?;
            let bytes = std::fs::read(&path)?;
            zip.write_all(&bytes)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_version_is_one() {
        // Bumping this requires a migration path — assert it's deliberate.
        assert_eq!(BACKUP_VERSION, 1);
    }
}
