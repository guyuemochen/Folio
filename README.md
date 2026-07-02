# Folio

> Local-first, Notion-like desktop note app. Built with Tauri 2 + React 19 + TipTap + SQLite.

**Status**: M1 scaffold (in development) · **Not production-ready**

---

## Why

`Folio` is a local-first alternative to Notion. All data lives on your machine in a single SQLite file. No account, no cloud, no telemetry. See [`docs/research/00-overview.md`](./docs/research/00-overview.md) for the full product rationale and [`docs/prd/01-mvp-prd.md`](./docs/prd/01-mvp-prd.md) for the MVP spec.

## Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Tauri 2 (Rust core + system webview) |
| Frontend | React 19 + TypeScript 5.7 |
| Editor | TipTap v2 (ProseMirror) |
| State | Zustand + TanStack Query |
| Styling | Tailwind CSS v4 (`@theme` tokens) |
| Routing | React Router v7 |
| Storage | SQLite (rusqlite, WAL mode) |
| Build | Vite 6 + Tauri CLI |

## Project structure

```
Folio/
├── docs/
│   ├── research/         # 4 research docs (Notion + competitors + stack)
│   └── prd/              # MVP PRD (with decisions baked in)
├── src/                  # Frontend (React + TipTap)
│   ├── editor/           # TipTap editor components
│   ├── styles/           # globals.css with all design tokens
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/            # Rust core
│   ├── src/
│   │   ├── lib.rs        # App entry + Tauri commands
│   │   ├── db.rs         # SQLite access layer
│   │   └── schema.rs     # Schema definitions (PRD §8.1 subset)
│   ├── capabilities/     # Tauri 2 permission capabilities
│   ├── icons/            # Generated icons (run `pnpm tauri icon`)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 (tested on 22) |
| pnpm | ≥ 10 (tested on 11) |
| Rust | ≥ 1.77 (tested on 1.95) |
| WebView2 | Bundled on Windows 10+ |
| macOS | WKWebView (system) |
| Linux | WebKitGTK 2.42+ |

## Setup

```bash
# 1. Install frontend deps
pnpm install

# 2. (Optional) Regenerate icons from a source PNG
pnpm tauri icon ./src-tauri/icons-source.png --output ./src-tauri/icons
```

## Run

```bash
# Dev mode (starts Vite + Tauri window)
pnpm tauri dev

# Type-check only
pnpm typecheck

# Production build (outputs .dmg / .exe / .AppImage)
pnpm tauri build
```

The first `pnpm tauri dev` triggers a full Cargo build (~2–3 min). Subsequent runs reuse the cache (~5s).

## Data location

By default, data lives at:

- **Windows**: `%APPDATA%\tech.guyuemochen.folio\data.db`
- **macOS**: `~/Library/Application Support/tech.guyuemochen.folio/data.db`
- **Linux**: `~/.local/share/tech.guyuemochen.folio/data.db`

Custom storage location will land in a later milestone (decision Q7-B, see PRD §C).

## What works in M4 + M2.5

The combined "Search + Block polish" milestone. Concrete features added:

### M4 — Global search (Cmd+K)

- [x] **FTS5 full-text index** on page titles + page contents (auto-synced via triggers)
- [x] **Search command** with bm25 ranking + snippet highlighting (`<mark>` tags)
- [x] **SearchModal** — 560×70vh modal with backdrop blur, debounced (120ms) query
- [x] **Recents** section shown when query is empty (last 10 viewed pages, persisted to localStorage)
- [x] **Keyboard navigation** — ↑↓ + Enter + Escape + auto-scroll selected into view
- [x] **Grouped results** — Recent / Results with counts + page icons + breadcrumbs
- [x] **Cmd+K global shortcut** wired from anywhere in the app

### M2.5 — Block editor polish

- [x] **Block drag handle** (⋮⋮) — Notion-style left-edge floating handle, hover-aware
- [x] **Block menu** popover — Duplicate / Turn into (Text/H1/H2/H3/Quote/Code) / Copy link to block / Save / Delete
- [x] **Native drag-to-move** via HTML5 drag from handle (with source DOM as drag image)
- [x] **Smart paste**:
  - URL paste into empty paragraph → wraps as link
  - Image binary paste → inline `<img>` block
  - Shift+Paste → plain-text fallback
- [x] **Image extension** added to TipTap (`@tiptap/extension-image`)

## What's next (M5: Import/Export)

Per PRD §13.1, M5 will deliver data portability: Notion Markdown zip import, HTML/Markdown export, CSV database import/export, Folio backup file. Then M6 (performance), M7 (a11y/i18n), M8 (beta), M9 (v0.1.0 release).

## License

To be decided (will be MIT or AGPL-3.0 — see PRD §C.2 Q11).
