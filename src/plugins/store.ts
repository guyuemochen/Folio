/**
 * Plugin registry — the central runtime state of all loaded plugins.
 *
 * One Zustand store keyed by resolved plugin id. Holds:
 *   - `plugins[id]`  — LoadedPlugin (manifest + component + metadata + revision)
 *   - `statuses[id]` — current lifecycle state (loading / loaded / error / disabled)
 *   - `entries`      — the raw directory listing from `plugin_list` (so the
 *                      manager UI can show all entries even when some failed
 *                      to load)
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
  FolioPluginEntry,
  FolioPluginHost,
  FolioPluginManifest,
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
    let loaded: { manifest: FolioPluginManifest; component: FolioPluginEntry['component'] };
    try {
      const code = await api.pluginReadText(entryPath);
      const blob = new Blob([code], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      // `/* @vite-ignore */` prevents Vite from trying to bundle this import
      // at build time (it can't — the URL is runtime-only).
      const mod = (await import(/* @vite-ignore */ blobUrl)) as {
        default?: FolioPluginEntry | { component: FolioPluginEntry['component'] };
      };
      // Blob URL is no longer needed once the module is in the cache.
      // Releasing here is safe — modules persist in the registry after import.
      URL.revokeObjectURL(blobUrl);

      const def = mod.default;
      if (!def || typeof def !== 'object') {
        throw new Error('plugin entry has no default export');
      }
      const component = (def as { component: unknown }).component;
      if (typeof component !== 'function') {
        throw new Error('plugin entry default export has no `component` function');
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
      loaded = { manifest, component: component as FolioPluginEntry['component'] };
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
      return {
        plugins: {
          ...s.plugins,
          [id]: {
            manifest: loaded.manifest,
            component: loaded.component,
            scope,
            sourcePath: path,
            importUrl: entryPath,
            revision,
            enabled: wasEnabled,
          },
        },
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
      return { plugins, statuses };
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
      return { statuses, plugins };
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

// ============================================================================
// Selectors (kept tiny — most components subscribe to the whole `plugins` map)
// ============================================================================

/** All enabled plugins, sorted by name. The "Add widget" picker uses this. */
export function selectEnabledPlugins(state: PluginRegistryState): LoadedPlugin[] {
  return Object.values(state.plugins)
    .filter((p) => p.enabled)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}
