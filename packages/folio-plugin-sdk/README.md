# @folio/plugin-sdk

SDK for authoring **Folio dashboard plugins** — widgets that load into Folio's
database dashboard grid.

## Install

The package ships with Folio. Plugin authors add it to their project:

```bash
# From a local Folio checkout
npm install /path/to/folio/packages/folio-plugin-sdk

# Or link for development
npm link /path/to/folio/packages/folio-plugin-sdk
```

## Minimal plugin

A plugin is **either** a single `.js` file OR a folder (`manifest.json` + entry
`.js`). Both shapes default-export a plugin entry built with `definePlugin`:

```tsx
// my-widget.tsx
import { definePlugin, useState } from '@folio/plugin-sdk';
import type { FolioWidgetProps } from '@folio/plugin-sdk';

function MyWidget({ config, onConfigChange, host, context }: FolioWidgetProps) {
  const [n, setN] = useState(0);
  return (
    <div>
      <p>Rows in view: {context.rows.length}</p>
      <button onClick={() => setN(n + 1)}>Count: {n}</button>
    </div>
  );
}

export default definePlugin({
  id: 'my-widget',
  name: 'My Widget',
  version: '1.0.0',
  description: 'A minimal example.',
  component: MyWidget,
});
```

## Build configuration

Plugins MUST NOT bundle React — Folio provides a single shared instance.
Configure your bundler to treat `react` / `react-dom` as external and route
JSX through this SDK:

### Vite

```js
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@folio/plugin-sdk',
  },
  build: {
    lib: { entry: 'my-widget.tsx', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: ['react', 'react-dom'] },
    minify: false, // optional; Folio doesn't require it
  },
});
```

`pnpm build` produces `dist/index.js` — drop that file (renamed or as-is)
into Folio's plugins folder.

### esbuild CLI

```bash
esbuild my-widget.tsx \
  --bundle --format=esm \
  --jsx=automatic --jsx-import-source=@folio/plugin-sdk \
  --external:react --external:react-dom \
  --outfile=index.js
```

## Plugin shapes

### Single file (`*.js`)

Drop one bundled `.js` file into the plugins folder. Its default export must
be a `FolioPluginEntry` (built with `definePlugin`).

### Folder (`manifest.json` + entry)

For larger plugins with assets:

```
my-plugin/
├── manifest.json   # id, name, version, permissions, main
├── index.js        # the bundled entry; default-exports the component
└── locales/        # optional i18n (future)
```

`manifest.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "…",
  "main": "index.js",
  "permissions": ["search_pages"]
}
```

When `manifest.json` is present, the entry `.js` only needs to
default-export the `component` (other fields are merged from the manifest,
manifest wins on conflict):

```tsx
export default { component: MyWidget };
```

## FolioWidgetProps

| Prop             | Type                                  | Notes                                              |
|------------------|---------------------------------------|----------------------------------------------------|
| `config`         | `unknown \| undefined`                | Whatever you last saved via `onConfigChange`.      |
| `onConfigChange` | `(next: unknown) => void`             | Persist new config (overwrites).                   |
| `host`           | `FolioPluginHost`                     | Scoped API: `invoke`, `storage`, `t`, `on/emit`.   |
| `context`        | `{ databaseId, viewId, rows, properties }` | Read-only view data, same as built-ins.       |
| `onOpenRow`      | `(rowId: string) => void`             | Open a row in the page editor.                     |
| `isEditing`      | `boolean`                             | True while dashboard is in layout mode.            |
| `containerWidth` | `number`                              | Pixel width of the widget cell.                    |

## Host API

### `host.invoke(command, args?)`

Call a Tauri backend command. **Whitelisted** by your manifest's
`permissions` array — unlisted commands throw `FolioPermissionError`. The
plugin's own `storage` commands are always allowed.

### `host.storage`

Per-plugin persistent KV (`get`, `set`, `delete`, `keys`). Backed by a JSON
file at `<appData>/plugin-storage/<plugin-id>.json`. Survives restarts.

### `host.t(key, options?)`

Scoped i18n (future). Today returns the key as-is.

### `host.on(event, handler) / host.emit(event, payload)`

Plugin-scoped event bus. Other plugins cannot eavesdrop.

## Permissions

List every Tauri command your plugin needs in `manifest.json`:

```json
{ "permissions": ["search_pages", "get_page"] }
```

Plugin-scoped commands (`host.storage.*`, `host.emit`) are always allowed.

## Hot reload

Folio watches the plugins folder and reloads on file change (200 ms debounce).
Edit your built `.js`, save, and the widget remounts within ~300 ms with the
new code. Errors during reload show in the widget card; sibling widgets are
unaffected.

## Tips

- React is shared — don't `import React from 'react'` directly. Use
  `import { useState } from '@folio/plugin-sdk/react'` or set
  `jsxImportSource: '@folio/plugin-sdk'`.
- Default-handle `config === undefined` (first mount) and old config shapes
  (you may change your config schema across plugin versions).
- Throw cleanly — Folio catches render errors in an `ErrorBoundary` and
  shows a red "Plugin crashed" card instead of breaking the dashboard.
