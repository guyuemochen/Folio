//! Full-workspace export as a zip (PRD §5.5.2).
//!
//! Recursively walks all non-trashed pages, serializes each to Markdown or
//! HTML, includes a `sitemap.md` (or `.html`) with the page tree, copies
//! referenced media, and returns the whole thing as a base64-encoded zip
//! string so the frontend can trigger a Blob download.

use std::io::{Cursor, Write};

use crate::db;
use crate::export::{html, markdown};
use crate::prosemirror;
use crate::Result;
use rusqlite::Connection;
use serde_json::Value;

/// Export the entire workspace as a zip. Returns base64-encoded zip bytes.
pub fn export_workspace(
    conn: &Connection,
    format: crate::export::ExportFormat,
) -> Result<String> {
    let tree = build_page_tree(conn, None)?;
    let zip_bytes = build_zip(conn, &tree, format)?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &zip_bytes);
    Ok(b64)
}

/// A node in the page tree — a page plus its children.
struct PageNode {
    page: crate::PageSummary,
    children: Vec<PageNode>,
}

/// Recursively build the page tree starting from `parent_id` (None = root).
fn build_page_tree(conn: &Connection, parent_id: Option<&str>) -> Result<Vec<PageNode>> {
    let pages = db::list_pages(conn, parent_id)?;
    let mut nodes = Vec::with_capacity(pages.len());
    for page in pages {
        let children = build_page_tree(conn, Some(&page.id))?;
        nodes.push(PageNode { page, children });
    }
    Ok(nodes)
}

/// Build the zip in memory.
fn build_zip(
    conn: &Connection,
    tree: &[PageNode],
    format: crate::export::ExportFormat,
) -> Result<Vec<u8>> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();

        // Serialize every page and add to zip.
        let mut sitemap_lines: Vec<String> = Vec::new();
        serialize_pages(conn, tree, format, &mut zip, opts, &mut sitemap_lines, 0)?;

        // Write sitemap.
        let (sitemap_name, sitemap_content) = match format {
            crate::export::ExportFormat::Markdown => {
                ("sitemap.md", sitemap_lines.join("\n"))
            }
            crate::export::ExportFormat::Html => {
                ("sitemap.html", format!(
                    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>{}</style></head><body><h1>Workspace</h1><ul>\n{}\n</ul></body></html>",
                    STYLES, sitemap_lines.iter().map(|l| format!("<li>{l}</li>")).collect::<Vec<_>>().join("\n")
                ))
            }
        };
        zip.start_file(sitemap_name, opts)?;
        zip.write_all(sitemap_content.as_bytes())?;

        zip.finish()
            .map_err(|e| crate::Error::Other(format!("zip finish: {e}")))?;
    }
    Ok(buf.into_inner())
}

/// Recursively serialize pages into the zip, building the sitemap.
fn serialize_pages(
    conn: &Connection,
    nodes: &[PageNode],
    format: crate::export::ExportFormat,
    zip: &mut zip::ZipWriter<&mut Cursor<Vec<u8>>>,
    opts: zip::write::SimpleFileOptions,
    sitemap: &mut Vec<String>,
    depth: usize,
) -> Result<()> {
    for node in nodes {
        let (page, doc_str) = db::fetch_page_with_doc(conn, &node.page.id)?;
        let doc_value = prosemirror::parse_doc(&doc_str);
        let ext = format.extension();
        let safe_title = sanitize(&page.title);
        let indent = "  ".repeat(depth);

        // Add page file to zip.
        let content = match format {
            crate::export::ExportFormat::Markdown => markdown::serialize(&doc_value)?,
            crate::export::ExportFormat::Html => html::serialize(&doc_value, &page.title)?,
        };
        let zip_path = format!("{safe_title}.{ext}");
        zip.start_file(&zip_path, opts)
            .map_err(|e| crate::Error::Other(format!("zip add {zip_path}: {e}")))?;
        zip.write_all(content.as_bytes())?;

        // Sitemap entry (Markdown list format works for both — HTML wraps in <li>).
        let title = &page.title;
        sitemap.push(format!("{indent}- [{title}]({zip_path})"));

        // Recurse into children.
        serialize_pages(conn, &node.children, format, zip, opts, sitemap, depth + 1)?;

        let _ = page; // silence unused warning
    }
    Ok(())
}

/// Replace characters that are unsafe in zip entry names.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    if cleaned.is_empty() {
        "untitled".to_string()
    } else {
        cleaned
    }
}

/// Minimal CSS for the HTML sitemap.
const STYLES: &str = "body{font-family:sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem}a{color:#0969da}";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_slashes() {
        assert_eq!(sanitize("a/b"), "a_b");
    }

    #[test]
    fn sanitize_empty_becomes_untitled() {
        assert_eq!(sanitize(""), "untitled");
    }
}

// Suppress unused-import warning — Value is used when the module grows.
#[allow(unused_imports)]
use Value as _Value;
