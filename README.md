# Folio

> Local-first, Notion-like desktop note app. Built with Tauri 2 + React 19 + TipTap + SQLite.

**Status**: M1 scaffold (in development) · **Not production-ready**

---

## Why

`Folio` is a local-first alternative to Notion. All data lives on your machine in a single SQLite file. No account, no cloud, no telemetry.

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
│   └── troubleshooting.md  # Engineering troubleshooting notes (non-obvious bugs + fixes)
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

## What works in M7 — i18n + a11y

Internationalization (PRD §10.5) and accessibility (PRD §10.4).

### Setup

- [x] **`i18next` 26 + `react-i18next` 17** wired in `src/i18n/config.ts` and
      imported from `src/main.tsx` before React mounts
- [x] **System-locale detection** via `navigator.language` / `navigator.languages`
      — the webview reports the OS locale, so Chinese users get zh-CN and
      everyone else gets English with no manual toggle (matches PRD §10.5
      "日期/数字格式依系统 locale"; no Settings UI for language in MVP)
- [x] **Static JSON resources** — locale tables bundled via Vite's native
      JSON import, no async backend, language available synchronously

### Coverage

- [x] **263 translation keys** across 9 namespaces: `common`, `sidebar`,
      `page`, `search`, `trash`, `history`, `importExport`, `database`,
      `editor`
- [x] **~270 `t()` call sites** in 23 components
- [x] **Plural-aware messages** via i18next `_one` / `_other` suffixes
      (e.g. `database.rowCount`, `search.results`, `importExport.notionImported`)
- [x] **Interpolation** for dynamic values (`{{title}}`, `{{count}}`,
      `{{date}}`, `{{parentTitle}}`, `{{hidden}}`, `{{names}}`, `{{n}}`,
      `{{query}}`, `{{pageTitle}}`, `{{warnings}}`)
- [x] **Non-component modules** (e.g. `slashCommands.ts`) use `i18n.t()`
      directly since `useTranslation` is a hook

### Accessibility (a11y, PRD §10.4)

- [x] **`prefers-color-scheme`** — system dark mode auto-applied via
      `data-theme` attribute on `<html>`; `matchMedia` listener keeps it
      in sync at runtime (`src/lib/theme.ts`, wired in `main.tsx` + `App.tsx`)
- [x] **`prefers-reduced-motion`** — global CSS rule disables animations /
      transitions when the OS preference is set (`globals.css`)
- [x] **WCAG AA color contrast** — `--color-text-tertiary` and
      `--color-text-placeholder` deepened in both themes to clear the 4.5:1
      threshold (light `#6e6a64` / `#7a7670`, dark `#908e89` / `#8a8985`)
- [x] **Visible focus rings** — global `:focus-visible` outline on every
      focusable element; mouse clicks don't leave a residual ring
- [x] **Dialog a11y** — shared `useDialog()` hook (`src/lib/dialog.ts`) gives
      all 4 modals `role="dialog"` + `aria-modal` + `aria-label`,
      Escape-to-close, Tab/Shift+Tab focus trap, initial focus, focus restore
      to the trigger, and background scroll lock
- [x] **Editor ARIA** — ProseMirror region gets `role="textbox"` +
      `aria-label` + `aria-multiline`; SlashMenu is `role="listbox"` with
      `role="option"` items; BubbleToolbar is `role="toolbar"` with
      `aria-pressed` toggles; BlockMenu is `role="menu"` with `role="menuitem"`
      items
- [x] **Database ARIA** — `<table aria-label>`, `<th scope="col" aria-sort>`
      on every column header, `aria-label` on every cell editor (11 types)
      and row action buttons
- [x] **Popover ARIA** — `Popover` accepts an optional `ariaLabel` prop

## What works in M9 — release + auto-update

### License (Apache-2.0)

- **Apache License 2.0** — see [`LICENSE`](./LICENSE). A permissive license
  covering personal, commercial, and open-source use, with an explicit
  patent grant. You may use, modify, and distribute Folio (including
  commercially) provided you retain the license notice and state changes.

### Auto-update (Q9 — stable / beta / nightly)

- **Three channels**, each backed by a GitHub Releases rolling tag
  (`stable-latest` / `beta-latest` / `nightly-latest` → `latest.json`).
- **Tauri updater** (`@tauri-apps/plugin-updater`) + **minisign** update
  signing — pubkey embedded in `tauri.conf.json`, private key held outside
  the repo. Updates are user-initiated only (PRD §10.3 whitelist).
- **Per-channel Rust API** (`check_for_update_with_channel` /
  `install_update_with_channel`) resolves the endpoint server-side; JS helper
  `src/lib/updater.ts` exposes `checkForUpdate()` / `installUpdate()` +
  channel get/set.

### Release pipeline

- **GitHub Actions** (`.github/workflows/release.yml`) builds Windows /
  macOS (universal) / Linux, signs the updater bundle, publishes to GitHub
  Releases. Code is hosted on **GitLab**, mirrored to GitHub for publishing.
  Triggers: `v*` tags (stable), `v*-beta*` (beta), `nightly-*` tags + daily
  cron (nightly).

### Still pending / deferred

- **OS-level code signing (Q11)** — installers ship unsigned; first launch
  needs manual trust (Gatekeeper / SmartScreen). Needs Apple Developer
  account + Windows code-signing cert.
- **Updater UI** — the API (`src/lib/updater.ts`) is in place; a check-update
  button + channel picker belongs in a future Settings panel.
- **Demo video.**

## What's new in 0.2.0

Post-M9 editor polish plus a license change. Shipped as `v0.2.0-beta.1`.

### Tables

- **Auto-width** — `table-layout: auto` so columns size to their content
  instead of being forced into equal halves; the table stays within the
  editor column (`max-width: 100%`).
- **Formulas don't overflow** — long KaTeX scrolls inside its cell instead of
  blowing out the table border, and the one-line-formula vertical-scrollbar
  bug is fixed (`overflow-y: hidden` counters the CSS spec's `overflow-x: auto`
  → `overflow-y: auto` rewrite).

### Formula editing

- **Popover editor** — block and inline formulas now edit in a floating
  popover with a **textarea + live KaTeX preview**; changes save only on
  **OK / Ctrl+Enter** (Cancel / Esc / outside click discards). Replaces the
  old inline edit-in-place.
- **Distinct backgrounds** — block equations get a tinted rounded block and
  inline math a subtle token background, so formulas read apart from prose.
- **Spacing rhythm** — differentiated vertical spacing across heading levels,
  heading→paragraph (tight), paragraph→paragraph, and paragraph→formula.

### License

Switched from **AGPL-3.0-or-later** to the permissive **Apache-2.0** — use,
modify, and distribute freely (including commercially) under the Apache
terms, with an explicit patent grant. See [`LICENSE`](./LICENSE).

## What's next

0.2.0 is in beta (`v0.2.0-beta.1`). Remaining before v1.0: updater UI, OS
code-signing (Q11), and P1 bugs from real-world use.

## License

Folio is licensed under the **Apache License 2.0** — see [`LICENSE`](./LICENSE).

- A permissive license: use, modify, and distribute Folio freely, including
  commercially, provided you retain the copyright notice and state any
  changes you make.
- Includes an explicit patent grant from contributors.
