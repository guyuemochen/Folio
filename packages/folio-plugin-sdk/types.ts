/**
 * Dashboard plugin SDK — type contracts.
 *
 * This file is the single source of truth for the plugin protocol. It defines:
 *   - {@link FolioPluginManifest}   — what a plugin declares (id, name, perms)
 *   - {@link FolioPluginEntry}      — what a plugin's entry .js default-exports
 *   - {@link FolioWidgetProps}      — what the host passes to every widget
 *   - {@link FolioPluginHost}       — the scoped host API each widget can call
 *
 * The runtime bridge lives in `packages/folio-plugin-sdk/` (a tiny package
 * plugin authors `import` from — it proxies React through `globalThis.__FOLIO__`
 * so plugins don't ship a duplicate React copy). The host implementation lives
 * in `src/plugins/host-api.ts`.
 *
 * KEEP THIS FILE PURE TYPES — no runtime exports, no imports beyond `type`.
 * Plugin authors copy it (or depend on `@folio/plugin-sdk`) to type-check
 * their plugins against the same contract the host enforces at runtime.
 */

// ============================================================================
// Manifest — what a plugin declares about itself.
// ============================================================================

/** A plugin's manifest metadata. The persistent identity of a plugin; used
 *  for registry keys, conflict resolution, and the management UI. */
export interface FolioPluginManifest {
  /** Globally unique id, kebab-case, validated against `/^[a-z0-9-]+$/`.
   *  Must be stable across versions and across file renames — dashboard
   *  widgets persist this as `DashboardComponent.pluginId`. */
  id: string;
  /** Display name shown in the "Add widget" picker and the manager modal. */
  name: string;
  /** One-line description shown under the name in pickers. */
  description?: string;
  /** semver string, e.g. `"1.0.0"`. Shown in the manager; not currently
   *  used for upgrade decisions. */
  version: string;
  /** Author / maintainer credit, shown in the manager modal. */
  author?: string;
  /** Homepage or repo URL. Rendered as a link in the manager. */
  homepage?: string;
  /** Default grid footprint when the widget is first added to a dashboard.
   *  Falls back to `{ w: 6, h: 6, minW: 2, minH: 2 }` when omitted. */
  defaultLayout?: {
    w: number;
    h: number;
    minW?: number;
    maxW?: number;
    minH?: number;
    maxH?: number;
  };
  /** Whitelist of host Tauri command names this plugin may invoke via
   *  `host.invoke`. Commands starting with `plugin_storage_` (the plugin's
   *  scoped KV store) are ALWAYS allowed and need not be listed here.
   *
   *  Empty/omitted = read-only widget with no host data access beyond what's
   *  passed through {@link FolioWidgetProps.context}. Any unlisted command
   *  throws {@link FolioPermissionError} at runtime. */
  permissions?: string[];
}

// ============================================================================
// Entry — the actual code surface a plugin exposes.
// ============================================================================

/** The widget component. Type-erased to `unknown` return so this file doesn't
 *  have to depend on React types — but the host expects a React function
 *  component (or any callable returning React-renderable output). Plugins
 *  typically author this as `function MyWidget(props: FolioWidgetProps) {…}`
 *  using the JSX runtime provided by `@folio/plugin-sdk`. */
export type FolioWidgetComponent = (props: FolioWidgetProps) => unknown;

/** What a plugin's entry `.js` file must `export default` (single-file plugin)
 *  OR what `manifest.json`'s `"main"` field must point at (folder plugin). */
export interface FolioPluginEntry extends FolioPluginManifest {
  /** The widget React component rendered inside a `WidgetFrame` cell. */
  component: FolioWidgetComponent;
}

// ============================================================================
// Widget props — what the host passes to each plugin widget instance.
// ============================================================================

/** Read-only view context. Mirrors what built-in widgets (StatWidget,
 *  RecentRowsWidget) receive, so plugins can build dashboards over the same
 *  row set. `rows` are already filter+sort-applied for the current view. */
export interface FolioWidgetContext {
  databaseId: string;
  viewId: string;
  /** Rows currently visible in the view. Opaque `unknown[]` here to avoid
   *  coupling this types file to the persistence layer; cast to
   *  `DatabaseRow[]` at runtime. */
  rows: unknown[];
  /** Property schema (PropertyDef[]) for the database. */
  properties: unknown[];
}

/** Props passed to every plugin widget. The plugin owns its rendering and
 *  its own configuration UI (rendered inline in the widget body when
 *  `isEditing` is true). */
export interface FolioWidgetProps<TConfig = unknown> {
  /** Persisted opaque config. The host never interprets this — it stores and
   *  returns it verbatim. `undefined` on first mount; plugins must
   *  default-handle that case. */
  config: TConfig | undefined;
  /** Persist new config. The host writes it into the dashboard component
   *  immediately and the view's `onChangeDashboard` persists to SQLite. */
  onConfigChange: (config: TConfig) => void;
  /** Scoped host API (storage, whitelisted invoke, events, i18n). */
  host: FolioPluginHost;
  /** Read-only view context (rows, properties, ids). */
  context: FolioWidgetContext;
  /** Open a row's full page in the editor (same action as built-in widgets).
   *  Optional in read-only dashboard contexts (e.g. linked-database blocks). */
  onOpenRow?: (rowId: string) => void;
  /** True while the dashboard is in edit / layout mode. Plugins may use this
   *  to show inline config controls or drag affordances. */
  isEditing: boolean;
  /** Current pixel width of the widget's cell (from ReactGridLayout's
   *  container measurement). Useful for responsive layouts / charts. */
  containerWidth: number;
}

// ============================================================================
// Host API — the scoped surface each plugin instance can call.
// ============================================================================

/** Scoped key-value storage. Each plugin gets its own JSON file at
 *  `<appData>/plugin-storage/<pluginId>.json`. Survives app restarts and
 *  backup/restore. Plugins should treat this as their persistent state. */
export interface FolioPluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** The scoped host API handed to every plugin widget. The host closes over
 *  the plugin's manifest id, so storage and events are automatically scoped —
 *  plugins cannot reach another plugin's storage or listen to its events. */
export interface FolioPluginHost {
  /** Invoke a whitelisted Tauri command. Throws {@link FolioPermissionError}
   *  if the command isn't in the manifest's `permissions` array (plugin's own
   *  `plugin_storage_*` commands are always allowed).
   *
   *  Plugins do NOT have direct access to `@tauri-apps/api` — this method is
   *  the only path to the host backend, and the whitelist is enforced here. */
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  /** Scoped persistent KV storage for this plugin. */
  storage: FolioPluginStorage;
  /** The plugin's own directory as a `convertFileSrc` URL (so bundled assets
   *  — images, fonts, locale files — load correctly in both dev and prod).
   *  For single-file plugins this is the parent directory. */
  pluginDirUrl: string;
  /** Scoped i18n. Reads from the plugin's manifest `name`/`description` and
   *  (future) a `locales/` folder. Falls back to returning the key as-is. */
  t: (key: string, options?: Record<string, unknown>) => string;
  /** This plugin's identity (for self-reference in UIs). */
  self: { id: string; version: string; name: string };
  /** Scoped event bus. `emit` fires only handlers registered by THIS plugin;
   *  other plugins cannot eavesdrop. Useful for cross-widget sync within one
   *  plugin. Returns an unsubscribe from `on`. */
  on: (event: string, handler: (payload: unknown) => void) => () => void;
  emit: (event: string, payload: unknown) => void;
}

/** Thrown by `host.invoke` when the command is not in the plugin's manifest
 *  `permissions`. Host-side enforcement — there's no path around it because
 *  plugins can't import the raw Tauri invoke. */
export class FolioPermissionError extends Error {
  readonly pluginId: string;
  readonly command: string;
  constructor(pluginId: string, command: string) {
    super(
      `Plugin "${pluginId}" is not permitted to invoke "${command}". Add it to the plugin manifest's "permissions" array.`,
    );
    this.name = 'FolioPermissionError';
    this.pluginId = pluginId;
    this.command = command;
  }
}

// ============================================================================
// Registry — runtime state of loaded plugins.
// ============================================================================

/** Where on disk a plugin came from. Workspace plugins shadow global plugins
 *  on id clash (workspace wins). */
export type PluginScope = 'global' | 'workspace';

/** Runtime status of one plugin entry. */
export interface PluginStatus {
  state: 'loading' | 'loaded' | 'error' | 'disabled';
  /** Human-readable error message when state === 'error'. */
  error?: string;
  /** When state === 'disabled', the user toggled the plugin off via the
   *  manager UI; the loader still knows about it (so it can be re-enabled)
   *  but the registry excludes it from the picker and the renderer shows
   *  `PluginUnavailable` for any persisted widgets referencing it. */
}

/** A fully-loaded plugin in the registry. The `component` is the live
 *  function reference imported from the plugin's entry .js. */
export interface LoadedPlugin {
  manifest: FolioPluginManifest;
  component: FolioWidgetComponent;
  scope: PluginScope;
  /** Absolute path on disk to the entry .js file. */
  sourcePath: string;
  /** The URL used for dynamic `import()` (with cache-bust query string).
   *  Stored so hot-reload can build the next URL with a fresh `?rev=`. */
  importUrl: string;
  /** Monotonic counter, bumped on every successful reload. The renderer uses
   *  `key={pluginId + ':' + revision}` so React discards the old component
   *  instance and remounts fresh — required for hot reload (old module's
   *  closures and hooks are otherwise retained). */
  revision: number;
  enabled: boolean;
}

/** Result of scanning a plugin directory entry. Returned by the backend
 *  `plugin_list` command. */
export interface PluginListEntry {
  /** Absolute path to either the .js file (kind==='file') or the folder
   *  (kind==='dir'). */
  path: string;
  scope: PluginScope;
  /** 'file' = single .js plugin (manifest is the default export).
   *  'dir'   = folder plugin (manifest.json + entry .js referenced by main). */
  kind: 'file' | 'dir';
  /** Folder plugins: the manifest.json content (cheap, no JS execution).
   *  Single-file plugins: null — manifest is in-band in the .js, the loader
   *  gets it by dynamic-importing. */
  manifest?: FolioPluginManifest | null;
  /** Basename of the entry (the file/folder name). Used for the
   *  workspace-shadows-global dedupe at scan time + the manager UI's display
   *  when a manifest isn't loaded yet. */
  name: string;
}

/** Payload of the `folio:plugin-changed` Tauri event emitted by the backend
 *  file watcher. */
export interface PluginChangedEvent {
  scope: PluginScope;
  /** Absolute path of the changed file/dir. */
  path: string;
  /** Notify event kind, coalesced. */
  kind: 'create' | 'modify' | 'remove';
}
