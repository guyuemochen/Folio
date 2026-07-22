# Folio Dashboard Plugins — Examples

Reference plugins for the Folio dashboard plugin system.

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

Or use Folio's **Plugin manager** → *Install from file…* (pick any file inside the folder — Folio copies the whole folder).

Or: open the manager → *Open folder* → drag `hello-counter/` into the window.

### Hot reload

Edit `index.js` and save — Folio's file watcher reloads the plugin within ~300 ms. No app restart needed.

### Try this

1. Add the plugin to a dashboard (Add widget → Plugins → Hello Counter).
2. Click `+` a few times — the count updates.
3. Reload the dashboard (or restart Folio) — the count restores from `host.storage`.
4. Edit `index.js` (e.g. change the `+`/`−` buttons to `👍`/`👎`) and save — the widget re-renders with the new buttons.

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
