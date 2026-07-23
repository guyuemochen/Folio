/**
 * Folio plugin SDK — type contracts.
 *
 * This file is the single source of truth for the plugin protocol. It defines:
 *   - {@link FolioPluginManifest}     — what a plugin declares (id, name, perms)
 *   - {@link FolioPluginEntry}        — what a plugin's entry .js default-exports
 *   - {@link FolioContributions}      — the widgets AND view types a plugin ships
 *   - {@link FolioWidgetProps}        — what the host passes to every widget
 *   - {@link FolioViewProps}          — what the host passes to every view renderer
 *   - {@link FolioPluginHost}         — the scoped host API each plugin can call
 *
 * A plugin is unified: one package can contribute dashboard widgets AND new
 * view/tab types (see {@link FolioContributions}). The legacy single-`component`
 * shape still works as a one-widget shorthand.
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

// ----------------------------------------------------------------------------
// Contributions — a unified plugin can declare widgets AND view/tab types.
// ----------------------------------------------------------------------------

/** One dashboard widget contribution. A plugin may ship several. Each is a
 *  separate entry in the "Add widget" picker and is referenced in persisted
 *  dashboard configs by `pluginId` + `widgetId`. */
export interface FolioWidgetContribution {
  /** Stable id WITHIN this plugin, kebab-case, validated against
   *  `/^[a-z0-9-]+$/`. Must be unique among this plugin's widget
   *  contributions. When omitted the host uses `'default'` — use that only
   *  for single-widget plugins (the legacy shape).
   *
   *  Persisted on `DashboardComponent.widgetId`; changing it breaks existing
   *  dashboards, so pick a stable id at author time. */
  id?: string;
  /** Display name shown in the "Add widget" picker. Falls back to the
   *  manifest's `name` (useful for single-widget plugins). */
  name?: string;
  /** One-line description shown under the name in the picker. Falls back to
   *  the manifest's `description`. */
  description?: string;
  /** Default grid footprint when the widget is first added. Falls back to the
   *  manifest's `defaultLayout`, then to the host's built-in default. */
  defaultLayout?: {
    w: number;
    h: number;
    minW?: number;
    maxW?: number;
    minH?: number;
    maxH?: number;
  };
  /** The widget React component rendered inside a `WidgetFrame` cell. */
  component: FolioWidgetComponent;
}

/** Props handed to every plugin view/tab renderer. Mirrors the built-in view
 *  renderer contract (`ViewRendererProps` in the host), with types kept opaque
 *  (`unknown`) so this SDK file doesn't depend on the persistence layer.
 *  Plugins cast at runtime — `view` → `ViewConfig`, `rows` → `DatabaseRow[]`,
 *  `schema` → `DatabaseWithSchema`, `prop` → `PropertyDef`.
 *
 *  In addition to the built-in surface, plugin views receive a scoped
 *  `host` (storage / invoke / events) so they can persist their own layout
 *  state (keyed by `view.id` to stay per-instance). */
export interface FolioViewProps {
  /** The saved view (filter / sort / type-specific config lives here). */
  view: unknown;
  /** Database schema (page metadata + properties + all saved views). */
  schema: unknown;
  /** All non-trashed rows with their property values; the renderer is
   *  responsible for applying `view.filter` / `view.sort`. */
  rows: unknown[];
  /** Commit a cell update (e.g. a card title edit, a drag-to-change-column). */
  onCellChange: (row: unknown, prop: unknown, value: unknown) => void;
  /** Open a row's full page in the main editor. */
  onOpenRow: (pageId: string) => void;
  /** Add a new blank row to the database. */
  onAddRow: () => void;
  /** Change which property drives a grouped layout. Optional; renderers that
   *  don't group can ignore it. */
  onChangeGroupProperty?: (propertyId: string | null) => void;
  /** Scoped host API (storage, whitelisted invoke, events, i18n). Same shape
   *  widget plugins receive. */
  host: FolioPluginHost;
}

/** The view renderer component. Type-erased like {@link FolioWidgetComponent}.
 *  Plugins author this as `function MyView(props: FolioViewProps) {…}` using
 *  the JSX runtime provided by `@folio/plugin-sdk`. */
export type FolioViewComponent = (props: FolioViewProps) => unknown;

/** One view/tab type contribution. A plugin may ship several. Each becomes a
 *  selectable type in the "New view" picker and renders as a full tab inside
 *  a database (same surface as built-in board / calendar / … views). */
export interface FolioViewContribution {
  /** Stable type id WITHIN this plugin, kebab-case, validated against
   *  `/^[a-z0-9-]+$/`. Must be unique among this plugin's view contributions.
   *
   *  Persisted (namespaced) on `ViewConfig.type` as
   *  `plugin:<pluginId>:<type>`. Changing it breaks existing views, so pick a
   *  stable id at author time. */
  type: string;
  /** Display name shown in the "New view" picker and the tab tooltip. */
  name: string;
  /** Short label/emoji shown in the tab strip. Falls back to a generic icon
   *  when omitted. */
  icon?: string;
  /** One-line description shown under the name in the picker (optional). */
  description?: string;
  /** The view renderer component invoked when the user opens a tab of this
   *  type. */
  component: FolioViewComponent;
}

/** The unified contribution surface. A single plugin may declare any
 *  combination of widgets and view types (both optional, both may contain
 *  multiple entries). A plugin with neither is valid but useless — the host
 *  loads it without error and it simply contributes nothing. */
export interface FolioContributions {
  /** Dashboard widget contributions. Listed under the "Plugins" section of
   *  the "Add widget" picker. */
  widgets?: FolioWidgetContribution[];
  /** View/tab type contributions. Listed in the "New view" picker and
   *  rendered as full database tabs. */
  views?: FolioViewContribution[];
}

/** What a plugin's entry `.js` file must `export default` (single-file plugin)
 *  OR what `manifest.json`'s `"main"` field must point at (folder plugin).
 *
 *  Two authoring shapes, both built with `definePlugin`:
 *
 *  1. **Legacy single-widget** — set `component` only (a single dashboard
 *     widget). The host normalizes this into one widget contribution with
 *     `id: 'default'`. Existing plugins keep working unchanged.
 *  2. **Unified** — set `contributions` with any combination of `widgets`
 *     and `views`. A plugin can ship several widgets AND several view types
 *     in one package.
 *
 *  If both `component` and `contributions.widgets` are present,
 *  `contributions.widgets` wins and `component` is ignored. */
export interface FolioPluginEntry extends FolioPluginManifest {
  /** Legacy shorthand for a single dashboard widget. Normalized into
   *  `contributions.widgets = [{ id: 'default', component }]`. Ignored when
   *  `contributions.widgets` is present. */
  component?: FolioWidgetComponent;
  /** Unified contributions surface. A plugin may declare widgets and/or view
   *  types here. */
  contributions?: FolioContributions;
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

/** A fully-loaded plugin in the registry. `contributions` holds the
 *  normalized widget + view contributions (the legacy single `component` is
 *  folded into `contributions.widgets` by the loader). */
export interface LoadedPlugin {
  manifest: FolioPluginManifest;
  /** Normalized contributions. Legacy single-`component` plugins appear here
   *  as `widgets: [{ id: 'default', component }]`. Widget/view renderers and
   *  the pickers read from this — never from a bare `component` field. */
  contributions: FolioContributions;
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
