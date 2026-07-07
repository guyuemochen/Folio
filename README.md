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

## What works in M5 — Import / Export

Full data portability (PRD §5.5). All 8 formats delivered across 4 phases.

### Export

- [x] **Page Markdown export** — ProseMirror → Markdown (22 block types, 8 marks, GFM tables, escaping)
- [x] **Page HTML export** — standalone document with inline CSS + dark-mode support
- [x] **Workspace zip export** — all pages as Markdown or HTML + `sitemap.md`
- [x] **Folio Backup** — SQLite + attachments + media + manifest → `.zip` (one-click restore)

### Import

- [x] **Markdown import** — GFM via comrak AST → ProseMirror (full mark accumulation)
- [x] **HTML import** — scraper DOM → ProseMirror (text-node merging, standalone image handling)
- [x] **CSV import** — auto-type inference (number/checkbox/url/select/text) → database with rows
- [x] **Notion zip import** — extract → walk dir tree → page tree with images copied to `media/`

### UX

- [x] **ImportExportModal** — portal-based modal with Export (page/workspace/backup) + Import (MD/HTML/CSV/Notion) tabs
- [x] **File pickers** via `@tauri-apps/plugin-dialog` for all import formats
- [x] **Blob downloads** for all export formats (text + base64-decoded zip)
- [x] **Auto-navigation** to imported pages + query invalidation + toast feedback

## What works in M6 — Performance

Targets PRD §10.1 (cold start, page open, slash palette, search, edit latency,
database render). All changes verified via `pnpm typecheck` (0 errors) and
`pnpm build` (clean chunk distribution).

### Bundle splitting & lazy loading (cold start)

- [x] **Vite `manualChunks`** — react / tiptap / lowlight / marked / katex /
      tanstack / router / zustand routed to dedicated vendor chunks
- [x] **React.lazy + Suspense** — `PageView`, `SearchModal`, `TrashModal`,
      `HistoryModal`, `DatabaseView`, `RowPropertyPanel`, `EmojiPicker`,
      `ImportExportModal` all load on demand
- [x] **Lazy lowlight + marked** — code-block grammars (51 kB gz) and the
      Markdown paste parser (12 kB gz) are dynamically imported on first use,
      so they never ship in the cold-start bundle
- [x] **Result** — initial shell (`index` + `vendor-react` + `vendor-router`
      + `vendor-zustand`) is **~82 kB gzipped**; the editor bundle (~260 kB
      gz with TipTap + KaTeX) loads when the user opens a page

### Render optimization (edit latency, sidebar smoothness)

- [x] **`React.memo` on `PageTreeNode`** — recursive page-tree row; children
      re-render only when their own `page` reference changes
- [x] **`React.memo` on every `PropertyCells` component** — all 11 cell
      editors (Title / Text / Number / Checkbox / Url / Select / Date / Person
      / Files / Placeholder / dispatcher)
- [x] **`RowPropertyPanel` + extracted `PropertyRow`** — `memo` on the panel
      and the per-property row; `useCallback` for the cell-commit handler so
      editing one cell no longer re-renders the entire property grid
- [x] **`useCallback` on Sidebar drag handlers** — favorites drag-rearrange
      keeps handler identity stable across renders

### DatabaseView virtualization (1000 rows < 500 ms)

- [x] **TanStack Virtual** (`@tanstack/react-virtual`) wraps the flat-body
      renderer with the "padding rows" pattern — visible + overscan rows are
      mounted; off-screen ranges collapse into spacer `<tr>` elements with
      the right heights so the scrollbar reflects the full row count
- [x] **Standard table layout preserved** — no `display: block/flex` rewrite,
      so column auto-alignment with the header is unchanged and all existing
      behaviors (filter / sort / multi-select / column resize / context menu
      / template picker / "+ New") keep working
- [x] **Bounded scroll region** — table wrapper gained `max-h-[70vh]` so the
      body scrolls independently (sticky-header effect, Notion-style)

### SQLite tuning (write amplification, query latency)

- [x] **Pragma adjustments** at connection setup — `synchronous=NORMAL`
      (still crash-safe in WAL mode), `cache_size=-20000` (~20 MB page cache),
      `mmap_size=268435456` (256 MB mmap reads), `temp_store=MEMORY`,
      `journal_size_limit=67108864`, `wal_autocheckpoint=1000`
- [x] **Prepared statement cache** — `list_pages` (both root + child paths),
      `search`, `list_trashed_pages`, `list_favorites`, `list_snapshots`
      switched from `prepare` to `prepare_cached` so the planner cost is
      paid once per connection

### Measurement

- [x] **`src/lib/perf.ts`** — dev-mode perf-mark utility (wraps
      `performance.now()` + User Timing API; zero runtime cost in production
      unless `VITE_PERF` is set)
- [x] **Wired marks** — `cold-start-shell` (from `main.tsx` start to
      `<App/>` mount) and `page-open:<id>` (from page query resolve to
      editor `onReady` / database paint) are emitted to the console in dev
      and visible in DevTools → Performance → Timings

### Known follow-ups (out of M6 scope)

- **`LinkedDatabaseBlock`** statically imports `DatabaseView`, so the
  DatabaseView chunk can't be split off the editor bundle without
  restructuring that extension
- **Grouped database view** is not virtualized — typical MVP groups have
  manageable row counts; per-group virtualization is a v1 enhancement
- **`vite.config.ts`** had `minify: 'esbuild'` which Vite 8 deprecated;
  switched to default Oxc minifier to unblock production builds

## What's next (M7: a11y + i18n)

Per PRD §13.1, M7 will deliver accessibility (WCAG AA) and i18n (zh-CN + en).
Then M8 (beta), M9 (v0.1.0 release).

## License

To be decided (will be MIT or AGPL-3.0 — see PRD §C.2 Q11).
