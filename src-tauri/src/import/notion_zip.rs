//! Notion Markdown zip → Folio page tree converter (PRD §5.5.1).
//!
//! Notion's "Export → Markdown & CSV" produces a zip with:
//!   `{title} {32-char-hex-id}.md`  — one page per file
//!   `{title} {32-char-hex-id}/`    — sibling dir with subpages + images
//!   `{db-name} {hex}.csv`           — database export
//!
//! We extract to a temp dir, walk the tree, strip hex IDs from titles,
//! parse .md via the existing markdown converter, copy images to media/,
//! and import .csv files as databases. The directory nesting defines the
//! parent-child page hierarchy.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::import::ImportResult;
use crate::{media, prosemirror, db, import, database, Result};
use rusqlite::Connection;

/// Import a Notion Markdown export zip. Creates a page tree under
/// `parent_id` (or workspace root). Returns a summary of what was imported.
pub fn import_notion_zip(
    conn: &Connection,
    workspace_id: &str,
    app_data_dir: &Path,
    zip_path: &str,
    parent_id: Option<&str>,
) -> Result<ImportResult> {
    let mut result = ImportResult::new();

    // Extract zip to a unique temp dir.
    let temp_dir = std::env::temp_dir().join(format!("folio-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)?;
    extract_zip(zip_path, &temp_dir)?;

    // Find the effective root: if there's a single top-level dir, descend into it.
    let root = find_effective_root(&temp_dir);

    // Walk the tree recursively, creating pages.
    process_directory(conn, workspace_id, app_data_dir, &root, parent_id, &mut result)?;

    // Clean up temp dir (best-effort).
    let _ = std::fs::remove_dir_all(&temp_dir);

    Ok(result)
}

/// Recursively process a directory: create pages from .md files, databases
/// from .csv files, and recurse into subdirectories.
fn process_directory(
    conn: &Connection,
    workspace_id: &str,
    app_data_dir: &Path,
    dir: &Path,
    parent_id: Option<&str>,
    result: &mut ImportResult,
) -> Result<()> {
    let entries = collect_entries(dir);

    // Phase 1: create pages from .md files.
    let mut page_by_stem: HashMap<String, String> = HashMap::new(); // stem → page_id
    for md_file in &entries.md_files {
        let stem = md_file.file_stem().and_then(|s| s.to_str()).unwrap_or("page").to_string();
        let title = strip_hex_id(&stem);
        let md_text = std::fs::read_to_string(md_file)
            .map_err(|e| crate::Error::Other(format!("read {}: {e}", md_file.display())))?;

        let doc_value = import::markdown::convert(&md_text)?;

        // Find and copy referenced images, rewrite their src.
        let doc_value = process_images(conn, workspace_id, app_data_dir, &doc_value, md_file, &entries.image_files)?;

        let doc_json = serde_json::to_string(&doc_value)
            .map_err(|e| crate::Error::Other(format!("json: {e}")))?;
        let resolved_title = if title.is_empty() {
            prosemirror::extract_title(&doc_value)
        } else {
            title
        };

        let parent_type = if parent_id.is_some() { "page" } else { "workspace" };
        let page = db::create_page(conn, workspace_id, parent_id, parent_type, Some(&resolved_title), None)?;
        db::update_page_doc(conn, &page.id, &doc_json)?;
        page_by_stem.insert(stem, page.id);
        result.pages_created += 1;
    }

    // Phase 2: import .csv files as databases.
    for csv_file in &entries.csv_files {
        let name = csv_file
            .file_stem()
            .and_then(|s| s.to_str())
            .map(strip_hex_id)
            .unwrap_or_else(|| "Imported Database".to_string());
        let csv_text = std::fs::read_to_string(csv_file)
            .map_err(|e| crate::Error::Other(format!("read {}: {e}", csv_file.display())))?;
        match import::csv::import_csv(conn, workspace_id, parent_id, &csv_text, Some(&name)) {
            Ok(_) => result.pages_created += 1,
            Err(e) => result.warnings.push(format!("CSV import failed ({}): {e}", csv_file.display())),
        }
    }

    // Phase 3: recurse into subdirectories.
    for subdir in &entries.subdirs {
        let subdir_name = subdir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        // If this subdir matches a .md stem, its contents are children of that page.
        let effective_parent = page_by_stem
            .get(&subdir_name)
            .map(|id| id.as_str());
        process_directory(conn, workspace_id, app_data_dir, subdir, effective_parent, result)?;
    }

    Ok(())
}

/// Walk image src attributes in the doc, find matching files in the zip
/// extraction, copy them to media/, and rewrite src to the relative path.
fn process_images(
    conn: &Connection,
    _workspace_id: &str,
    app_data_dir: &Path,
    doc: &serde_json::Value,
    md_file: &Path,
    available_images: &[PathBuf],
) -> Result<serde_json::Value> {
    let _ = conn; // unused — kept for future DB-backed image tracking
    let mut doc = doc.clone();
    rewrite_image_srcs(&mut doc, app_data_dir, md_file, available_images);
    Ok(doc)
}

/// Recursively walk the doc JSON, finding `image` nodes and rewriting `src`.
fn rewrite_image_srcs(
    node: &mut serde_json::Value,
    app_data_dir: &Path,
    md_file: &Path,
    available_images: &[PathBuf],
) {
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            if prosemirror::node_type(child) == "image" {
                if let Some(attrs) = child.get_mut("attrs").and_then(|a| a.as_object_mut()) {
                    if let Some(src) = attrs.get("src").and_then(|s| s.as_str()) {
                        if let Some(rewritten) = resolve_and_copy_image(src, app_data_dir, md_file, available_images) {
                            attrs.insert("src".to_string(), serde_json::Value::String(rewritten));
                        }
                    }
                }
            }
            rewrite_image_srcs(child, app_data_dir, md_file, available_images);
        }
    }
}

/// Try to find an image file matching `src` in the extracted zip, copy it
/// to media/, and return the relative path. Returns None if not found or
/// if src is already an absolute/remote URL.
fn resolve_and_copy_image(
    src: &str,
    app_data_dir: &Path,
    md_file: &Path,
    available_images: &[PathBuf],
) -> Option<String> {
    // Skip remote URLs and data: URIs.
    if src.starts_with("http://") || src.starts_with("https://") || src.starts_with("data:") {
        return None;
    }
    let decoded = urldecode(src);
    let basename = Path::new(&decoded)
        .file_name()
        .and_then(|n| n.to_str())?
        .to_string();

    // Find a matching image file (by basename) among the extracted images.
    let matched = available_images.iter().find(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n == basename || urldecode(n) == decoded)
    })?;

    // Generate a stable page id from the md file path for the media subfolder.
    // We use the md file's stem (without hex) as a human-readable folder name.
    let pseudo_page_id = md_file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("imported");
    let pseudo_page_id = strip_hex_id(pseudo_page_id);
    let pseudo_page_id = if pseudo_page_id.is_empty() {
        "imported".to_string()
    } else {
        pseudo_page_id
    };

    media::write_bytes_to_media(app_data_dir, &std::fs::read(matched).ok()?, &pseudo_page_id, &basename).ok()
}

// =============================================================================
// Directory walking helpers
// =============================================================================

struct DirEntries {
    md_files: Vec<PathBuf>,
    csv_files: Vec<PathBuf>,
    subdirs: Vec<PathBuf>,
    image_files: Vec<PathBuf>,
}

fn collect_entries(dir: &Path) -> DirEntries {
    let mut md_files = Vec::new();
    let mut csv_files = Vec::new();
    let mut subdirs = Vec::new();
    let mut image_files = Vec::new();
    let image_exts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"];

    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                subdirs.push(path);
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                match ext_lower.as_str() {
                    "md" | "markdown" => md_files.push(path),
                    "csv" => csv_files.push(path),
                    _ if image_exts.contains(&ext_lower.as_str()) => image_files.push(path),
                    _ => {} // ignore other file types
                }
            }
        }
    }
    DirEntries { md_files, csv_files, subdirs, image_files }
}

/// If `dir` contains exactly one subdirectory, descend into it (Notion wraps
/// everything in `Export-{hash}/`).
fn find_effective_root(dir: &Path) -> PathBuf {
    let entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    if entries.len() == 1 && entries[0].is_dir() {
        entries[0].clone()
    } else {
        dir.to_path_buf()
    }
}

// =============================================================================
// String utilities
// =============================================================================

/// Strip a trailing ` {32-hex-chars}` suffix from Notion filenames.
/// Falls back to the original if the pattern doesn't match.
fn strip_hex_id(name: &str) -> String {
    // Match ` <32 hex chars>` at the end.
    if name.len() > 33 {
        let suffix = &name[name.len() - 33..];
        if suffix.starts_with(' ') && suffix[1..].chars().all(|c| c.is_ascii_hexdigit()) {
            return name[..name.len() - 33].trim_end().to_string();
        }
    }
    name.to_string()
}

/// Minimal percent-decoding for URL-encoded paths in Notion exports.
fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Extract a zip file to a directory.
fn extract_zip(zip_path: &str, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| crate::Error::Other(format!("zip open: {e}")))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| crate::Error::Other(format!("zip entry {i}: {e}")))?;
        let entry_name = entry.name().to_string();
        // Guard against zip-slip: reject absolute paths and `..` components.
        if entry_name.starts_with('/') || entry_name.contains("..") {
            continue;
        }
        let out_path = dest.join(&entry_name);
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_hex_removes_trailing_id() {
        // Notion uses exactly 32 hex chars after a space.
        assert_eq!(
            strip_hex_id("My Page abc123def456789012345678abcdef01"),
            "My Page"
        );
    }

    #[test]
    fn strip_hex_keeps_name_without_id() {
        assert_eq!(strip_hex_id("Simple Title"), "Simple Title");
    }

    #[test]
    fn strip_hex_keeps_short_names() {
        assert_eq!(strip_hex_id("Abc"), "Abc");
    }

    #[test]
    fn urldecode_basic() {
        assert_eq!(urldecode("hello%20world"), "hello world");
        assert_eq!(urldecode("100%25.png"), "100%.png");
    }

    #[test]
    fn urldecode_passthrough_unencoded() {
        assert_eq!(urldecode("normal_path.md"), "normal_path.md");
    }
}

// Silence unused-import warnings for symbols used only when certain code paths
// are active (e.g., `database` will be used by future CSV-in-zip handling).
#[allow(unused_imports)]
use database as _database;
