//! Media directory management for imported images (PRD §5.5.1).
//!
//! Imported images (e.g. from a Notion zip) are copied into
//! `{workspace_dir}/media/{page_id}/{filename}` so they live alongside the
//! database file. The stored ProseMirror `image` node references them via
//! a relative path (`media/{page_id}/{filename}`); the frontend resolves
//! these to a `convertFileSrc` URL at render time.
//!
//! **Note**: `workspace_dir` is the active workspace's folder path (from the
//! registry), NOT `app_data_dir`. This ensures media follows the workspace
//! when it's moved or backed up.

use std::path::{Path, PathBuf};

use base64::Engine;

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

// =============================================================================
// Inline image extraction / inflation
//
// Editor-uploaded images arrive as `data:image/png;base64,...` strings inline
// in the ProseMirror JSON. Left as-is, they cause:
//   - ~33% storage inflation (base64 encoding)
//   - Full-doc rewrite on every save (the entire base64 blob is re-written)
//   - Massive snapshot duplication (each snapshot copies all images)
//   - FTS5 indexing of base64 noise
//
// `extract_inline_images` runs on save: it walks the doc JSON, finds data URL
// image srcs, writes each to `{workspace_dir}/media/{page_id}/{uuid}.{ext}`,
// and replaces the src with a relative path. The stored doc becomes tiny.
//
// `inflate_media_paths` runs on load: it walks the doc JSON, finds relative
// `media/...` srcs, reads each file, and replaces the src with a data URL so
// the frontend `<img>` renders without any changes.
// =============================================================================

/// Walk a ProseMirror doc JSON string, extract any `data:image/...;base64,...`
/// image srcs to files, and replace them with relative `media/...` paths.
///
/// Returns the (possibly modified) JSON string. If no data URLs are found or
/// the JSON is invalid, the original string is returned unchanged.
pub fn extract_inline_images(
    doc_json: &str,
    page_id: &str,
    workspace_dir: &Path,
) -> crate::Result<String> {
    let mut doc: serde_json::Value = match serde_json::from_str::<serde_json::Value>(doc_json) {
        Ok(v) if v.is_object() => v,
        _ => return Ok(doc_json.to_string()),
    };

    let mut changed = false;
    walk_and_extract(&mut doc, page_id, workspace_dir, &mut changed)?;

    if changed {
        Ok(serde_json::to_string(&doc)?)
    } else {
        Ok(doc_json.to_string())
    }
}

fn walk_and_extract(
    node: &mut serde_json::Value,
    page_id: &str,
    workspace_dir: &Path,
    changed: &mut bool,
) -> crate::Result<()> {
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            // Check if this is an image node with a data URL src.
            if crate::prosemirror::node_type(child) == "image" {
                if let Some(attrs) = child.get_mut("attrs").and_then(|a| a.as_object_mut()) {
                    if let Some(src) = attrs.get("src").and_then(|s| s.as_str()) {
                        if src.starts_with("data:image/") {
                            match decode_and_save_data_url(src, page_id, workspace_dir) {
                                Ok(Some(rel_path)) => {
                                    attrs.insert(
                                        "src".to_string(),
                                        serde_json::Value::String(rel_path),
                                    );
                                    *changed = true;
                                }
                                Ok(None) => {} // unparseable data URL — leave as-is
                                Err(e) => {
                                    eprintln!("[folio] image extraction failed: {e}");
                                    // Keep the base64 — better large than broken.
                                }
                            }
                        }
                    }
                }
            }
            walk_and_extract(child, page_id, workspace_dir, changed)?;
        }
    }
    Ok(())
}

/// Decode a `data:image/{mime};base64,{data}` URL, write the decoded bytes
/// to `{workspace_dir}/media/{page_id}/{uuid}.{ext}`, and return the relative
/// path string. Returns `None` for non-base64 or unparseable data URLs.
fn decode_and_save_data_url(
    data_url: &str,
    page_id: &str,
    workspace_dir: &Path,
) -> crate::Result<Option<String>> {
    let (mime, data) = match parse_data_url(data_url) {
        Some(v) => v,
        None => return Ok(None),
    };
    if data.is_empty() {
        return Ok(None);
    }

    let ext = mime_to_extension(mime);
    let uuid = uuid::Uuid::new_v4().to_string();
    let filename = format!("{uuid}.{ext}");

    let dir = workspace_dir.join("media").join(page_id);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(&filename);
    std::fs::write(&dest, &data)?;

    Ok(Some(format!("media/{page_id}/{filename}")))
}

/// Parse `data:image/png;base64,iVBOR...` into `(mime_type, decoded_bytes)`.
fn parse_data_url(url: &str) -> Option<(&str, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let semicolon = rest.find(';')?;
    let mime = &rest[..semicolon];
    let after_semicolon = &rest[semicolon + 1..];
    let comma = after_semicolon.find(',')?;
    let encoding = &after_semicolon[..comma];
    let data_str = &after_semicolon[comma + 1..];

    if encoding != "base64" {
        return None;
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_str)
        .ok()?;
    Some((mime, data))
}

fn mime_to_extension(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/x-icon" => "ico",
        "image/tiff" => "tiff",
        _ => "png",
    }
}

fn extension_to_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        _ => "image/png",
    }
}

/// Walk a ProseMirror doc JSON string, find relative `media/...` image srcs,
/// read each file, and replace the src with a `data:image/...;base64,...` URL.
///
/// This is the inverse of `extract_inline_images`. The frontend receives data
/// URLs and renders them with zero changes to `<img src>`.
///
/// If a media file is missing or unreadable, the relative path is left as-is
/// (the frontend will show a broken image — same as a deleted file today).
pub fn inflate_media_paths(doc_json: &str, workspace_dir: &Path) -> crate::Result<String> {
    let mut doc: serde_json::Value = match serde_json::from_str::<serde_json::Value>(doc_json) {
        Ok(v) if v.is_object() => v,
        _ => return Ok(doc_json.to_string()),
    };

    let mut changed = false;
    walk_and_inflate(&mut doc, workspace_dir, &mut changed);

    if changed {
        Ok(serde_json::to_string(&doc)?)
    } else {
        Ok(doc_json.to_string())
    }
}

fn walk_and_inflate(node: &mut serde_json::Value, workspace_dir: &Path, changed: &mut bool) {
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            if crate::prosemirror::node_type(child) == "image" {
                if let Some(attrs) = child.get_mut("attrs").and_then(|a| a.as_object_mut()) {
                    if let Some(src) = attrs.get("src").and_then(|s| s.as_str()) {
                        if src.starts_with("media/") {
                            let abs_path = workspace_dir.join(src);
                            if let Ok(bytes) = std::fs::read(&abs_path) {
                                let ext = abs_path
                                    .extension()
                                    .and_then(|e| e.to_str())
                                    .unwrap_or("png");
                                let mime = extension_to_mime(ext);
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                                let data_url = format!("data:{mime};base64,{b64}");
                                attrs.insert(
                                    "src".to_string(),
                                    serde_json::Value::String(data_url),
                                );
                                *changed = true;
                            }
                        }
                    }
                }
            }
            walk_and_inflate(child, workspace_dir, changed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_unsafe_chars() {
        assert_eq!(sanitize_filename("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_filename("normal file.png"), "normal file.png");
    }

    #[test]
    fn parse_data_url_handles_png() {
        // 1x1 red pixel PNG.
        let b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        let url = format!("data:image/png;base64,{b64}");
        let (mime, data) = parse_data_url(&url).expect("parse");
        assert_eq!(mime, "image/png");
        assert!(!data.is_empty());
    }

    #[test]
    fn parse_data_url_rejects_non_base64() {
        assert!(parse_data_url("data:image/png;utf8,hello").is_none());
    }

    #[test]
    fn extract_replaces_data_url_with_relative_path() {
        let tmp = tempfile::tempdir().unwrap();
        let ws_dir = tmp.path();

        let b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "Before" }] },
                { "type": "image", "attrs": { "src": format!("data:image/png;base64,{b64}"), "alt": null, "title": null } },
                { "type": "paragraph", "content": [{ "type": "text", "text": "After" }] }
            ]
        });
        let doc_json = serde_json::to_string(&doc).unwrap();

        let cleaned = extract_inline_images(&doc_json, "page-1", ws_dir).unwrap();

        // The data URL should be gone, replaced with a media/ path.
        assert!(!cleaned.contains("data:image"), "data URL should be extracted");
        assert!(cleaned.contains("media/page-1/"), "should contain relative path");

        // The file should exist on disk.
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        let img_src = &parsed["content"][1]["attrs"]["src"];
        let rel = img_src.as_str().unwrap();
        let abs = ws_dir.join(rel);
        assert!(abs.exists(), "image file should be written to disk");
    }

    #[test]
    fn extract_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let ws_dir = tmp.path();

        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "No images here" }] }
            ]
        });
        let doc_json = serde_json::to_string(&doc).unwrap();

        let cleaned = extract_inline_images(&doc_json, "page-1", ws_dir).unwrap();
        assert_eq!(cleaned, doc_json, "doc without images should be unchanged");
    }

    #[test]
    fn extract_then_inflate_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let ws_dir = tmp.path();

        let b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "image", "attrs": { "src": format!("data:image/png;base64,{b64}"), "alt": null, "title": null } }
            ]
        });
        let original_json = serde_json::to_string(&doc).unwrap();

        // Extract → stores relative path.
        let cleaned = extract_inline_images(&original_json, "page-rt", ws_dir).unwrap();
        assert!(cleaned.contains("media/page-rt/"));

        // Inflate → should restore the data URL.
        let inflated = inflate_media_paths(&cleaned, ws_dir).unwrap();
        assert!(inflated.contains("data:image/png;base64,"), "inflate should restore data URL");

        // The decoded image bytes should match (compare the base64 payload).
        let parsed: serde_json::Value = serde_json::from_str(&inflated).unwrap();
        let restored_src = parsed["content"][0]["attrs"]["src"].as_str().unwrap();
        assert!(restored_src.contains(b64), "restored data URL should contain original base64");
    }

    #[test]
    fn inflate_leaves_data_urls_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let ws_dir = tmp.path();

        let b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "image", "attrs": { "src": format!("data:image/png;base64,{b64}") } }
            ]
        });
        let doc_json = serde_json::to_string(&doc).unwrap();

        let inflated = inflate_media_paths(&doc_json, ws_dir).unwrap();
        assert_eq!(inflated, doc_json, "existing data URLs should be untouched");
    }

    #[test]
    fn inflate_handles_missing_file_gracefully() {
        let tmp = tempfile::tempdir().unwrap();
        let ws_dir = tmp.path();

        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "image", "attrs": { "src": "media/page-missing/nonexistent.png" } }
            ]
        });
        let doc_json = serde_json::to_string(&doc).unwrap();

        // Should not error — just leave the path as-is.
        let inflated = inflate_media_paths(&doc_json, ws_dir).unwrap();
        assert!(inflated.contains("media/page-missing/"), "missing file path should be kept");
    }

    #[test]
    fn extract_handles_invalid_json_gracefully() {
        let tmp = tempfile::tempdir().unwrap();
        let result = extract_inline_images("not valid json", "p1", tmp.path()).unwrap();
        assert_eq!(result, "not valid json");
    }
}
