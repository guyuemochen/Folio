/**
 * Plugin registry — the central runtime state of all loaded plugins.
 *
 * One Zustand store keyed by resolved plugin id. Holds:
 *   - `plugins[id]`  — LoadedPlugin (manifest + contributions + metadata + revision)
 *   - `statuses[id]` — current lifecycle state (loading / loaded / error / disabled)
 *   - `entries`      — the raw directory listing from `plugin_list` (so the
 *                      manager UI can show all entries even when some failed
 *                      to load)
 *
 * A plugin may contribute dashboard widgets AND view/tab types
 * (see `LoadedPlugin.contributions`); the legacy single-`component` shape is
 * normalized into one widget contribution on load.
 *
 * Loading is via dynamic `import()` of a Blob URL built from the file content
 * fetched through `plugin_read_text`. This bypasses asset-protocol/fs-scope
 * limitations (workspace plugins live in arbitrary user-chosen folders that
 * can't be whitelisted at build time) and works uniformly in dev and prod.
 *
 * Each entry's load is independent try/catch — a failing plugin sets only its
 * own `statuses[id].error`, never throws out of `scan`.
 */

import { create } from 'zustand';
import { api } from '../lib/invoke';
import { makeHost } from './host-api';
import type {
  FolioContributions,
  FolioPluginEntry,
  FolioPluginHost,
  FolioPluginManifest,
  FolioWidgetComponent,
  LoadedPlugin,
  PluginListEntry,
  PluginScope,
  PluginStatus,
} from './types';

/** Singleton host cache: one `FolioPluginHost` per plugin id, shared across
 *  all widget instances of that plugin. */
const hostCache = new Map<string, FolioPluginHost>();

/** Built-in id pattern (matches SDK contract enforced server-side). */
const PLUGIN_ID_RE = /^[a-z0-9-]+$/;
/** Contribution id pattern (widget/view ids within a plugin). */
const CONTRIBUTION_ID_RE = /^[a-z0-9-]+$/;

// ============================================================================
// Derived state builders
// ----------------------------------------------------------------------------
// `widgetContributions` / `viewContributions` are stored on the state (rather
// than recomputed by selectors on every read) so subscribers receive a stable
// array reference across renders. Selectors that build fresh arrays per call
// defeat `useShallow` (its element comparison is `Object.is`) and trigger an
// infinite `useSyncExternalStore` rerender loop in React 19.
// ============================================================================

/** Enabled plugins sorted by manifest name. Stable order ⇒ stable entry list
 *  as long as the underlying plugin objects don't change. */
function sortedEnabledPlugins(plugins: Record<string, LoadedPlugin>): LoadedPlugin[] {
  return Object.values(plugins)
    .filter((p) => p.enabled)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** Rebuild the flattened widget-contribution list from the plugins map. */
function rebuildWidgetContributions(
  plugins: Record<string, LoadedPlugin>,
): WidgetContributionEntry[] {
  const out: WidgetContributionEntry[] = [];
  for (const plugin of sortedEnabledPlugins(plugins)) {
    const widgets = plugin.contributions.widgets ?? [];
    for (const w of widgets) {
      const widgetId = w.id ?? 'default';
      out.push({
        plugin,
        contribution: w,
        widgetId,
        name: w.name ?? plugin.manifest.name,
        description: w.description ?? plugin.manifest.description,
      });
    }
  }
  return out;
}

/** Rebuild the flattened view-contribution list from the plugins map. */
function rebuildViewContributions(
  plugins: Record<string, LoadedPlugin>,
): ViewContributionEntry[] {
  const out: ViewContributionEntry[] = [];
  for (const plugin of sortedEnabledPlugins(plugins)) {
    const views = plugin.contributions.views ?? [];
    for (const v of views) {
      out.push({
        plugin,
        contribution: v,
        persistedType: pluginViewTypeId(plugin.manifest.id, v.type),
      });
    }
  }
  return out;
}

/** Recompute both derived contribution lists from a (possibly new) plugins
 *  map. Use inside `set()` calls that replace `plugins` so the derived state
 *  stays in sync atomically. */
function rebuildDerived(plugins: Record<string, LoadedPlugin>) {
  return {
    widgetContributions: rebuildWidgetContributions(plugins),
    viewContributions: rebuildViewContributions(plugins),
  };
}

// ============================================================================
// Store shape
// ============================================================================

interface PluginRegistryState {
  /** Loaded plugins keyed by resolved manifest id. */
  plugins: Record<string, LoadedPlugin>;
  /** Per-id lifecycle status. Ids not present here are unknown to the registry
   *  (never scanned). Present id with `state: 'loading'` is mid-import. */
  statuses: Record<string, PluginStatus>;
  /** Raw directory entries from the last `plugin_list` call. Used by the
   *  manager UI to show ALL entries (including failed + disabled ones). */
  entries: PluginListEntry[];
  /** Derived: all widget contributions across enabled plugins, in a stable
   *  order. Recomputed whenever `plugins` changes (load / unload / enable /
   *  disable). Stored on the state so subscribers get a stable array
   *  reference — selectors that build a fresh array per call defeat
   *  `useShallow` (whose element comparison is `Object.is`) and trigger an
   *  infinite `useSyncExternalStore` rerender loop. */
  widgetContributions: WidgetContributionEntry[];
  /** Derived: all view contributions across enabled plugins, in a stable
   *  order. Same rationale as `widgetContributions`. */
  viewContributions: ViewContributionEntry[];
  /** Global + workspace plugin dir paths (resolved on init). */
  globalDir: string | null;
  workspaceDir: string | null;
  /** True between `init()` and the first `scan()` completion. The dashboard
   *  view uses this to show a "Loading plugins…" state on first paint. */
  initialized: boolean;

  // ---------------------------------------------------------------- actions

  /** Resolve dirs + initial scan. Idempotent — safe to call multiple times. */
  init: () => Promise<void>;
  /** Re-scan both plugin dirs, reload all entries. */
  scan: () => Promise<void>;
  /** Load (or reload) one entry by absolute path. Updates `statuses` and
   *  `plugins` atomically. Used by the hot-reload listener. */
  reloadByPath: (path: string, scope: PluginScope) => Promise<void>;
  /** Remove a plugin by id (used when its file is deleted or uninstalled). */
  unload: (id: string) => void;
  /** Disable a plugin without removing it (manager UI toggle). Disabled
   *  plugins stay in `statuses` so they can be re-enabled, but leave
   *  `plugins` (so the renderer shows `PluginUnavailable`). */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Look up a plugin's host (creating it on first call). */
  getHost: (id: string) => FolioPluginHost | undefined;
}

// ============================================================================
// Store implementation
// ============================================================================

export const usePluginRegistry = create<PluginRegistryState>((set, get) => ({
  plugins: {},
  statuses: {},
  entries: [],
  widgetContributions: [],
  viewContributions: [],
  globalDir: null,
  workspaceDir: null,
  initialized: false,

  async init() {
    if (get().initialized) return;
    try {
      const dirs = await api.pluginGetDirs();
      set({ globalDir: dirs.global, workspaceDir: dirs.workspace });
      await get().scan();
    } catch (e) {
      console.error('[folio:plugins] init failed:', e);
    } finally {
      set({ initialized: true });
    }
  },

  async scan() {
    let entries: PluginListEntry[] = [];
    try {
      entries = await api.pluginList();
    } catch (e) {
      console.error('[folio:plugins] plugin_list failed:', e);
      return;
    }
    set({ entries });

    // Build the set of currently-known source paths from the listing.
    const livePaths = new Set(entries.map((e) => e.path));

    // Unload any plugin whose source path is gone.
    const currentState = get();
    for (const [id, plugin] of Object.entries(currentState.plugins)) {
      if (!livePaths.has(plugin.sourcePath)) {
        get().unload(id);
      }
    }

    // Load each entry. Each load is independent (errors don't propagate).
    // Sequential is fine — typical plugin counts are < 20, and the dynamic
    // imports are each ~10ms.
    for (const entry of entries) {
      await get().reloadByPath(entry.path, entry.scope as PluginScope);
    }
  },

  async reloadByPath(path, scope) {
    // 1. Read entry — either folder (read manifest.json + entry path from `main`)
    //    or single .js file (path IS the entry).
    let entryPath = path;
    let folderManifest: Partial<FolioPluginManifest> | null = null;
    let pluginDirUrl = path;

    // Heuristic: folder plugins have no `.js` extension on the path.
    const isFolder = !path.endsWith('.js');
    if (isFolder) {
      try {
        // manifest.json is a loose JSON shape — `main` is a folder-plugin
        // concept (the entry filename inside the folder), NOT a runtime
        // FolioPluginManifest field. Parse it as Record<string, unknown>
        // and pick the fields we need.
        const raw = (await api.pluginReadManifest(path)) as Record<string, unknown>;
        folderManifest = raw as Partial<FolioPluginManifest>;
        const mainFile =
          typeof raw.main === 'string' && raw.main.length > 0 ? raw.main : 'index.js';
        entryPath = `${path}/${mainFile}`.replace(/\\/g, '/');
        pluginDirUrl = path;
      } catch (e) {
        // Folder without manifest.json — fall through to direct import of
        // `path/index.js` if it exists; the listing step already confirmed
        // this in Rust.
        entryPath = `${path}/index.js`.replace(/\\/g, '/');
        pluginDirUrl = path;
      }
    } else {
      // Single-file plugin: its containing dir is the plugin dir.
      const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      pluginDirUrl = lastSlash >= 0 ? path.slice(0, lastSlash) : path;
    }

    // 2. Load the entry source via plugin_read_text (bypasses scope) →
    //    Blob URL → dynamic import. Cache-bust by always creating a new blob
    //    (each call to reloadByPath builds a fresh URL).
    let loaded: { manifest: FolioPluginManifest; contributions: FolioContributions };
    try {
      const code = await api.pluginReadText(entryPath);
      const blob = new Blob([code], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      // `/* @vite-ignore */` prevents Vite from trying to bundle this import
      // at build time (it can't — the URL is runtime-only).
      const mod = (await import(/* @vite-ignore */ blobUrl)) as {
        default?: FolioPluginEntry | { component: FolioWidgetComponent };
      };
      // Blob URL is no longer needed once the module is in the cache.
      // Releasing here is safe — modules persist in the registry after import.
      URL.revokeObjectURL(blobUrl);

      const def = mod.default;
      if (!def || typeof def !== 'object') {
        throw new Error('plugin entry has no default export');
      }
      // Merge: in-band manifest from the .js default-export wins on conflict
      // (per SDK contract); folder manifest.json fills in anything missing.
      const inline = def as Partial<FolioPluginManifest>;
      const manifest: FolioPluginManifest = {
        id: inline.id ?? folderManifest?.id ?? '',
        name: inline.name ?? folderManifest?.name ?? '(unnamed plugin)',
        version: inline.version ?? folderManifest?.version ?? '0.0.0',
        description: inline.description ?? folderManifest?.description,
        author: inline.author ?? folderManifest?.author,
        homepage: inline.homepage ?? folderManifest?.homepage,
        defaultLayout: inline.defaultLayout ?? folderManifest?.defaultLayout,
        permissions: inline.permissions ?? folderManifest?.permissions,
      };
      if (!manifest.id || !PLUGIN_ID_RE.test(manifest.id)) {
        throw new Error(
          `plugin manifest has invalid id "${manifest.id}" (must match /^[a-z0-9-]+$/)`,
        );
      }
      // Normalize whatever the entry exports (legacy single `component` and/or
      // unified `contributions`) into a single FolioContributions object.
      const contributions = normalizeContributions(
        def as Partial<FolioPluginEntry>,
        manifest,
      );
      loaded = { manifest, contributions };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[folio:plugins] load failed for ${entryPath}:`, e);
      // Synthetic id if the plugin never got far enough to declare one —
      // group errors by source path so the manager UI can show them.
      const errId = deriveErrorId(path);
      set((s) => ({
        statuses: {
          ...s.statuses,
          [errId]: { state: 'error', error: msg },
        },
      }));
      return;
    }

    const id = loaded.manifest.id;
    const prev = get().plugins[id];
    const revision = (prev?.revision ?? 0) + 1;

    // Cache the host for this plugin (created once, kept across reloads —
    // the manifest identity is stable; permissions may have changed but the
    // new host is built below to reflect them).
    hostCache.set(id, makeHost(loaded.manifest, pluginDirUrl));

    set((s) => {
      // Remove any error marker keyed on the synthetic id (when the plugin
      // had failed previously without declaring an id).
      const statuses = { ...s.statuses };
      delete statuses[deriveErrorId(path)];

      const wasEnabled = s.statuses[id]?.state !== 'disabled';
      const plugins: Record<string, LoadedPlugin> = {
        ...s.plugins,
        [id]: {
          manifest: loaded.manifest,
          contributions: loaded.contributions,
          scope,
          sourcePath: path,
          importUrl: entryPath,
          revision,
          enabled: wasEnabled,
        },
      };
      return {
        plugins,
        ...rebuildDerived(plugins),
        statuses: {
          ...statuses,
          [id]: {
            state: wasEnabled ? 'loaded' : 'disabled',
          },
        },
      };
    });
  },

  unload(id) {
    set((s) => {
      const plugins = { ...s.plugins };
      delete plugins[id];
      const statuses = { ...s.statuses };
      // Keep the status entry so the manager UI can still see it (was loaded,
      // now removed on disk). Mark as removed via a synthetic state.
      if (statuses[id]) {
        statuses[id] = { state: 'error', error: 'Plugin file removed.' };
      }
      hostCache.delete(id);
      return { plugins, ...rebuildDerived(plugins), statuses };
    });
  },

  async setEnabled(id, enabled) {
    set((s) => {
      const prev = s.statuses[id];
      if (!prev) return {}; // unknown id — no-op
      const nextState: PluginStatus['state'] = enabled ? 'loaded' : 'disabled';
      const statuses: Record<string, PluginStatus> = {
        ...s.statuses,
        [id]: { ...prev, state: nextState },
      };
      const plugins = { ...s.plugins };
      const p = plugins[id];
      if (p) plugins[id] = { ...p, enabled };
      return { statuses, plugins, ...rebuildDerived(plugins) };
    });
  },

  getHost(id) {
    return hostCache.get(id);
  },
}));

// ============================================================================
// Helpers
// ============================================================================

/** Stable synthetic id for entries that fail before declaring their own.
 *  Derived from the source path so repeated loads of the same broken plugin
 *  overwrite (not pile up) the error status. */
function deriveErrorId(path: string): string {
  const base = path
    .replace(/[\\/]/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .slice(-40);
  return `_broken:${base}`;
}

/** Normalize a plugin entry's exports into a single {@link FolioContributions}.
 *
 *  Accepts both authoring shapes:
 *   - Legacy: `component` only → one widget contribution with `id: 'default'`.
 *   - Unified: `contributions.widgets` / `contributions.views` (the legacy
 *     `component` is ignored when `contributions.widgets` is present).
 *
 *  Validates contribution ids (kebab-case, unique within the plugin) and view
 *  type ids, and that every `component` is a function. Throws on bad shapes —
 *  the caller catches and records the error status. */
function normalizeContributions(
  def: Partial<FolioPluginEntry>,
  manifest: FolioPluginManifest,
): FolioContributions {
  const raw = def.contributions;
  let widgets = raw?.widgets?.slice();
  const views = raw?.views?.slice();

  // Fold legacy single `component` into one widget contribution — but only
  // when the unified `contributions.widgets` is absent (unified wins).
  if ((!widgets || widgets.length === 0) && typeof def.component === 'function') {
    widgets = [{ id: 'default', component: def.component }];
  }

  // --- Validate widgets ----------------------------------------------------
  const widgetIds = new Set<string>();
  const normalizedWidgets = (widgets ?? []).map((w, i) => {
    if (typeof w.component !== 'function') {
      throw new Error(
        `plugin "${manifest.id}" widget #${i} has no callable \`component\``,
      );
    }
    const id = w.id ?? (widgets!.length === 1 ? 'default' : `widget-${i}`);
    if (!CONTRIBUTION_ID_RE.test(id)) {
      throw new Error(
        `plugin "${manifest.id}" widget id "${id}" is invalid (must match /^[a-z0-9-]+$/)`,
      );
    }
    if (widgetIds.has(id)) {
      throw new Error(
        `plugin "${manifest.id}" has duplicate widget id "${id}"`,
      );
    }
    widgetIds.add(id);
    return { ...w, id };
  });

  // --- Validate views ------------------------------------------------------
  const viewIds = new Set<string>();
  const normalizedViews = (views ?? []).map((v, i) => {
    if (typeof v.component !== 'function') {
      throw new Error(
        `plugin "${manifest.id}" view #${i} "${v.type}" has no callable \`component\``,
      );
    }
    if (!v.type || !CONTRIBUTION_ID_RE.test(v.type)) {
      throw new Error(
        `plugin "${manifest.id}" view type "${v.type}" is invalid (must match /^[a-z0-9-]+$/)`,
      );
    }
    if (viewIds.has(v.type)) {
      throw new Error(
        `plugin "${manifest.id}" has duplicate view type "${v.type}"`,
      );
    }
    viewIds.add(v.type);
    return v;
  });

  if (normalizedWidgets.length === 0 && normalizedViews.length === 0) {
    // Valid but useless — load it anyway so the manager can show it; the
    // pickers simply won't list anything from it.
    console.warn(
      `[folio:plugins] plugin "${manifest.id}" declares no widgets and no views`,
    );
  }

  return {
    widgets: normalizedWidgets.length > 0 ? normalizedWidgets : undefined,
    views: normalizedViews.length > 0 ? normalizedViews : undefined,
  };
}

// ============================================================================
// Selectors
// ----------------------------------------------------------------------------
// All selectors below are now trivial accessors over cached derived state
// (rebuilt inside `set()` whenever `plugins` changes). Returning a fresh array
// here would defeat `useShallow` — its element comparison is `Object.is`, so a
// new array of new entry-object literals always looks "changed" and triggers
// an infinite `useSyncExternalStore` rerender loop in React 19.
// ============================================================================

/** All enabled plugins, sorted by name. Computed live from `plugins` — used
 *  only by callers that explicitly want a fresh derivation (e.g. tests). UI
 *  components should prefer the cached `state.widgetContributions`. */
export function selectEnabledPlugins(state: PluginRegistryState): LoadedPlugin[] {
  return sortedEnabledPlugins(state.plugins);
}

/** A widget contribution paired with the plugin that owns it. Emitted by
 *  {@link selectWidgetContributions} for the "Add widget" picker. */
export interface WidgetContributionEntry {
  plugin: LoadedPlugin;
  contribution: NonNullable<NonNullable<FolioContributions['widgets']>[number]>;
  /** Resolved widget id (never undefined — normalized at load time). */
  widgetId: string;
  /** Resolved display name (contribution → manifest). */
  name: string;
  /** Resolved description (contribution → manifest → undefined). */
  description?: string;
}

/** A view contribution paired with the plugin that owns it. Emitted by
 *  {@link selectViewContributions} for the "New view" picker. */
export interface ViewContributionEntry {
  plugin: LoadedPlugin;
  contribution: NonNullable<NonNullable<FolioContributions['views']>[number]>;
  /** The namespaced type persisted on `ViewConfig.type`:
   *  `plugin:<pluginId>:<type>`. */
  persistedType: string;
}

/** Prefix marking a view type as plugin-provided. Followed by
 *  `<pluginId>:<viewType>`. Built-in types never start with this. */
export const PLUGIN_VIEW_TYPE_PREFIX = 'plugin:';

/** Build the persisted `ViewConfig.type` string for a plugin view
 *  contribution: `plugin:<pluginId>:<viewType>`. */
export function pluginViewTypeId(pluginId: string, viewType: string): string {
  return `${PLUGIN_VIEW_TYPE_PREFIX}${pluginId}:${viewType}`;
}

/** Parse a persisted view type back into `{ pluginId, viewType }` when it's a
 *  plugin view type; returns null for built-in types. */
export function parsePluginViewType(
  type: string,
): { pluginId: string; viewType: string } | null {
  if (!type.startsWith(PLUGIN_VIEW_TYPE_PREFIX)) return null;
  const rest = type.slice(PLUGIN_VIEW_TYPE_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  return { pluginId: rest.slice(0, sep), viewType: rest.slice(sep + 1) };
}

/** All widget contributions across all enabled plugins, in a stable order
 *  (plugin name → widget order). The dashboard "Add widget" picker lists
 *  these flattened (each entry knows its plugin so the UI can group/label).
 *
 *  Returns the cached `state.widgetContributions` array (rebuilt on every
 *  `plugins` mutation) so subscribers receive a stable reference. */
export function selectWidgetContributions(state: PluginRegistryState): WidgetContributionEntry[] {
  return state.widgetContributions;
}

/** All view contributions across all enabled plugins, in a stable order.
 *  The "New view" picker appends these to the built-in types.
 *
 *  Returns the cached `state.viewContributions` array (rebuilt on every
 *  `plugins` mutation) so subscribers receive a stable reference. */
export function selectViewContributions(state: PluginRegistryState): ViewContributionEntry[] {
  return state.viewContributions;
}
