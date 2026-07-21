import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDialog } from '../lib/dialog';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../lib/theme';
import {
  getUpdateChannel,
  setUpdateChannel,
  type UpdateChannel,
} from '../lib/updater';
import {
  getLanguagePreference,
  setLanguagePreference,
  type LanguagePreference,
} from '../i18n/config';

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

/**
 * Settings dialog — appearance (theme) + update channel.
 *
 * The theme preference is persisted + applied live via `setThemePreference`
 * (PRD §10.4). The update channel reuses `src/lib/updater.ts` so this and
 * the About dialog share the same source of truth.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const [channel, setChannel] = useState<UpdateChannel>(() => getUpdateChannel());
  const [langPref, setLangPref] = useState<LanguagePreference>(() => getLanguagePreference());

  const dialog = useDialog({ onClose, label: t('settings.title') });

  const handleTheme = (pref: ThemePreference) => {
    setThemePref(pref);
    setThemePreference(pref);
  };

  const handleChannel = (c: UpdateChannel) => {
    setChannel(c);
    setUpdateChannel(c);
  };

  const handleLanguage = (l: LanguagePreference) => {
    setLangPref(l);
    setLanguagePreference(l);
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
        className="w-[520px] max-h-[80vh] bg-bg-page rounded-lg shadow-popover border border-border-hairline flex flex-col"
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

        <div className="p-5 space-y-6 overflow-y-auto">
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
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-border-hairline flex items-center justify-end">
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
