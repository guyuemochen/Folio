/**
 * Hot reload — listens for the backend `folio:plugin-changed` event and
 * triggers a plugin reload.
 *
 * The Rust side (`src-tauri/src/plugins.rs` PluginWatcherState) watches both
 * plugin dirs with `notify`, rate-limits per-path events to 200ms, and emits
 * `folio:plugin-changed` with `{ scope, path, kind }` (kind ∈ create/modify/
 * remove). This module subscribes and dispatches:
 *
 *   - create / modify → `registry.reloadByPath(path, scope)` (load or refresh)
 *   - remove          → find the plugin whose `sourcePath === path` and
 *                       `registry.unload(id)` it
 *
 * Plus, on any change we bump the global `scanRevision` by re-running the
 * cheap `plugin_list` (so newly-added files appear in the manager UI).
 *
 * Idempotent: calling `startPluginHotReload()` more than once returns the
 * same unsubscribe function (the listener is registered once).
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePluginRegistry } from './store';
import type { PluginChangedEvent, PluginScope } from './types';

let active: UnlistenFn | null = null;
let pendingScan: ReturnType<typeof setTimeout> | null = null;

/** Subscribe to plugin file-change events and wire them to the registry.
 *  Returns an unsubscribe (rarely needed — the listener lives for the app
 *  lifetime, but useful in tests). */
export async function startPluginHotReload(): Promise<() => void> {
  if (active) return () => active?.();

  active = await listen<PluginChangedEvent>('folio:plugin-changed', (event) => {
    const { path, scope, kind } = event.payload;
    handlePluginChange(path, scope as PluginScope, kind).catch((e) => {
      console.error('[folio:plugins] hot reload handler threw:', e);
    });
  });

  return () => {
    active?.();
    active = null;
    if (pendingScan) {
      clearTimeout(pendingScan);
      pendingScan = null;
    }
  };
}

async function handlePluginChange(
  path: string,
  scope: PluginScope,
  kind: string,
): Promise<void> {
  const registry = usePluginRegistry.getState();

  if (kind === 'remove') {
    // Find the plugin(s) whose source path matches and unload them.
    const state = usePluginRegistry.getState();
    for (const [id, plugin] of Object.entries(state.plugins)) {
      if (plugin.sourcePath === path) {
        registry.unload(id);
      }
    }
  } else {
    // create or modify — load (or reload) the entry. reloadByPath is
    // idempotent: a brand-new file gets loaded; an existing one gets
    // refreshed (revision bumped, host rebuilt).
    await registry.reloadByPath(path, scope);
  }

  // Coalesce a `plugin_list` rescan: notify's recursive watch can fire
  // multiple events for one editor save (manifest + js, temp files, etc.).
  // We wait 300ms of quiet, then refresh the directory listing so the
  // manager UI picks up new entries.
  if (pendingScan) clearTimeout(pendingScan);
  pendingScan = setTimeout(() => {
    pendingScan = null;
    void usePluginRegistry.getState().scan();
  }, 300);
}
