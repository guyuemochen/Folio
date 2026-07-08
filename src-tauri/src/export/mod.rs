//! Export pipeline (PRD §5.5.2).
//!
//! Converts stored ProseMirror documents back into portable formats.
//! All serializers are pure functions: `(&Value) -> Result<String>`.
//!
//! - [`markdown`] — ProseMirror JSON → Markdown string
//! - [`html`]     — ProseMirror JSON → standalone HTML document string
//! - [`workspace`] — Full workspace → base64-encoded zip (MD or HTML + sitemap)
//! - [`backup`]   — Folio Backup (SQLite + assets) → base64-encoded zip

pub mod markdown;
pub mod html;
pub mod workspace;
pub mod backup;

/// The export format requested by the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Markdown,
    Html,
}

impl ExportFormat {
    /// Parse the format string sent over the Tauri IPC boundary.
    /// Returns `None` for anything that isn't `"markdown"` or `"html"`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "markdown" | "md" => Some(Self::Markdown),
            "html" | "htm" => Some(Self::Html),
            _ => None,
        }
    }

    /// The file extension (without leading dot) for this format.
    #[allow(dead_code)] // used by Phase 4 workspace export for filenames
    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Html => "html",
        }
    }
}
