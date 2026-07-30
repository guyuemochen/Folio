/**
 * Plugin manager modal — install / enable / disable / reload / uninstall
 * plugins (a plugin may contribute dashboard widgets and/or view types).
 *
 * Two scope sections:
 *   - **Global**   (`<appData>/plugins/`)        — shared across workspaces
 *   - **Workspace** (`<workspaceFolder>/plugins/`) — current workspace only,
 *     shadows global on id clash
 *
 * Top bar actions:
 *   - Install from file… (file picker → copies into global dir)
 *   - Open plugins folder (OS file manager at the global dir)
 *
 * Per-plugin row actions:
 *   - Enable / Disable toggle (registry store's setEnabled)
 *   - Reload (force a hot-reload cycle: unload + reloadByPath)
 *   - Uninstall (delete the file/folder via plugin_uninstall)
 *
 * The modal reads `entries` (raw directory listing) + `plugins`/`statuses`
 * (loaded state) from the registry store — both update live as the watcher
 * fires `folio:plugin-changed` events, so install/uninstall/reload show up
 * in real time without a manual refresh.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/invoke';
import { useDialog } from '../lib/dialog';
import { usePluginRegistry } from './store';
import type { PluginListEntry, PluginScope } from './types';

interface Props {
  onClose: () => void;
}

export function PluginManagerModal({ onClose }: Props) {
  const { t } = useTranslation();
  const dialog = useDialog({ onClose, label: t('database.plugins.manager.title') });

  // Subscribe to the registry. We pull the raw entries (for the listing) and
  // the loaded plugins (for status / enable toggle). Both update live.
  const entries = usePluginRegistry((s) => s.entries);
  const plugins = usePluginRegistry((s) => s.plugins);
  const statuses = usePluginRegistry((s) => s.statuses);
  const reloadByPath = usePluginRegistry((s) => s.reloadByPath);
  const setEnabled = usePluginRegistry((s) => s.setEnabled);
  const scan = usePluginRegistry((s) => s.scan);

  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const globalEntries = entries.filter((e) => e.scope === 'global');
  const workspaceEntries = entries.filter((e) => e.scope === 'workspace');

  /** Look up the loaded plugin for an entry (by source path). Folder plugins
   *  match on the folder path; single-file plugins on the .js path. */
  function findLoadedForEntry(entry: PluginListEntry) {
    return Object.values(plugins).find((p) => p.sourcePath === entry.path) ?? null;
  }

  /** Shared install core: copy the picked source into the global plugins dir
   *  via the backend, then refresh listings + load. `displayName` is what we
   *  show in the success toast (basename for folders, full path for files). */
  async function installFromPath(srcPath: string, displayName: string) {
    setBusyPath(srcPath);
    try {
      await api.pluginInstallFile(srcPath);
      await scan(); // refresh listings + load the new plugin
      setFeedback({ kind: 'ok', msg: t('database.plugins.manager.installSuccess', { name: displayName }) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[folio:plugins] install failed:', e);
      setFeedback({ kind: 'err', msg: t('database.plugins.manager.installError', { error: msg }) });
    } finally {
      setBusyPath(null);
    }
  }

  /** Pick a single .js file (single-file plugin) OR any file inside a folder
   *  plugin — the backend auto-detects a sibling `manifest.json` and copies
   *  the whole folder. This makes the README's "pick any file inside the
   *  folder — Folio copies the whole folder" promise true. */
  async function handleInstall() {
    setFeedback(null);
    const picked = await open({
      multiple: false,
      title: t('database.plugins.manager.install'),
      filters: [
        { name: 'JavaScript', extensions: ['js'] },
        { name: 'All', extensions: ['*'] },
      ],
    });
    if (!picked || Array.isArray(picked)) return;
    await installFromPath(picked, picked);
  }

  /** Pick a directory directly — the explicit path for folder plugins
   *  (manifest.json + entry .js). Complements `handleInstall` for users who
   *  prefer selecting the folder itself over drilling in to pick a file. */
  async function handleInstallFolder() {
    setFeedback(null);
    const picked = await open({
      multiple: false,
      directory: true,
      title: t('database.plugins.manager.installFolder'),
    });
    if (!picked || Array.isArray(picked)) return;
    // Show the folder basename (not the full path) in the toast — it's what
    // the user will see in the plugin list.
    const name = picked.split(/[\\/]/).pop() ?? picked;
    await installFromPath(picked, name);
  }

  async function handleUninstall(entry: PluginListEntry) {
    setFeedback(null);
    const loaded = findLoadedForEntry(entry);
    const name = loaded?.manifest.name ?? entry.name;
    // Native confirm — simple and accessible. Doesn't need our t() hook.
    const ok = window.confirm(t('database.plugins.manager.uninstallConfirm', { name }));
    if (!ok) return;
    try {
      setBusyPath(entry.path);
      await api.pluginUninstall(entry.path);
      await scan();
      setFeedback({ kind: 'ok', msg: t('database.plugins.manager.uninstall') + ': ' + name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback({ kind: 'err', msg: t('database.plugins.manager.installError', { error: msg }) });
    } finally {
      setBusyPath(null);
    }
  }

  async function handleReload(entry: PluginListEntry) {
    setFeedback(null);
    try {
      setBusyPath(entry.path);
      await reloadByPath(entry.path, entry.scope as PluginScope);
      setFeedback({ kind: 'ok', msg: t('database.plugins.manager.reload') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback({ kind: 'err', msg: msg });
    } finally {
      setBusyPath(null);
    }
  }

  async function handleToggleEnabled(entry: PluginListEntry, nextEnabled: boolean) {
    const loaded = findLoadedForEntry(entry);
    if (loaded) {
      await setEnabled(loaded.manifest.id, nextEnabled);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[900] bg-black/20 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        {...dialog.containerProps}
        className="w-[720px] max-h-[80vh] bg-bg-page rounded-lg shadow-popover border border-border-hairline flex flex-col"
      >
        {/* Header */}
        <header className="px-5 py-3 border-b border-border-hairline flex items-center gap-3">
          <h2 className="text-h3 flex-1">{t('database.plugins.manager.title')}</h2>
          <button
            type="button"
            onClick={handleInstall}
            disabled={busyPath !== null}
            className="px-3 py-1 text-sm rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {t('database.plugins.manager.install')}
          </button>
          <button
            type="button"
            onClick={handleInstallFolder}
            disabled={busyPath !== null}
            className="px-3 py-1 text-sm rounded-md border border-border-hairline hover:bg-bg-hover text-text-primary disabled:opacity-50 transition-colors"
          >
            {t('database.plugins.manager.installFolder')}
          </button>
          <button
            type="button"
            onClick={() => void api.pluginOpenDir('global')}
            className="px-2.5 py-1 text-xs rounded-md border border-border-hairline hover:bg-bg-hover text-text-primary transition-colors"
          >
            {t('database.plugins.manager.openFolder')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary px-2 text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {/* Body — sectioned by scope */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {feedback && (
            <div
              className={[
                'mx-5 mt-3 px-3 py-2 text-xs rounded border',
                feedback.kind === 'ok'
                  ? 'border-status-green/40 bg-status-green/10 text-status-green'
                  : 'border-status-red/40 bg-status-red/10 text-status-red',
              ].join(' ')}
            >
              {feedback.msg}
            </div>
          )}

          <PluginSection
            title={t('database.plugins.manager.global')}
            hint={t('database.plugins.manager.globalHint')}
            entries={globalEntries}
            findLoadedForEntry={findLoadedForEntry}
            statuses={statuses}
            busyPath={busyPath}
            onReload={handleReload}
            onUninstall={handleUninstall}
            onToggleEnabled={handleToggleEnabled}
          />

          <PluginSection
            title={t('database.plugins.manager.workspace')}
            hint={t('database.plugins.manager.workspaceHint')}
            entries={workspaceEntries}
            findLoadedForEntry={findLoadedForEntry}
            statuses={statuses}
            busyPath={busyPath}
            onReload={handleReload}
            onUninstall={handleUninstall}
            onToggleEnabled={handleToggleEnabled}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// Section + row components
// ============================================================================

interface SectionProps {
  title: string;
  hint: string;
  entries: PluginListEntry[];
  findLoadedForEntry: (e: PluginListEntry) => {
    manifest: { id: string; name: string; version: string; description?: string; author?: string };
    enabled: boolean;
    revision: number;
  } | null;
  statuses: Record<string, { state: string; error?: string }>;
  busyPath: string | null;
  onReload: (e: PluginListEntry) => void;
  onUninstall: (e: PluginListEntry) => void;
  onToggleEnabled: (e: PluginListEntry, next: boolean) => void;
}

function PluginSection({
  title,
  hint,
  entries,
  findLoadedForEntry,
  statuses,
  busyPath,
  onReload,
  onUninstall,
  onToggleEnabled,
}: SectionProps) {
  const { t } = useTranslation();
  return (
    <section className="mt-4 first:mt-3 mb-4">
      <header className="px-5 pb-1 flex items-baseline gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {title}
        </h3>
        <span className="text-[11px] text-text-tertiary/70">{hint}</span>
      </header>
      {entries.length === 0 ? (
        <div className="px-5 py-3 text-xs text-text-tertiary italic">
          {t('database.plugins.manager.noPlugins')}
        </div>
      ) : (
        <ul className="px-3">
          {entries.map((entry) => {
            const loaded = findLoadedForEntry(entry);
            // Status lookup: prefer the loaded plugin's id; fall back to a
            // path-derived synthetic id used by the store for broken entries.
            const statusKey = loaded?.manifest.id ?? entry.path;
            const status = statuses[statusKey];
            const isBusy = busyPath === entry.path;
            return (
              <li
                key={entry.path}
                className="px-2 py-2 rounded-md hover:bg-bg-hover/50 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {loaded?.manifest.name ?? entry.name}
                    </span>
                    {loaded?.manifest.version && (
                      <span className="text-[10px] text-text-tertiary">
                        {t('database.plugins.manager.version', {
                          version: loaded.manifest.version,
                        })}
                      </span>
                    )}
                    {loaded?.manifest.author && (
                      <span className="text-[10px] text-text-tertiary">
                        {t('database.plugins.manager.by', { author: loaded.manifest.author })}
                      </span>
                    )}
                  </div>
                  {loaded?.manifest.description && (
                    <p className="mt-0.5 text-xs text-text-secondary line-clamp-2">
                      {loaded.manifest.description}
                    </p>
                  )}
                  {!loaded && status?.error && (
                    <p className="mt-0.5 text-xs text-status-red line-clamp-3 font-mono">
                      {t('database.plugins.manager.errorLoad', { error: status.error })}
                    </p>
                  )}
                  {!loaded && !status?.error && (
                    <p className="mt-0.5 text-xs text-text-tertiary italic">
                      {entry.kind === 'file' ? '.js' : 'folder'} · {entry.name}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {loaded && (
                    <label className="flex items-center gap-1 text-[11px] text-text-tertiary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={loaded.enabled}
                        onChange={(e) => onToggleEnabled(entry, e.target.checked)}
                        className="accent-accent"
                        aria-label={t(
                          loaded.enabled
                            ? 'database.plugins.manager.disable'
                            : 'database.plugins.manager.enable',
                        )}
                      />
                      <span>{loaded.enabled ? '✓' : '○'}</span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => onReload(entry)}
                    disabled={isBusy}
                    className="px-2 py-0.5 text-[11px] rounded border border-border-hairline hover:bg-bg-hover text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
                    title={t('database.plugins.manager.reload')}
                  >
                    ⟳
                  </button>
                  <button
                    type="button"
                    onClick={() => onUninstall(entry)}
                    disabled={isBusy}
                    className="px-2 py-0.5 text-[11px] rounded border border-border-hairline hover:border-status-red/40 hover:text-status-red text-text-tertiary disabled:opacity-50 transition-colors"
                    title={t('database.plugins.manager.uninstall')}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Unused imports kept here so the file compiles even if a code path is
// removed during refactor. (PluginScope is referenced by API signatures.)
export type { PluginScope };
