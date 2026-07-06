//! ProseMirror JSON → Markdown serializer (PRD §5.5.2 export).
//!
//! Hand-written walker over `serde_json::Value`. We don't use a crate here
//! because comrak/similar parsers go MD→AST, not AST→MD, and Folio's custom
//! nodes (callout/toggle/columns/equation/…) have no crate representation.
//!
//! Block inventory handled (must match `src/editor/Editor.tsx`):
//!   paragraph, heading, bulletList, orderedList, listItem, codeBlock,
//!   blockquote, horizontalRule, taskList, taskItem, table*,
//!   callout, toggle, equation, bookmark, embed, columns/column,
//!   linkedDatabase.
//! Inline: text (with marks), hardBreak, image, subPage.
//! Marks: bold, italic, strike, code, link, underline, highlight.
//!   (textStyle/color have no clean MD equivalent → dropped.)

use crate::prosemirror::{self, attr_str, content, node_type, text_of, Value};
use crate::Result;

/// Which list variant we're serializing.
enum ListKind {
    Unordered,
    Ordered,
    Task,
}

/// Convert a stored ProseMirror document JSON value into a Markdown string.
pub fn serialize(doc: &Value) -> Result<String> {
    Ok(serialize_blocks(content(doc)).trim_end().to_string() + "\n")
}

/// Serialize a sequence of sibling block nodes, joined by a blank line.
fn serialize_blocks(nodes: &[Value]) -> String {
    nodes
        .iter()
        .map(serialize_block)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Dispatch one block node to its serializer.
fn serialize_block(node: &Value) -> String {
    match node_type(node) {
        "paragraph" => serialize_inline_seq(content(node)),
        "heading" => {
            let level = prosemirror::attr_int(node, "level", 1).clamp(1, 6) as usize;
            "#".repeat(level) + " " + &serialize_inline_seq(content(node))
        }
        "codeBlock" => serialize_code_block(node),
        "blockquote" => serialize_blockquote(node),
        "horizontalRule" => "---".to_string(),
        "bulletList" => serialize_list(node, ListKind::Unordered, 0),
        "orderedList" => serialize_list(node, ListKind::Ordered, 0),
        "taskList" => serialize_list(node, ListKind::Task, 0),
        "table" => serialize_table(node),
        "callout" => serialize_callout(node),
        "toggle" => serialize_toggle(node),
        "equation" => {
            let latex = attr_str(node, "latex", "");
            format!("$$\n{latex}\n$$")
        }
        "bookmark" => {
            let url = attr_str(node, "url", "");
            let title = attr_str(node, "title", "");
            let label = if title.is_empty() { url } else { title };
            if url.is_empty() {
                String::new()
            } else {
                format!("[{}]({})", escape_inline(label), url)
            }
        }
        "embed" => {
            let src = attr_str(node, "src", "");
            if src.is_empty() {
                String::new()
            } else {
                format!("[embed]({src})")
            }
        }
        "columns" => {
            // Flatten column children sequentially (MD has no column layout).
            content(node)
                .iter()
                .filter(|c| node_type(c) == "column")
                .map(|c| serialize_blocks(content(c)))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n")
        }
        "column" => serialize_blocks(content(node)),
        "linkedDatabase" => {
            // Atom with no MD equivalent — drop with a comment placeholder so
            // users see something was here and re-import can detect it.
            let id = attr_str(node, "sourceDatabaseId", "");
            format!("<!-- linked database: {id} -->")
        }
        // Unknown / listItem / taskItem / tableRow … handled by their parents.
        // Falling back to an empty block keeps the doc well-formed.
        _ => String::new(),
    }
}

fn serialize_code_block(node: &Value) -> String {
    let lang = attr_str(node, "language", "");
    // codeBlock content is a flat run of text nodes — concatenate raw text.
    let body: String = content(node).iter().map(text_of).collect::<Vec<_>>().join("");
    let fence = pick_fence(&body);
    format!("{fence}{lang}\n{body}\n{fence}")
}

/// Pick a fence longer than the longest run of backticks in the body, so the
/// closing fence is never ambiguous (CommonMark rule).
fn pick_fence(body: &str) -> String {
    let longest = body.split(|c| c != '`').map(|run| run.len()).max().unwrap_or(0);
    "`".repeat((longest + 1).max(3))
}

fn serialize_blockquote(node: &Value) -> String {
    let inner = serialize_blocks(content(node));
    inner
        .lines()
        .map(|line| format!("> {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn serialize_list(node: &Value, kind: ListKind, depth: usize) -> String {
    let mut out = String::new();
    let mut ordered_idx = 1usize;
    for item in content(node) {
        let prefix = match &kind {
            ListKind::Unordered => "- ".to_string(),
            ListKind::Ordered => format!("{ordered_idx}. "),
            ListKind::Task => {
                if prosemirror::attr_bool(item, "checked", false) {
                    "- [x] ".to_string()
                } else {
                    "- [ ] ".to_string()
                }
            }
        };
        let children = content(item);
        let first = children.first();
        let rest = if children.is_empty() { &[] as &[Value] } else { &children[1..] };
        let indent = " ".repeat(prefix.len());
        let mut block_text = String::new();
        if let Some(first) = first {
            block_text.push_str(&serialize_block(first));
        }
        for r in rest {
            block_text.push_str("\n\n");
            block_text.push_str(&serialize_block(r));
        }
        // Nested lists appear as a child block of the item.
        let nested: Vec<String> = children
            .iter()
            .filter(|c| matches!(node_type(c), "bulletList" | "orderedList" | "taskList"))
            .map(|c| serialize_list(c, list_kind_of(c), depth + 1))
            .collect();
        if !nested.is_empty() {
            block_text.push('\n');
            for n in nested {
                block_text.push_str(&n);
            }
        }
        // Indent every line after the first under the marker column.
        let pad = format!("{indent}{}", "  ".repeat(depth));
        let lines: Vec<String> = block_text
            .split('\n')
            .enumerate()
            .map(|(i, line)| {
                if i == 0 || line.is_empty() {
                    line.to_string()
                } else {
                    format!("{pad}{}", line.trim_start())
                }
            })
            .collect();
        out.push_str(&prefix);
        out.push_str(&lines.join("\n"));
        out.push('\n');
        ordered_idx += 1;
    }
    // Trim the single trailing newline added by the loop.
    out.trim_end_matches('\n').to_string()
}

fn list_kind_of(node: &Value) -> ListKind {
    match node_type(node) {
        "orderedList" => ListKind::Ordered,
        "taskList" => ListKind::Task,
        _ => ListKind::Unordered,
    }
}

fn serialize_table(node: &Value) -> String {
    let mut rendered_rows: Vec<Vec<String>> = Vec::new();
    for row in content(node) {
        if node_type(row) != "tableRow" {
            continue;
        }
        let cells: Vec<String> = content(row)
            .iter()
            .filter(|c| matches!(node_type(c), "tableHeader" | "tableCell"))
            .map(|c| {
                serialize_inline_seq(content(c))
                    .replace('|', "\\|")
                    .replace('\n', " ")
            })
            .collect();
        rendered_rows.push(cells);
    }
    if rendered_rows.is_empty() {
        return String::new();
    }
    let n_cols = rendered_rows.iter().map(|r| r.len()).max().unwrap_or(0);
    let pad_to = |row: &Vec<String>| -> Vec<String> {
        let mut v = row.clone();
        v.resize(n_cols, String::new());
        v
    };
    let mut out = String::new();
    // Header (first row) + separator.
    if let Some(header) = rendered_rows.first() {
        out.push_str("| ");
        out.push_str(&pad_to(header).join(" | "));
        out.push_str(" |\n");
        out.push('|');
        for _ in 0..n_cols {
            out.push_str(" --- |");
        }
        out.push('\n');
    }
    for row in rendered_rows.iter().skip(1) {
        out.push_str("| ");
        out.push_str(&pad_to(row).join(" | "));
        out.push_str(" |\n");
    }
    out.trim_end().to_string()
}

fn serialize_callout(node: &Value) -> String {
    let icon = attr_str(node, "icon", "💡");
    let inner = serialize_blocks(content(node));
    let mut out = String::new();
    for (i, line) in inner.lines().enumerate() {
        if i == 0 {
            out.push_str(&format!("> {icon} {line}"));
        } else {
            out.push_str(&format!("\n> {line}"));
        }
    }
    out
}

fn serialize_toggle(node: &Value) -> String {
    // `<details><summary>S</summary>` is valid HTML-in-MD (CommonMark §6.7).
    let children = content(node);
    let summary = children.first().map(serialize_block).unwrap_or_default();
    let body = if children.len() > 1 {
        serialize_blocks(&children[1..])
    } else {
        String::new()
    };
    let summary_escaped = escape_html(&summary);
    format!("<details>\n<summary>{summary_escaped}</summary>\n\n{body}\n\n</details>")
}

/// Serialize a flat sequence of inline nodes (paragraph/heading/cell content).
fn serialize_inline_seq(nodes: &[Value]) -> String {
    nodes.iter().map(serialize_inline).collect::<Vec<_>>().join("")
}

/// Serialize one inline node (text with marks, hardBreak, image, subPage).
fn serialize_inline(node: &Value) -> String {
    match node_type(node) {
        "text" => serialize_text(node),
        "hardBreak" => "  \n".to_string(),
        "image" => {
            let src = attr_str(node, "src", "");
            let alt = attr_str(node, "alt", "");
            let title = attr_str(node, "title", "");
            if title.is_empty() {
                format!("![{}]({})", escape_inline(alt), src)
            } else {
                format!("![{}]({} \"{}\")", escape_inline(alt), src, escape_inline(title))
            }
        }
        "subPage" => {
            let title = attr_str(node, "title", "Untitled");
            let page_id = attr_str(node, "pageId", "");
            format!("[{}](folio://{page_id})", escape_inline(title))
        }
        _ => text_of(node).to_string(),
    }
}

/// Serialize a text node, applying its marks as nested delimiters.
fn serialize_text(node: &Value) -> String {
    let raw = text_of(node);
    // `code` mark is innermost and exclusive — render verbatim and bail.
    // Inline code spans use the minimum backtick run that disambiguates the
    // content (1 for normal text, n+1 if the content contains n backticks).
    if prosemirror::has_mark(node, "code") {
        let longest = raw.split(|c| c != '`').map(|r| r.len()).max().unwrap_or(0);
        let fence = "`".repeat(longest + 1);
        return format!("{fence}{raw}{fence}");
    }
    let mut s = escape_inline(raw);
    if prosemirror::has_mark(node, "bold") {
        s = format!("**{s}**");
    }
    if prosemirror::has_mark(node, "italic") {
        s = format!("*{s}*");
    }
    if prosemirror::has_mark(node, "strike") {
        s = format!("~~{s}~~");
    }
    if prosemirror::has_mark(node, "highlight") {
        s = format!("=={s}==");
    }
    if prosemirror::has_mark(node, "underline") {
        s = format!("<u>{s}</u>");
    }
    if let Some(link) = prosemirror::get_mark(node, "link") {
        let href = attr_str(link, "href", "");
        if !href.is_empty() {
            s = format!("[{s}]({href})");
        }
    }
    s
}

/// Escape characters that could be interpreted as Markdown syntax in running text.
fn escape_inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' | '`' | '*' | '_' | '[' | ']' | '#' | '<' | '|' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Minimal HTML-escaping for text placed inside `<summary>` etc.
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(blocks: &[Value]) -> Value {
        json!({ "type": "doc", "content": blocks })
    }

    #[test]
    fn empty_doc_produces_newline() {
        let d = doc(&[]);
        assert_eq!(serialize(&d).unwrap(), "\n");
    }

    #[test]
    fn single_paragraph() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Hello world" }]
        })]);
        assert_eq!(serialize(&d).unwrap(), "Hello world\n");
    }

    #[test]
    fn heading_levels() {
        let d = doc(&[json!({
            "type": "heading", "attrs": { "level": 2 },
            "content": [{ "type": "text", "text": "Title" }]
        })]);
        assert_eq!(serialize(&d).unwrap(), "## Title\n");
    }

    #[test]
    fn markdown_special_chars_are_escaped() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{ "type": "text", "text": "a * b [c] <d>" }]
        })]);
        // `<` is escaped (prevents HTML parsing); `>` is left literal.
        assert_eq!(serialize(&d).unwrap(), "a \\* b \\[c\\] \\<d>\n");
    }

    #[test]
    fn code_block_with_language() {
        let d = doc(&[json!({
            "type": "codeBlock", "attrs": { "language": "rust" },
            "content": [{ "type": "text", "text": "fn main() {}" }]
        })]);
        assert_eq!(serialize(&d).unwrap(), "```rust\nfn main() {}\n```\n");
    }

    #[test]
    fn code_block_backtick_fence_grows() {
        let d = doc(&[json!({
            "type": "codeBlock", "attrs": { "language": "" },
            "content": [{ "type": "text", "text": "a `` b" }]
        })]);
        // longest backtick run is 2 → fence length 3
        assert_eq!(serialize(&d).unwrap(), "```\na `` b\n```\n");
    }

    #[test]
    fn bold_italic_link_marks() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{
                "type": "text", "text": "link",
                "marks": [
                    { "type": "bold" },
                    { "type": "link", "attrs": { "href": "https://x.io" } }
                ]
            }]
        })]);
        assert_eq!(serialize(&d).unwrap(), "[**link**](https://x.io)\n");
    }

    #[test]
    fn code_mark_wins_over_other_marks() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{
                "type": "text", "text": "x*y",
                "marks": [ { "type": "bold" }, { "type": "code" } ]
            }]
        })]);
        // code content is verbatim — no escaping, no bold wrapping
        assert_eq!(serialize(&d).unwrap(), "`x*y`\n");
    }

    #[test]
    fn unordered_list() {
        let d = doc(&[json!({
            "type": "bulletList",
            "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "one" }]}]},
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "two" }]}]}
            ]
        })]);
        assert_eq!(serialize(&d).unwrap(), "- one\n- two\n");
    }

    #[test]
    fn task_list() {
        let d = doc(&[json!({
            "type": "taskList",
            "content": [
                { "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "todo" }]}]},
                { "type": "taskItem", "attrs": { "checked": true }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "done" }]}]}
            ]
        })]);
        assert_eq!(serialize(&d).unwrap(), "- [ ] todo\n- [x] done\n");
    }

    #[test]
    fn blockquote() {
        let d = doc(&[json!({
            "type": "blockquote",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "quoted" }]}]
        })]);
        assert_eq!(serialize(&d).unwrap(), "> quoted\n");
    }

    #[test]
    fn horizontal_rule() {
        let d = doc(&[json!({ "type": "horizontalRule" })]);
        assert_eq!(serialize(&d).unwrap(), "---\n");
    }

    #[test]
    fn table_gfm() {
        let d = doc(&[json!({
            "type": "table",
            "content": [{
                "type": "tableRow",
                "content": [
                    { "type": "tableHeader", "content": [{ "type": "text", "text": "A" }]},
                    { "type": "tableHeader", "content": [{ "type": "text", "text": "B" }]}
                ]
            }, {
                "type": "tableRow",
                "content": [
                    { "type": "tableCell", "content": [{ "type": "text", "text": "1" }]},
                    { "type": "tableCell", "content": [{ "type": "text", "text": "2" }]}
                ]
            }]
        })]);
        let out = serialize(&d).unwrap();
        assert!(out.contains("| A | B |"));
        assert!(out.contains("| --- | --- |"));
        assert!(out.contains("| 1 | 2 |"));
    }

    #[test]
    fn callout_emits_blockquote_with_icon() {
        let d = doc(&[json!({
            "type": "callout", "attrs": { "variant": "blue", "icon": "💡" },
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "note" }]}]
        })]);
        assert_eq!(serialize(&d).unwrap(), "> 💡 note\n");
    }

    #[test]
    fn equation_block() {
        let d = doc(&[json!({ "type": "equation", "attrs": { "latex": "E=mc^2" } })]);
        assert_eq!(serialize(&d).unwrap(), "$$\nE=mc^2\n$$\n");
    }

    #[test]
    fn linked_database_drops_with_comment() {
        let d = doc(&[json!({ "type": "linkedDatabase", "attrs": { "sourceDatabaseId": "abc123" } })]);
        assert_eq!(serialize(&d).unwrap(), "<!-- linked database: abc123 -->\n");
    }

    #[test]
    fn columns_flatten_sequentially() {
        let d = doc(&[json!({
            "type": "columns",
            "content": [
                { "type": "column", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "left" }]}]},
                { "type": "column", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "right" }]}]}
            ]
        })]);
        assert_eq!(serialize(&d).unwrap(), "left\n\nright\n");
    }

    #[test]
    fn image_node() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{ "type": "image", "attrs": { "src": "/x.png", "alt": "pic", "title": "T" } }]
        })]);
        assert_eq!(serialize(&d).unwrap(), "![pic](/x.png \"T\")\n");
    }

    #[test]
    fn hard_break() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [
                { "type": "text", "text": "line1" },
                { "type": "hardBreak" },
                { "type": "text", "text": "line2" }
            ]
        })]);
        assert_eq!(serialize(&d).unwrap(), "line1  \nline2\n");
    }
}
