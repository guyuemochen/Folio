import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { useDialog } from '../lib/dialog';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../lib/theme';
import {
  getUpdateChannel,
  setUpdateChannel,
  checkForUpdate,
  installUpdate,
  type UpdateChannel,
} from '../lib/updater';
import {
  getLanguagePreference,
  setLanguagePreference,
  type LanguagePreference,
} from '../i18n/config';
import {
  getEditorFontPref,
  setEditorFontPref,
  getSpellcheckPref,
  setSpellcheckPref,
  type EditorFontPref,
} from '../lib/editorPrefs';
import { api } from '../lib/invoke';
import { openUserManual } from '../lib/openManual';
import { AiSettings } from '../ai/AiSettings';

interface SettingsModalProps {
  onClose: () => void;
}

const THEME_OPTIONS: { id: ThemePreference; labelKey: string }[] = [
  { id: 'system', labelKey: 'settings.themeSystem' },
  { id: 'light', labelKey: 'settings.themeLight' },
  { id: 'dark', labelKey: 'settings.themeDark' },
];

/**
 * Language options. `system` is localized; concrete languages are shown in
 * their own writing so users can recognize their language regardless of the
 * current UI language (standard convention).
 */
const LANGUAGE_OPTIONS: { id: LanguagePreference; label: string }[] = [
  { id: 'system', label: '' }, // filled at render time via t('settings.languageSystem')
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '中文' },
];

const CHANNELS: { id: UpdateChannel; labelKey: string; hintKey: string }[] = [
  { id: 'stable', labelKey: 'about.channelStable', hintKey: 'about.channelStableHint' },
  { id: 'nightly', labelKey: 'about.channelNightly', hintKey: 'about.channelNightlyHint' },
];

const FONT_OPTIONS: { id: EditorFontPref; labelKey: string }[] = [
  { id: 'small', labelKey: 'settings.editorFontSmall' },
  { id: 'medium', labelKey: 'settings.editorFontMedium' },
  { id: 'large', labelKey: 'settings.editorFontLarge' },
];

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; version: string }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

type Tab = 'general' | 'ai';

/**
 * Settings dialog — tabbed (General + AI Assistant).
 *
 * General: appearance (theme) + language + update channel.
 * AI Assistant: provider config (enable / provider / API key / model /
 *   base URL / test connection) — backed by `ai_settings` table, lives in
 *   the workspace DB so it follows the data folder. See `src/ai/AiSettings.tsx`.
 *
 * The theme preference is persisted + applied live via `setThemePreference`
 * (PRD §10.4). The update channel reuses `src/lib/updater.ts` so this and
 * the About dialog share the same source of truth.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('general');
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const [channel, setChannel] = useState<UpdateChannel>(() => getUpdateChannel());
  const [langPref, setLangPref] = useState<LanguagePreference>(() => getLanguagePreference());
  const [fontPref, setFontPref] = useState<EditorFontPref>(() => getEditorFontPref());
  const [spellcheck, setSpellcheck] = useState<boolean>(() => getSpellcheckPref());

  // App version — shown next to the update channel.
  const [version, setVersion] = useState('');
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion('0.1.0'));
  }, []);

  // Active workspace folder path — shown read-only in the Data section.
  const [dataPath, setDataPath] = useState<string>('');
  useEffect(() => {
    api
      .getCurrentWorkspace()
      .then((ws) => setDataPath(stripVerbatimPrefix(ws.folderPath)))
      .catch(() => setDataPath(''));
  }, []);

  // Update check state machine — mirrors AboutModal.tsx so Settings and
  // About share identical UX for the same backend (`src/lib/updater.ts`).
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [openingFolder, setOpeningFolder] = useState(false);

  const dialog = useDialog({ onClose, label: t('settings.title') });

  const handleTheme = (pref: ThemePreference) => {
    setThemePref(pref);
    setThemePreference(pref);
  };

  const handleChannel = (c: UpdateChannel) => {
    setChannel(c);
    setUpdateChannel(c);
    setUpdateStatus({ kind: 'idle' });
  };

  const handleLanguage = (l: LanguagePreference) => {
    setLangPref(l);
    setLanguagePreference(l);
  };

  const handleFont = (f: EditorFontPref) => {
    setFontPref(f);
    setEditorFontPref(f);
  };

  const handleSpellcheck = (enabled: boolean) => {
    setSpellcheck(enabled);
    setSpellcheckPref(enabled);
  };

  const handleCheckUpdate = async () => {
    if (updateStatus.kind === 'checking' || updateStatus.kind === 'installing') return;
    setUpdateStatus({ kind: 'checking' });
    // Apply the current channel selection before checking.
    setUpdateChannel(channel);
    try {
      const result = await checkForUpdate();
      setUpdateStatus(
        result.available && result.version
          ? { kind: 'available', version: result.version }
          : { kind: 'upToDate' },
      );
    } catch (err) {
      setUpdateStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleInstallUpdate = async () => {
    if (updateStatus.kind !== 'available') return;
    setUpdateStatus({ kind: 'installing' });
    try {
      await installUpdate();
    } catch (err) {
      setUpdateStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleOpenFolder = async () => {
    if (openingFolder) return;
    setOpeningFolder(true);
    try {
      await api.openWorkspaceFolder();
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('folio:toast', {
          detail: t('settings.openDataFolderError', { error: String(err) }),
        }),
      );
    } finally {
      setOpeningFolder(false);
    }
  };

  // Open the user manual in a standalone OS window (see lib/openManual.ts).
  // Close the settings modal afterwards so the user lands on the manual.
  const handleOpenManual = async () => {
    try {
      await openUserManual();
      onClose();
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('folio:toast', {
          detail: t('settings.openUserManualError', { error: String(err) }),
        }),
      );
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[900] bg-black/20 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        {...dialog.containerProps}
        className="w-[560px] max-h-[80vh] bg-bg-page rounded-lg shadow-popover border border-border-hairline flex flex-col"
      >
        <header className="px-5 py-3 border-b border-border-hairline flex items-center">
          <h2 className="text-h3 flex-1">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary px-2"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </header>

        {/* Tab bar — segment-style, like Notion/Wrapped settings. */}
        <div className="px-5 pt-3 flex gap-1.5 border-b border-border-hairline" role="tablist">
          {(['general', 'ai'] as const).map((id) => {
            const active = tab === id;
            const label = id === 'general' ? t('settings.tabGeneral') : t('settings.tabAi');
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`settings-tabpanel-${id}`}
                id={`settings-tab-${id}`}
                onClick={() => setTab(id)}
                className={[
                  'px-3 py-1.5 -mb-px border-b-2 text-[13px] transition-colors',
                  active
                    ? 'border-accent text-text-primary font-medium'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                ].join(' ')}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div
          id={`settings-tabpanel-${tab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          className="p-5 space-y-6 overflow-y-auto flex-1"
        >
          {tab === 'general' ? (
            <>
              {/* === Appearance === */}
              <section>
                <h3 className="text-[12px] font-medium text-text-primary mb-1">
                  {t('settings.appearance')}
                </h3>
                <p className="text-[11px] text-text-tertiary mb-3">{t('settings.themeHint')}</p>
                <div className="flex gap-1.5" role="radiogroup" aria-label={t('settings.appearance')}>
                  {THEME_OPTIONS.map((opt) => {
                    const active = themePref === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleTheme(opt.id)}
                        className={[
                          'flex-1 px-3 py-2 rounded-md text-[13px] transition-colors border',
                          active
                            ? 'bg-bg-active border-accent text-text-primary'
                            : 'border-border-hairline text-text-secondary hover:bg-bg-hover',
                        ].join(' ')}
                      >
                        {t(opt.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* === Language === */}
              <section>
                <h3 className="text-[12px] font-medium text-text-primary mb-1">
                  {t('settings.language')}
                </h3>
                <p className="text-[11px] text-text-tertiary mb-3">{t('settings.languageHint')}</p>
                <div className="flex gap-1.5" role="radiogroup" aria-label={t('settings.language')}>
                  {LANGUAGE_OPTIONS.map((opt) => {
                    const active = langPref === opt.id;
                    const label = opt.id === 'system' ? t('settings.languageSystem') : opt.label;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleLanguage(opt.id)}
                        className={[
                          'flex-1 px-3 py-2 rounded-md text-[13px] transition-colors border',
                          active
                            ? 'bg-bg-active border-accent text-text-primary'
                            : 'border-border-hairline text-text-secondary hover:bg-bg-hover',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* === Editor (font size + spell check) === */}
              <section>
                <h3 className="text-[12px] font-medium text-text-primary mb-1">
                  {t('settings.editor')}
                </h3>
                <p className="text-[11px] text-text-tertiary mb-3">{t('settings.editorFontHint')}</p>
                <div className="flex gap-1.5 mb-4" role="radiogroup" aria-label={t('settings.editorFont')}>
                  {FONT_OPTIONS.map((opt) => {
                    const active = fontPref === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleFont(opt.id)}
                        className={[
                          'flex-1 px-3 py-2 rounded-md text-[13px] transition-colors border',
                          active
                            ? 'bg-bg-active border-accent text-text-primary'
                            : 'border-border-hairline text-text-secondary hover:bg-bg-hover',
                        ].join(' ')}
                      >
                        {t(opt.labelKey)}
                      </button>
                    );
                  })}
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={spellcheck}
                    onChange={(e) => handleSpellcheck(e.target.checked)}
                    className="mt-0.5 accent-accent"
                  />
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">
                      {t('settings.spellcheck')}
                    </span>
                    <span className="block text-[11px] text-text-tertiary mt-0.5">
                      {t('settings.spellcheckHint')}
                    </span>
                  </span>
                </label>
              </section>

              {/* === Data (storage location) === */}
              <section>
                <h3 className="text-[12px] font-medium text-text-primary mb-1">
                  {t('settings.data')}
                </h3>
                <p className="text-[11px] text-text-tertiary mb-2">{t('settings.dataLocationHint')}</p>
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border-hairline bg-bg-section">
                  <code className="flex-1 min-w-0 truncate text-[12px] text-text-secondary" title={dataPath}>
                    {dataPath || '—'}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleOpenFolder()}
                    disabled={!dataPath || openingFolder}
                    className="shrink-0 px-2.5 py-1 text-[12px] rounded border border-border-hairline hover:bg-bg-hover text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {openingFolder ? t('settings.opening') : t('settings.openDataFolder')}
                  </button>
                </div>
              </section>

              {/* === Updates === */}
              <section>
                <h3 className="text-[12px] font-medium text-text-primary mb-2">
                  {t('settings.updates')}
                </h3>
                <div className="space-y-1.5">
                  {CHANNELS.map((c) => {
                    const active = channel === c.id;
                    return (
                      <label
                        key={c.id}
                        className={[
                          'flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors',
                          active ? 'bg-bg-active' : 'hover:bg-bg-hover',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="settings-channel"
                          checked={active}
                          onChange={() => handleChannel(c.id)}
                          className="mt-0.5 accent-accent"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] text-text-primary">{t(c.labelKey)}</span>
                          <span className="block text-[11px] text-text-tertiary">{t(c.hintKey)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-text-tertiary/80">{t('about.channelPrivacy')}</p>

                {/* Version + check-update action (reuses the about.* i18n keys
                    so Settings and About stay in sync). */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {version && (
                    <span className="text-[11px] text-text-tertiary">
                      {t('settings.currentVersion')} {version}
                    </span>
                  )}
                  <UpdateStatusLine status={updateStatus} t={t} />
                  <div className="ml-auto flex items-center gap-2">
                    {updateStatus.kind === 'available' ? (
                      <button
                        type="button"
                        onClick={() => void handleInstallUpdate()}
                        className="px-3 py-1 text-[12px] rounded bg-accent hover:bg-accent-hover text-white"
                      >
                        {t('about.downloadInstall')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleCheckUpdate()}
                        disabled={
                          updateStatus.kind === 'checking' || updateStatus.kind === 'installing'
                        }
                        className="px-3 py-1 text-[12px] rounded border border-border-hairline hover:bg-bg-hover text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {updateStatus.kind === 'checking'
                          ? t('about.checking')
                          : updateStatus.kind === 'installing'
                            ? t('about.installing')
                            : t('about.checkForUpdates')}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : (
            /* === AI tab === */
            <AiSettings />
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border-hairline flex items-center justify-between">
          <button
            type="button"
            onClick={() => void handleOpenManual()}
            className="px-3 py-1 text-sm rounded border border-border-hairline hover:bg-bg-hover text-text-primary"
          >
            {t('settings.openUserManual')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm rounded bg-accent hover:bg-accent-hover text-white"
          >
            {t('common.done')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Inline status text for the update-check action (mirrors AboutModal). */
function UpdateStatusLine({
  status,
  t,
}: {
  status: UpdateStatus;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'checking':
      return (
        <span className="text-[11px] text-text-tertiary animate-pulse">{t('about.checkingStatus')}</span>
      );
    case 'upToDate':
      return <span className="text-[11px] text-status-green">{t('about.upToDate')}</span>;
    case 'available':
      return (
        <span className="text-[11px] text-text-primary">
          {t('about.updateAvailable', { version: status.version })}
        </span>
      );
    case 'installing':
      return (
        <span className="text-[11px] text-text-tertiary animate-pulse">{t('about.installingStatus')}</span>
      );
    case 'error':
      return (
        <span className="text-[11px] text-status-red truncate max-w-[180px]" title={status.message}>
          {status.message}
        </span>
      );
  }
}

/**
 * Strip the Windows "verbatim" / extended-length path prefix that
 * `std::fs::canonicalize` adds on Windows so the displayed path reads as
 * `C:\foo` instead of `\\?\C:\foo`. UNC paths (`\\?\UNC\server\share`) are
 * restored to the user-friendly `\\server\share` form. No-op on non-Windows
 * path shapes.
 */
function stripVerbatimPrefix(p: string): string {
  if (p.startsWith('\\\\?\\UNC\\')) return '\\\\' + p.slice(8);
  if (p.startsWith('\\\\?\\')) return p.slice(4);
  return p;
}
