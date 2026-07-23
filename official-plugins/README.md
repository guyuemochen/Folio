# Folio Official Plugins

Official plugins shipped with Folio, plus reference examples for the dashboard plugin system.

## hello-counter/

A minimal **folder plugin** (no bundler required) demonstrating:

- Reading host React via `globalThis.__FOLIO__.react`
- `useState` / `useEffect` (proxied through the host so no duplicate React)
- `host.storage` persistence (count survives app restarts + reloads)
- `onConfigChange` round-trip (initial-count config persisted to the dashboard)
- Reading dashboard context (`context.rows`)

### Install

Copy the folder into Folio's global plugins dir:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\tech.guyuemochen.folio\plugins\hello-counter\` |
| macOS   | `~/Library/Application Support/tech.guyuemochen.folio/plugins/hello-counter/` |
| Linux   | `~/.local/share/tech.guyuemochen.folio/plugins/hello-counter/` |

Or use Folio's **Plugin manager**:

- **Install from file…** — pick any `.js` inside the folder; Folio auto-detects the sibling `manifest.json` and copies the whole folder. (For single-file plugins, just pick the `.js` directly.)
- **Install folder…** — pick the folder itself.

Or: open the manager → *Open folder* → drag `hello-counter/` into the window.

### Hot reload

Edit `index.js` and save — Folio's file watcher reloads the plugin within ~300 ms. No app restart needed.

### Try this

1. Add the plugin to a dashboard (Add widget → Plugins → Hello Counter).
2. Click `+` a few times — the count updates.
3. Reload the dashboard (or restart Folio) — the count restores from `host.storage`.
4. Edit `index.js` (e.g. change the `+`/`−` buttons to `👍`/`👎`) and save — the widget re-renders with the new buttons.

## pie-chart/

A **folder plugin** that counts rows by the value of one property and renders the distribution as a pie chart with a legend. No bundler required.

- Counts any property type; designed for `select` / `status` / `multi_select` (where each row holds discrete option values)
- `checkbox` columns render as a two-slice ✓ / ✗ pie
- `multi_select` counts each selected value once per row
- Honours the property's declared option order; everything else sorts by count desc
- Inline config (while dashboard is in edit mode) picks the source column — no separate settings panel
- Pure SVG, zero runtime deps

### Try this

1. Install the folder (same steps as `hello-counter/` above).
2. Add the plugin to a dashboard (Add widget → Plugins → Pie Chart).
3. The widget shows a **Group rows by:** dropdown — pick a column.
4. The pie + legend render from the view's current rows. Click **Change** in the footer to re-pick.

### Hot reload

Same as `hello-counter/` — edit `index.js` and save; the chart re-renders within ~300 ms.

## Authoring your own

Two shapes are supported:

### Single-file (`.js`)

A standalone ESM file that default-exports `{ component }`. Drop into `plugins/`. Simplest path; fine for small plugins.

### Folder (`manifest.json` + entry `.js`)

Larger plugins with assets. `manifest.json` carries metadata; the entry file default-exports `{ component }`. See `hello-counter/` for the shape.

### Using TypeScript + JSX (bundler required)

For richer authoring, use `@folio/plugin-sdk`:

```bash
npm install /path/to/folio/packages/folio-plugin-sdk
```

Then write your widget in TSX:

```tsx
import { definePlugin, useState } from '@folio/plugin-sdk';
import type { FolioWidgetProps } from '@folio/plugin-sdk';

function MyWidget({ config, host, context }: FolioWidgetProps) {
  const [n, setN] = useState(0);
  return (
    <div>
      <p>Rows: {context.rows.length}</p>
      <button onClick={() => setN(n + 1)}>{n}</button>
    </div>
  );
}

export default definePlugin({
  id: 'my-widget',
  name: 'My Widget',
  version: '1.0.0',
  component: MyWidget,
});
```

Build with Vite (see `@folio/plugin-sdk/README.md` for the full config), drop the output `.js` into `plugins/`.

## SDK reference

- Type definitions: `packages/folio-plugin-sdk/types.ts`
- React bridge: `packages/folio-plugin-sdk/react.ts`
- JSX runtime: `packages/folio-plugin-sdk/jsx-runtime.ts`
- Full authoring guide: `packages/folio-plugin-sdk/README.md`
