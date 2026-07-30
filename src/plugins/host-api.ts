/**
 * Host API implementation — produces the scoped `FolioPluginHost` object each
 * plugin widget receives on mount.
 *
 * One host is created per *plugin* (not per widget instance) — multiple
 * widgets from the same plugin share a host. The host closes over:
 *   - the plugin manifest (for permission lookup + `self`)
 *   - the plugin's directory URL (for asset loading)
 *   - a plugin-scoped event bus
 *
 * Permission enforcement is host-side: `host.invoke(command)` checks
 * `manifest.permissions` before delegating to Tauri's `invoke`. Plugins
 * cannot reach the raw Tauri `invoke` — they don't bundle
 * `@tauri-apps/api`, and the SDK doesn't re-export it.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { api } from '../lib/invoke';
import {
  FolioPermissionError,
  type FolioPluginHost,
  type FolioPluginManifest,
  type FolioPluginStorage,
} from './types';

/**
 * Build a scoped host for one plugin. Callers should cache the result per
 * plugin id (the registry store does this).
 *
 * @param manifest     The plugin's manifest (id, version, permissions, …).
 * @param pluginDirUrl Absolute URL of the plugin's folder (or containing
 *                     folder for single-file plugins). Passed to the plugin
 *                     so it can load bundled assets.
 */
export function makeHost(
  manifest: FolioPluginManifest,
  pluginDirUrl: string,
): FolioPluginHost {
  // Pre-compute the permission set once per host. Plugin-scoped commands
  // (storage) are always allowed and need not appear in the manifest list.
  const allowed = new Set(manifest.permissions ?? []);
  const pluginId = manifest.id;

  // Plugin-scoped event bus. One Map per plugin (closed over here). Keys are
  // event names; values are sets of handlers. `emit` only fires handlers in
  // this Map, so other plugins cannot eavesdrop.
  const bus = new Map<string, Set<(payload: unknown) => void>>();

  const storage: FolioPluginStorage = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const v = (await api.pluginStorageGet(pluginId, key)) as T | undefined;
      // The Rust side serializes missing keys as JSON `null` rather than
      // JS `undefined`. Normalize so plugin authors can `if (v === undefined)`.
      return v === null ? undefined : v;
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      await api.pluginStorageSet(pluginId, key, value);
    },
    async delete(key: string): Promise<void> {
      await api.pluginStorageDelete(pluginId, key);
    },
    async keys(): Promise<string[]> {
      return api.pluginStorageKeys(pluginId);
    },
  };

  return {
    async invoke<T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> {
      // Plugin's own storage commands are always allowed (the data is scoped
      // server-side by plugin id, so there's no privilege in gating them).
      if (!command.startsWith('plugin_storage_') && !allowed.has(command)) {
        throw new FolioPermissionError(pluginId, command);
      }
      return tauriInvoke<T>(command, args);
    },
    storage,
    pluginDirUrl,
    // i18n: future work. Today we return the key as-is — plugin authors who
    // want localized strings should bundle them in their .js and read via
    // host.storage or their own logic.
    t: (key: string) => key,
    self: { id: pluginId, version: manifest.version, name: manifest.name },
    on(event, handler) {
      let set = bus.get(event);
      if (!set) {
        set = new Set();
        bus.set(event, set);
      }
      set.add(handler);
      // Return unsubscribe.
      return () => {
        set?.delete(handler);
      };
    },
    emit(event, payload) {
      const set = bus.get(event);
      if (!set) return;
      // Snapshot to avoid re-entrancy issues if a handler unsubscribes itself.
      for (const h of [...set]) {
        try {
          h(payload);
        } catch (e) {
          // Plugin handler crashed — log but keep delivering to other
          // handlers. The widget itself will surface the error via the
          // render ErrorBoundary; we don't want one bad handler to
          // silently swallow events others depend on.
          console.error(
            `[folio:plugins] handler for "${event}" in plugin "${pluginId}" threw:`,
            e,
          );
        }
      }
    },
  };
}
