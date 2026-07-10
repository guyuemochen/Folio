//! ProseMirror document helpers.
//!
//! The editor persists each page as a TipTap/ProseMirror document JSON string
//! in `page_doc.doc`. This module provides typed navigation helpers over that
//! JSON so importers/exporters don't sprinkle `.get("type").unwrap()` calls
//! everywhere. We deliberately use `serde_json::Value` rather than rigid
//! structs because ProseMirror nodes carry heterogeneous `attrs` per node type
//! (a heading has `{level}`, a codeBlock has `{language}`, a callout has
//! `{variant, icon}`, …) — a tagged-enum of attr types would be more brittle
//! than the semi-structured JSON we already own.
//!
//! Node/marks inventory (must match the extensions registered in
//! `src/editor/Editor.tsx`):
//!
//! Block nodes: paragraph, heading, bulletList, orderedList, listItem,
//!   codeBlock, blockquote, horizontalRule, taskList, taskItem, table,
//!   tableRow, tableHeader, tableCell, callout, toggle, equation, bookmark,
//!   embed, columns, column
//! Inline nodes: text, hardBreak, image, subPage, inlineMath
//! Marks: bold, italic, strike, code, link, underline, textStyle, color,
//!   highlight

// Re-export so callers (`export::*`) can write `crate::prosemirror::Value`.
pub use serde_json::Value;

/// The canonical empty ProseMirror document (single empty paragraph).
pub fn empty_doc() -> Value {
    serde_json::json!({
        "type": "doc",
        "content": [{ "type": "paragraph" }]
    })
}

/// Parse a stored `page_doc.doc` string. Returns `empty_doc()` if the string
/// is invalid JSON or not an object — never panics. This mirrors the
/// frontend's `tryParseDoc` fallback (`src/editor/Editor.tsx`).
pub fn parse_doc(stored: &str) -> Value {
    serde_json::from_str::<Value>(stored)
        .ok()
        .filter(|v| v.is_object())
        .unwrap_or_else(empty_doc)
}

/// Get the `"type"` field of a node as `&str`, or `""` if absent/non-string.
pub fn node_type(node: &Value) -> &str {
    node.get("type").and_then(|t| t.as_str()).unwrap_or("")
}

/// Get the `"content"` array of a node, or an empty slice if absent.
pub fn content<'a>(node: &'a Value) -> &'a [Value] {
    node.get("content")
        .and_then(|c| c.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[])
}

/// Get the `"text"` field of a text node, or `""`.
pub fn text_of(node: &Value) -> &str {
    node.get("text").and_then(|t| t.as_str()).unwrap_or("")
}

/// Get the `"attrs"` object of a node, or an empty object if absent.
pub fn attrs(node: &Value) -> &Value {
    node.get("attrs").unwrap_or(&Value::Null)
}

/// Read a string attr: `attrs[key]` as `&str`, falling back to `default`.
pub fn attr_str<'a>(node: &'a Value, key: &str, default: &'a str) -> &'a str {
    attrs(node)
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
}

/// Read an integer attr: `attrs[key]` as `i64`, falling back to `default`.
pub fn attr_int(node: &Value, key: &str, default: i64) -> i64 {
    attrs(node)
        .get(key)
        .and_then(|v| v.as_i64())
        .unwrap_or(default)
}

/// Read a boolean attr: `attrs[key]` as `bool`, falling back to `default`.
pub fn attr_bool(node: &Value, key: &str, default: bool) -> bool {
    attrs(node)
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

/// Get the `"marks"` array of an inline/text node, or an empty slice.
pub fn marks<'a>(node: &'a Value) -> &'a [Value] {
    node.get("marks")
        .and_then(|m| m.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[])
}

/// Does this text node carry a mark of the given type?
pub fn has_mark(node: &Value, mark_type: &str) -> bool {
    marks(node)
        .iter()
        .any(|m| m.get("type").and_then(|t| t.as_str()) == Some(mark_type))
}

/// Return the first mark of `mark_type` on the node, if any.
pub fn get_mark<'a>(node: &'a Value, mark_type: &str) -> Option<&'a Value> {
    marks(node)
        .iter()
        .find(|m| m.get("type").and_then(|t| t.as_str()) == Some(mark_type))
}

/// Extract a human-readable title from the first text content in the doc.
/// Used by importers to name the newly created page. Returns `"Imported"` if
/// no text is found. Truncated to 100 characters.
pub fn extract_title(doc: &Value) -> String {
    fn first_text(node: &Value) -> Option<&str> {
        if node_type(node) == "text" {
            let t = text_of(node);
            return if t.is_empty() { None } else { Some(t) };
        }
        for child in content(node) {
            if let Some(t) = first_text(child) {
                return Some(t);
            }
        }
        None
    }
    first_text(doc)
        .map(|t| t.chars().take(100).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Imported".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_doc_is_valid_doc() {
        let d = empty_doc();
        assert_eq!(node_type(&d), "doc");
        assert_eq!(content(&d).len(), 1);
        assert_eq!(node_type(&content(&d)[0]), "paragraph");
    }

    #[test]
    fn parse_doc_falls_back_on_garbage() {
        let d = parse_doc("not json");
        assert_eq!(node_type(&d), "doc");
    }

    #[test]
    fn parse_doc_falls_back_on_non_object() {
        let d = parse_doc("[1, 2, 3]");
        assert_eq!(node_type(&d), "doc");
    }

    #[test]
    fn attr_accessors_default_safely() {
        let node = serde_json::json!({ "type": "heading", "attrs": { "level": 3 } });
        assert_eq!(attr_int(&node, "level", 1), 3);
        assert_eq!(attr_int(&node, "missing", 1), 1);
        assert_eq!(attr_str(&node, "missing", "x"), "x");
        assert!(!attr_bool(&node, "missing", false));
    }

    #[test]
    fn mark_helpers_detect_and_fetch() {
        let node = serde_json::json!({
            "type": "text",
            "text": "hi",
            "marks": [
                { "type": "bold" },
                { "type": "link", "attrs": { "href": "https://x" } }
            ]
        });
        assert!(has_mark(&node, "bold"));
        assert!(!has_mark(&node, "italic"));
        let link = get_mark(&node, "link").expect("link mark present");
        assert_eq!(attr_str(link, "href", ""), "https://x");
    }
}
