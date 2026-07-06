//! Markdown → ProseMirror JSON converter (PRD §5.5.1 import).
//!
//! Uses comrak to parse GFM Markdown into a CommonMark AST, then walks the AST
//! to build a ProseMirror document JSON value. The output is persisted via
//! `create_page` + `update_page_doc` by the Tauri command layer.
//!
//! Node mapping (must match the extensions in `src/editor/Editor.tsx`):
//!   Paragraph→paragraph, Heading→heading, CodeBlock→codeBlock,
//!   BlockQuote→blockquote, ThematicBreak→horizontalRule,
//!   List(bullet)→bulletList, List(ordered)→orderedList,
//!   List(task)/TaskItem→taskList/taskItem, Table→table,
//!   Strong/Emph/Strikethrough/Underline/Code/Link→marks,
//!   Image→image, SoftBreak/LineBreak→hardBreak.

use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, Options};
use serde_json::{json, Value};

use crate::Result;

/// Convert a GFM Markdown string into a ProseMirror document JSON value.
pub fn convert(md: &str) -> Result<Value> {
    let arena = Arena::new();
    let root = parse_document(&arena, md, &parse_options());
    let blocks: Vec<Value> = root.children().map(convert_block).collect();
    Ok(json!({ "type": "doc", "content": blocks }))
}

fn parse_options() -> Options<'static> {
    let mut opts = Options::default();
    opts.extension.table = true;
    opts.extension.strikethrough = true;
    opts.extension.tasklist = true;
    opts.extension.autolink = true;
    opts
}

// =============================================================================
// Block conversion
// =============================================================================

fn convert_block<'a>(node: &'a AstNode<'a>) -> Value {
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Paragraph => json!({ "type": "paragraph", "content": convert_inlines(node, &[]) }),
        NodeValue::Heading(h) => json!({
            "type": "heading",
            "attrs": { "level": h.level },
            "content": convert_inlines(node, &[])
        }),
        NodeValue::CodeBlock(cb) => {
            let lang = cb.info.split_whitespace().next().unwrap_or("").to_string();
            json!({
                "type": "codeBlock",
                "attrs": { "language": lang },
                "content": [{ "type": "text", "text": cb.literal }]
            })
        }
        NodeValue::BlockQuote => {
            json!({ "type": "blockquote", "content": convert_child_blocks(node) })
        }
        NodeValue::ThematicBreak => json!({ "type": "horizontalRule" }),
        NodeValue::List(list) => convert_list(node, list),
        NodeValue::Table(_) => convert_table(node),
        // HTML blocks, footnotes, frontmatter etc. — degrade to paragraph of raw text.
        NodeValue::HtmlBlock(hb) => {
            let text = hb.literal.trim().to_string();
            if text.is_empty() {
                json!({ "type": "paragraph" })
            } else {
                json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
            }
        }
        _ => {
            // Unknown block — try its children (covers Document wrapper, etc.)
            let children = convert_child_blocks(node);
            if children.is_empty() {
                json!({ "type": "paragraph" })
            } else {
                // Wrap in a paragraph if the children look inline; otherwise just first child.
                children.into_iter().next().unwrap_or(json!({ "type": "paragraph" }))
            }
        }
    }
}

fn convert_child_blocks<'a>(node: &'a AstNode<'a>) -> Vec<Value> {
    node.children().map(convert_block).collect()
}

fn convert_list<'a>(node: &'a AstNode<'a>, list: comrak::nodes::NodeList) -> Value {
    use comrak::nodes::ListType;
    if list.is_task_list {
        let items: Vec<Value> = node.children().map(convert_task_item).collect();
        json!({ "type": "taskList", "content": items })
    } else if list.list_type == ListType::Ordered {
        let items: Vec<Value> = node.children().map(convert_list_item).collect();
        json!({ "type": "orderedList", "content": items })
    } else {
        let items: Vec<Value> = node.children().map(convert_list_item).collect();
        json!({ "type": "bulletList", "content": items })
    }
}

fn convert_list_item<'a>(node: &'a AstNode<'a>) -> Value {
    json!({ "type": "listItem", "content": convert_child_blocks(node) })
}

fn convert_task_item<'a>(node: &'a AstNode<'a>) -> Value {
    // TaskItem(NodeTaskItem { symbol: Option<char>, ... }): Some = checked.
    let checked = matches!(
        &node.data.borrow().value,
        NodeValue::TaskItem(ti) if ti.symbol.is_some()
    );
    json!({
        "type": "taskItem",
        "attrs": { "checked": checked },
        "content": convert_child_blocks(node)
    })
}

fn convert_table<'a>(node: &'a AstNode<'a>) -> Value {
    let rows: Vec<Value> = node
        .children()
        .filter(|r| matches!(r.data.borrow().value, NodeValue::TableRow(_)))
        .map(|row| {
            let is_header = matches!(&row.data.borrow().value, NodeValue::TableRow(h) if *h);
            let cells: Vec<Value> = row
                .children()
                .filter(|c| matches!(c.data.borrow().value, NodeValue::TableCell))
                .map(|cell| {
                    let cell_type = if is_header { "tableHeader" } else { "tableCell" };
                    json!({ "type": cell_type, "content": convert_inlines(cell, &[]) })
                })
                .collect();
            json!({ "type": "tableRow", "content": cells })
        })
        .collect();
    json!({ "type": "table", "content": rows })
}

// =============================================================================
// Inline conversion
// =============================================================================

/// Walk inline children of `node`, building ProseMirror text/image/hardBreak
/// nodes. `marks` carries the accumulated mark context (bold/italic/link/…).
fn convert_inlines<'a>(node: &'a AstNode<'a>, marks: &[Value]) -> Vec<Value> {
    let mut result: Vec<Value> = Vec::new();
    for child in node.children() {
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(t) => {
                result.push(make_text(t.as_ref(), marks));
            }
            NodeValue::SoftBreak | NodeValue::LineBreak => {
                result.push(json!({ "type": "hardBreak" }));
            }
            NodeValue::Code(code) => {
                let mut m = marks.to_vec();
                m.push(json!({ "type": "code" }));
                result.push(make_text(&code.literal, &m));
            }
            NodeValue::Strong => {
                let mut m = marks.to_vec();
                m.push(json!({ "type": "bold" }));
                result.extend(convert_inlines(child, &m));
            }
            NodeValue::Emph => {
                let mut m = marks.to_vec();
                m.push(json!({ "type": "italic" }));
                result.extend(convert_inlines(child, &m));
            }
            NodeValue::Strikethrough => {
                let mut m = marks.to_vec();
                m.push(json!({ "type": "strike" }));
                result.extend(convert_inlines(child, &m));
            }
            NodeValue::Underline => {
                let mut m = marks.to_vec();
                m.push(json!({ "type": "underline" }));
                result.extend(convert_inlines(child, &m));
            }
            NodeValue::Link(link) => {
                let mut m = marks.to_vec();
                m.push(json!({ "type": "link", "attrs": { "href": link.url } }));
                result.extend(convert_inlines(child, &m));
            }
            NodeValue::Image(link) => {
                // Image children are alt-text inlines; collect as plain string.
                let alt = collect_text(child);
                result.push(json!({
                    "type": "image",
                    "attrs": { "src": link.url, "alt": alt, "title": link.title }
                }));
            }
            NodeValue::HtmlInline(html) => {
                let tag = html.trim().to_lowercase();
                if tag == "<br>" || tag == "<br/>" || tag == "<br />" {
                    result.push(json!({ "type": "hardBreak" }));
                }
                // Other raw HTML inlines are dropped (MVP fidelity trade-off).
            }
            _ => {
                // Unknown inline — skip rather than produce garbage.
            }
        }
    }
    // ProseMirror requires at least an empty content array for some consumers,
    // but empty paragraphs are valid as {type:"paragraph"} with no content key.
    result
}

/// Build a ProseMirror text node, omitting `marks` when empty (cleaner JSON).
fn make_text(text: &str, marks: &[Value]) -> Value {
    if marks.is_empty() {
        json!({ "type": "text", "text": text })
    } else {
        json!({ "type": "text", "text": text, "marks": marks })
    }
}

/// Concatenate all descendant Text node literals into a plain string.
/// Used to extract alt text from Image children.
fn collect_text<'a>(node: &'a AstNode<'a>) -> String {
    let mut buf = String::new();
    collect_text_into(node, &mut buf);
    buf
}

fn collect_text_into<'a>(node: &'a AstNode<'a>, buf: &mut String) {
    for child in node.children() {
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(t) => buf.push_str(&t),
            NodeValue::SoftBreak => buf.push(' '),
            _ => collect_text_into(child, buf),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content_of(doc: &Value) -> &[Value] {
        doc.get("content").and_then(|c| c.as_array()).map(|a| a.as_slice()).unwrap_or(&[])
    }

    #[test]
    fn empty_markdown() {
        let d = convert("").unwrap();
        assert_eq!(d["type"], "doc");
        assert_eq!(content_of(&d).len(), 0);
    }

    #[test]
    fn heading_and_paragraph() {
        let d = convert("# Title\n\nHello world").unwrap();
        let blocks = content_of(&d);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "heading");
        assert_eq!(blocks[0]["attrs"]["level"], 1);
        assert_eq!(blocks[1]["type"], "paragraph");
        assert_eq!(blocks[1]["content"][0]["text"], "Hello world");
    }

    #[test]
    fn bold_and_italic_marks() {
        let d = convert("**bold** and *italic*").unwrap();
        let para = &content_of(&d)[0];
        let inlines = para["content"].as_array().unwrap();
        // First text node has bold mark
        assert_eq!(inlines[0]["marks"][0]["type"], "bold");
        assert_eq!(inlines[0]["text"], "bold");
        // Third text node has italic mark
        assert_eq!(inlines[2]["marks"][0]["type"], "italic");
        assert_eq!(inlines[2]["text"], "italic");
    }

    #[test]
    fn code_block_with_language() {
        let d = convert("```rust\nfn main() {}\n```").unwrap();
        let block = &content_of(&d)[0];
        assert_eq!(block["type"], "codeBlock");
        assert_eq!(block["attrs"]["language"], "rust");
        assert!(block["content"][0]["text"].as_str().unwrap().contains("fn main()"));
    }

    #[test]
    fn bullet_list() {
        let d = convert("- one\n- two\n- three").unwrap();
        let block = &content_of(&d)[0];
        assert_eq!(block["type"], "bulletList");
        assert_eq!(block["content"].as_array().unwrap().len(), 3);
        assert_eq!(block["content"][0]["type"], "listItem");
    }

    #[test]
    fn ordered_list() {
        let d = convert("1. first\n2. second").unwrap();
        let block = &content_of(&d)[0];
        assert_eq!(block["type"], "orderedList");
    }

    #[test]
    fn task_list() {
        let d = convert("- [ ] todo\n- [x] done").unwrap();
        let block = &content_of(&d)[0];
        assert_eq!(block["type"], "taskList");
        let items = block["content"].as_array().unwrap();
        assert_eq!(items[0]["attrs"]["checked"], false);
        assert_eq!(items[1]["attrs"]["checked"], true);
    }

    #[test]
    fn blockquote() {
        let d = convert("> quoted text").unwrap();
        let block = &content_of(&d)[0];
        assert_eq!(block["type"], "blockquote");
        assert_eq!(block["content"][0]["type"], "paragraph");
    }

    #[test]
    fn horizontal_rule() {
        let d = convert("---\n\ntext").unwrap();
        let blocks = content_of(&d);
        assert_eq!(blocks[0]["type"], "horizontalRule");
    }

    #[test]
    fn link_mark() {
        let d = convert("[click](https://x.io)").unwrap();
        let para = &content_of(&d)[0];
        let text_node = &para["content"][0];
        assert_eq!(text_node["text"], "click");
        assert_eq!(text_node["marks"][0]["type"], "link");
        assert_eq!(text_node["marks"][0]["attrs"]["href"], "https://x.io");
    }

    #[test]
    fn inline_code() {
        let d = convert("Use `cargo` to build").unwrap();
        let para = &content_of(&d)[0];
        let inlines = para["content"].as_array().unwrap();
        // Find the code text node
        let code_node = inlines.iter().find(|n| {
            n["marks"].as_array().map_or(false, |m| m.iter().any(|mark| mark["type"] == "code"))
        }).expect("code mark present");
        assert_eq!(code_node["text"], "cargo");
    }

    #[test]
    fn image_node() {
        let d = convert("![alt text](/img.png \"Title\")").unwrap();
        let para = &content_of(&d)[0];
        let img = &para["content"][0];
        assert_eq!(img["type"], "image");
        assert_eq!(img["attrs"]["src"], "/img.png");
        assert_eq!(img["attrs"]["alt"], "alt text");
        assert_eq!(img["attrs"]["title"], "Title");
    }

    #[test]
    fn strikethrough() {
        let d = convert("~~deleted~~").unwrap();
        let para = &content_of(&d)[0];
        assert_eq!(para["content"][0]["marks"][0]["type"], "strike");
    }

    #[test]
    fn gfm_table() {
        let md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
        let d = convert(md).unwrap();
        let block = &content_of(&d)[0];
        assert_eq!(block["type"], "table");
        let rows = block["content"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        // First row is header
        assert_eq!(rows[0]["content"][0]["type"], "tableHeader");
        // Second row is data
        assert_eq!(rows[1]["content"][0]["type"], "tableCell");
    }

    #[test]
    fn hard_break() {
        // "line1  \nline2" — two trailing spaces = hard break
        let d = convert("line1  \nline2").unwrap();
        let para = &content_of(&d)[0];
        let inlines = para["content"].as_array().unwrap();
        // Should contain a hardBreak node
        assert!(inlines.iter().any(|n| n["type"] == "hardBreak"));
    }
}
