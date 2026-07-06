//! Import pipeline (PRD §5.5.1).
//!
//! Converts external formats into ProseMirror documents, which the Tauri
//! commands then persist via `create_page` + `update_page_doc`.
//!
//! All converters are pure functions: `(&str) -> Result<Value>`.
//!
//! - [`markdown`] — Markdown string → ProseMirror JSON (via comrak AST)
//! - [`html`]     — HTML string → ProseMirror JSON (via scraper DOM)

pub mod markdown;
pub mod html;

/// Summary returned by import commands. Serialized to the frontend so the UI
/// can show "imported N pages" / surface warnings.
#[allow(dead_code)] // used by Phase 3 (CSV/Notion zip import)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub pages_created: usize,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

impl ImportResult {
    #[allow(dead_code)] // used by Phase 3
    pub fn new() -> Self {
        Self {
            pages_created: 0,
            warnings: Vec::new(),
            errors: Vec::new(),
        }
    }
}

impl Default for ImportResult {
    fn default() -> Self {
        Self::new()
    }
}
