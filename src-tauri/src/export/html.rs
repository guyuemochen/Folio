//! ProseMirror JSON → standalone HTML document serializer (PRD §5.5.2 export).
//!
//! Produces a complete, browser-openable HTML document (with inline CSS) so
//! the exported file renders correctly without any external assets. The block
//! inventory mirrors [`crate::export::markdown`].

use crate::prosemirror::{self, attr_str, content, node_type, text_of, Value};
use crate::Result;

/// Convert a stored ProseMirror document into a full standalone HTML string.
/// `title` becomes the `<title>` and a leading `<h1>`.
pub fn serialize(doc: &Value, title: &str) -> Result<String> {
    let body = serialize_blocks(content(doc));
    let safe_title = escape_html(title);
    Ok(format!(
        "<!DOCTYPE html>\n\
         <html lang=\"en\">\n\
         <head>\n\
         <meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{safe_title}</title>\n\
         <style>{STYLES}</style>\n\
         </head>\n\
         <body>\n\
         <article>\n\
         <h1>{safe_title}</h1>\n\
         {body}\n\
         </article>\n\
         </body>\n\
         </html>\n"
    ))
}

fn serialize_blocks(nodes: &[Value]) -> String {
    nodes
        .iter()
        .map(serialize_block)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn serialize_block(node: &Value) -> String {
    match node_type(node) {
        "paragraph" => {
            let inner = serialize_inline_seq(content(node));
            if inner.is_empty() {
                "<p></p>".to_string()
            } else {
                format!("<p>{inner}</p>")
            }
        }
        "heading" => {
            let level = prosemirror::attr_int(node, "level", 1).clamp(1, 6);
            let inner = serialize_inline_seq(content(node));
            format!("<h{level}>{inner}</h{level}>")
        }
        "codeBlock" => serialize_code_block(node),
        "blockquote" => {
            let inner = serialize_blocks(content(node));
            format!("<blockquote>\n{inner}\n</blockquote>")
        }
        "horizontalRule" => "<hr>".to_string(),
        "bulletList" => serialize_list(node, false, false),
        "orderedList" => serialize_list(node, true, false),
        "taskList" => serialize_list(node, false, true),
        "table" => serialize_table(node),
        "callout" => serialize_callout(node),
        "toggle" => serialize_toggle(node),
        "equation" => {
            let latex = escape_html(attr_str(node, "latex", ""));
            format!("<div class=\"equation\">{latex}</div>")
        }
        "bookmark" => {
            let url = attr_str(node, "url", "");
            let title = escape_html(attr_str(node, "title", ""));
            let desc = escape_html(attr_str(node, "description", ""));
            if url.is_empty() {
                String::new()
            } else {
                format!(
                    "<a class=\"bookmark\" href=\"{url}\"><strong>{title}</strong><span>{desc}</span></a>"
                )
            }
        }
        "embed" => {
            let src = attr_str(node, "src", "");
            let caption = escape_html(attr_str(node, "caption", ""));
            if src.is_empty() {
                String::new()
            } else if caption.is_empty() {
                format!("<iframe src=\"{src}\" loading=\"lazy\"></iframe>")
            } else {
                format!("<figure><iframe src=\"{src}\" loading=\"lazy\"></iframe><figcaption>{caption}</figcaption></figure>")
            }
        }
        "columns" => {
            let cols: Vec<String> = content(node)
                .iter()
                .filter(|c| node_type(c) == "column")
                .map(|c| format!("<div class=\"column\">\n{}\n</div>", serialize_blocks(content(c))))
                .collect();
            if cols.is_empty() {
                String::new()
            } else {
                format!("<div class=\"columns\">\n{}\n</div>", cols.join("\n"))
            }
        }
        "column" => format!("<div class=\"column\">\n{}\n</div>", serialize_blocks(content(node))),
        "linkedDatabase" => {
            let id = attr_str(node, "sourceDatabaseId", "");
            format!("<div class=\"linked-database\" data-source-id=\"{id}\">🔗 Linked database</div>")
        }
        _ => String::new(),
    }
}

fn serialize_code_block(node: &Value) -> String {
    let lang = attr_str(node, "language", "");
    let body: String = content(node).iter().map(text_of).collect::<Vec<_>>().join("");
    let escaped = escape_html(&body);
    if lang.is_empty() {
        format!("<pre><code>{escaped}</code></pre>")
    } else {
        format!("<pre><code class=\"language-{lang}\">{escaped}</code></pre>")
    }
}

fn serialize_list(node: &Value, ordered: bool, task: bool) -> String {
    let tag = if ordered { "ol" } else { "ul" };
    let class = if task { " class=\"task-list\"" } else { "" };
    let mut items = String::new();
    for item in content(node) {
        let checkbox = if task {
            let checked = prosemirror::attr_bool(item, "checked", false);
            let attr = if checked { "checked " } else { "" };
            format!("<input type=\"checkbox\" {attr}disabled> ")
        } else {
            String::new()
        };
        // listItem/taskItem content is block+; render inline for the common case.
        let inner = serialize_blocks(content(item));
        items.push_str(&format!("<li>{checkbox}{inner}</li>\n"));
    }
    format!("<{tag}{class}>\n{items}</{tag}>")
}

fn serialize_table(node: &Value) -> String {
    let mut rows_html = String::new();
    for row in content(node) {
        if node_type(row) != "tableRow" {
            continue;
        }
        let mut cells = String::new();
        for cell in content(row) {
            let inner = serialize_inline_seq(content(cell));
            match node_type(cell) {
                "tableHeader" => cells.push_str(&format!("<th>{inner}</th>")),
                "tableCell" => cells.push_str(&format!("<td>{inner}</td>")),
                _ => {}
            }
        }
        rows_html.push_str(&format!("<tr>{cells}</tr>\n"));
    }
    format!("<table>\n{rows_html}</table>")
}

fn serialize_callout(node: &Value) -> String {
    let variant = attr_str(node, "variant", "blue");
    let icon = attr_str(node, "icon", "💡");
    let inner = serialize_blocks(content(node));
    format!(
        "<blockquote class=\"callout\" data-variant=\"{variant}\">\n\
         <span class=\"callout-icon\">{icon}</span>\n\
         <div class=\"callout-body\">\n{inner}\n</div>\n\
         </blockquote>"
    )
}

fn serialize_toggle(node: &Value) -> String {
    let children = content(node);
    let summary = children.first().map(serialize_block).unwrap_or_default();
    let body = if children.len() > 1 {
        serialize_blocks(&children[1..])
    } else {
        String::new()
    };
    let summary_text = strip_outer_tags(&summary);
    format!(
        "<details>\n<summary>{summary_text}</summary>\n{body}\n</details>"
    )
}

/// Strip a single wrapping `<p>…</p>` so summaries render as inline text.
fn strip_outer_tags(html: &str) -> String {
    let trimmed = html.trim();
    if trimmed.starts_with("<p>") && trimmed.ends_with("</p>") {
        trimmed[3..trimmed.len() - 4].to_string()
    } else {
        trimmed.to_string()
    }
}

fn serialize_inline_seq(nodes: &[Value]) -> String {
    nodes.iter().map(serialize_inline).collect::<Vec<_>>().join("")
}

fn serialize_inline(node: &Value) -> String {
    match node_type(node) {
        "text" => serialize_text(node),
        "hardBreak" => "<br>".to_string(),
        "image" => {
            let src = attr_str(node, "src", "");
            let alt = escape_html(attr_str(node, "alt", ""));
            let title = attr_str(node, "title", "");
            if title.is_empty() {
                format!("<img src=\"{src}\" alt=\"{alt}\">")
            } else {
                format!("<img src=\"{src}\" alt=\"{alt}\" title=\"{}\">", escape_html(title))
            }
        }
        "subPage" => {
            let title = escape_html(attr_str(node, "title", "Untitled"));
            let icon = attr_str(node, "icon", "📄");
            format!("<a class=\"subpage\">{icon} {title}</a>")
        }
        _ => escape_html(text_of(node)),
    }
}

fn serialize_text(node: &Value) -> String {
    let raw = text_of(node);
    let mut s = escape_html(raw);
    // Wrap marks as nested tags. Order is mostly cosmetic for HTML.
    if prosemirror::has_mark(node, "bold") {
        s = format!("<strong>{s}</strong>");
    }
    if prosemirror::has_mark(node, "italic") {
        s = format!("<em>{s}</em>");
    }
    if prosemirror::has_mark(node, "strike") {
        s = format!("<del>{s}</del>");
    }
    if prosemirror::has_mark(node, "underline") {
        s = format!("<u>{s}</u>");
    }
    if prosemirror::has_mark(node, "highlight") {
        s = format!("<mark>{s}</mark>");
    }
    if prosemirror::has_mark(node, "code") {
        s = format!("<code>{s}</code>");
    }
    if let Some(color_mark) = prosemirror::get_mark(node, "color") {
        let color = attr_str(color_mark, "color", "");
        if !color.is_empty() {
            s = format!("<span style=\"color:{color}\">{s}</span>");
        }
    }
    if let Some(link) = prosemirror::get_mark(node, "link") {
        let href = escape_html(attr_str(link, "href", ""));
        if !href.is_empty() {
            s = format!("<a href=\"{href}\">{s}</a>");
        }
    }
    s
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// Minimal readable stylesheet for exported HTML. Keeps the file
/// browser-openable without any external assets.
const STYLES: &str = r#"
:root { color-scheme: light dark; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
       max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6;
       color: #1f2328; background: #fff; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } }
article h1 { font-size: 2rem; border-bottom: 1px solid #d0d7de; padding-bottom: .3rem; }
h1,h2,h3 { line-height: 1.25; margin: 1.5em 0 .5em; }
a { color: #0969da; }
@media (prefers-color-scheme: dark) { a { color: #4493f8; } }
code { font-family: "SFMono-Regular", Consolas, monospace; font-size: .9em;
       background: rgba(175,184,193,.2); padding: .15em .35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
@media (prefers-color-scheme: dark) { pre { background: #161b22; } }
blockquote { border-left: 3px solid #d0d7de; padding-left: 1rem; color: #57606a; margin: 0; }
@media (prefers-color-scheme: dark) { blockquote { border-color: #30363d; color: #8b949e; } }
blockquote.callout { border-left-color: #0969da; }
blockquote.callout .callout-icon { font-size: 1.2em; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d0d7de; padding: .4rem .6rem; text-align: left; }
.task-list { list-style: none; padding-left: 0; }
.columns { display: flex; gap: 1.5rem; }
.columns .column { flex: 1; }
.equation { font-family: "Cambria Math", serif; text-align: center; margin: 1rem 0; }
.bookmark { display: block; border: 1px solid #d0d7de; border-radius: 6px; padding: .75rem 1rem;
            text-decoration: none; color: inherit; }
.bookmark strong { display: block; }
.bookmark span { color: #57606a; font-size: .9em; }
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(blocks: &[Value]) -> Value {
        json!({ "type": "doc", "content": blocks })
    }

    #[test]
    fn produces_full_html_document() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{ "type": "text", "text": "hi" }]
        })]);
        let out = serialize(&d, "My Page").unwrap();
        assert!(out.starts_with("<!DOCTYPE html>"));
        assert!(out.contains("<title>My Page</title>"));
        assert!(out.contains("<h1>My Page</h1>"));
        assert!(out.contains("<p>hi</p>"));
        assert!(out.contains("</html>"));
    }

    #[test]
    fn escapes_html_in_text() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{ "type": "text", "text": "<script>alert(1)</script>" }]
        })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("&lt;script&gt;"));
        assert!(!out.contains("<script>alert"));
    }

    #[test]
    fn heading_uses_correct_level() {
        let d = doc(&[json!({
            "type": "heading", "attrs": { "level": 3 },
            "content": [{ "type": "text", "text": "Sub" }]
        })]);
        assert!(serialize(&d, "t").unwrap().contains("<h3>Sub</h3>"));
    }

    #[test]
    fn code_block_with_language_class() {
        let d = doc(&[json!({
            "type": "codeBlock", "attrs": { "language": "js" },
            "content": [{ "type": "text", "text": "const x = 1;" }]
        })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("<pre><code class=\"language-js\">const x = 1;</code></pre>"));
    }

    #[test]
    fn marks_produce_correct_tags() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{
                "type": "text", "text": "x",
                "marks": [
                    { "type": "bold" },
                    { "type": "italic" },
                    { "type": "link", "attrs": { "href": "https://e.com" } }
                ]
            }]
        })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("<a href=\"https://e.com\">"));
        assert!(out.contains("<strong>"));
        assert!(out.contains("<em>"));
    }

    #[test]
    fn task_list_has_checkboxes() {
        let d = doc(&[json!({
            "type": "taskList",
            "content": [{
                "type": "taskItem", "attrs": { "checked": true },
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "ok" }]}]
            }]
        })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("<ul class=\"task-list\">"));
        assert!(out.contains("type=\"checkbox\""));
        assert!(out.contains("checked"));
    }

    #[test]
    fn toggle_uses_details_summary() {
        let d = doc(&[json!({
            "type": "toggle",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "Summary" }]},
                { "type": "paragraph", "content": [{ "type": "text", "text": "Body" }]}
            ]
        })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("<details>"));
        assert!(out.contains("<summary>Summary</summary>"));
        assert!(out.contains("<p>Body</p>"));
    }

    #[test]
    fn image_node() {
        let d = doc(&[json!({
            "type": "paragraph",
            "content": [{ "type": "image", "attrs": { "src": "/a.png", "alt": "A" } }]
        })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("<img src=\"/a.png\" alt=\"A\">"));
    }

    #[test]
    fn linked_database_placeholder() {
        let d = doc(&[json!({ "type": "linkedDatabase", "attrs": { "sourceDatabaseId": "x9" } })]);
        let out = serialize(&d, "t").unwrap();
        assert!(out.contains("data-source-id=\"x9\""));
    }
}
