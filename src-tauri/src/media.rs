//! Media directory management for imported images (PRD §5.5.1).
//!
//! Imported images (e.g. from a Notion zip) are copied into
//! `{app_data_dir}/media/{page_id}/{filename}` so they live alongside the
//! database file. The stored ProseMirror `image` node references them via
//! a relative path (`media/{page_id}/{filename}`); the frontend resolves
//! these to a `convertFileSrc` URL at render time.

use std::path::{Path, PathBuf};

/// Return the `media/` directory under the app data dir, creating it if
/// necessary.
pub fn media_dir(app_data_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = app_data_dir.join("media");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Copy a source file into `media/{page_id}/{filename}`. Returns the relative
/// path string (e.g. `media/{page_id}/{filename}`) for storage in ProseMirror
/// JSON or a database cell.
pub fn copy_to_media(
    app_data_dir: &Path,
    src: &Path,
    page_id: &str,
) -> crate::Result<String> {
    let dir = app_data_dir.join("media").join(page_id);
    std::fs::create_dir_all(&dir)?;

    let original_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    // Prefix with uuid to avoid collisions across imports of the same name.
    let stored_name = format!("{}_{}", uuid::Uuid::new_v4(), original_name);
    let dest = dir.join(&stored_name);
    std::fs::copy(src, &dest)?;

    Ok(format!("media/{page_id}/{stored_name}"))
}

/// Write raw bytes (e.g. extracted from a zip) into `media/{page_id}/{filename}`.
/// Returns the relative path string.
pub fn write_bytes_to_media(
    app_data_dir: &Path,
    bytes: &[u8],
    page_id: &str,
    filename: &str,
) -> crate::Result<String> {
    let dir = app_data_dir.join("media").join(page_id);
    std::fs::create_dir_all(&dir)?;

    let safe_name = sanitize_filename(filename);
    let stored_name = format!("{}_{}", uuid::Uuid::new_v4(), safe_name);
    let dest = dir.join(&stored_name);
    std::fs::write(&dest, bytes)?;

    Ok(format!("media/{page_id}/{stored_name}"))
}

/// Resolve a relative media path (e.g. `media/{page_id}/{file}`) to an
/// absolute filesystem path. Used when packaging media into export zips.
pub fn resolve_media_path(app_data_dir: &Path, rel: &str) -> PathBuf {
    app_data_dir.join(rel)
}

/// Strip characters that are unsafe in filenames on Windows/macOS/Linux.
fn sanitize_filename(name: &str) -> String {
    name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_unsafe_chars() {
        assert_eq!(sanitize_filename("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_filename("normal file.png"), "normal file.png");
    }
}
