/**
 * i18next initialization (PRD §10.5).
 *
 * MVP supports `en` and `zh-CN`. Language is detected from the system
 * locale via `navigator.language` (the webview reports the OS locale).
 * Unsupported locales fall back to English. No async backend — the
 * translation tables are bundled as JSON via Vite's native JSON import,
 * so no network request is required and the language is available
 * synchronously before React mounts.
 *
 * Namespacing follows the layout documented in `src/i18n/locales/en.json`:
 * common.*, sidebar.*, page.*, editor.*, database.*, search.*, trash.*,
 * history.*, importExport.*, settings.*.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The user's language preference. `'system'` follows the OS locale (via
 * `detectLanguage`); an explicit code forces that language regardless of OS.
 */
export type LanguagePreference = 'system' | SupportedLanguage;

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

const LANG_PREF_KEY = 'folio:language-preference';

/**
 * Resolve the user's preferred language from the webview environment.
 *
 * `navigator.languages` is preferred over `navigator.language` because it
 * captures the full preference order (e.g. `['zh-CN', 'zh', 'en']`). We
 * pick the first entry that matches a supported language; precise match
 * (`zh-CN`) wins over language-only match (`zh`).
 */
export function detectLanguage(): SupportedLanguage {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  const candidates = navigator.languages?.length
    ? [...navigator.languages]
    : [navigator.language].filter(Boolean) as string[];
  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh-hans') return 'zh-CN';
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
  }
  return DEFAULT_LANGUAGE;
}

/** Read the persisted language preference (defaults to `'system'`). */
export function getLanguagePreference(): LanguagePreference {
  const p = localStorage.getItem(LANG_PREF_KEY);
  if (p === 'en' || p === 'zh-CN') return p;
  return 'system';
}

/** Resolve a preference (possibly `'system'`) to a concrete language code. */
export function resolveLanguage(pref: LanguagePreference): SupportedLanguage {
  return pref === 'system' ? detectLanguage() : pref;
}

/**
 * Persist + immediately apply a language preference. `i18n.changeLanguage`
 * triggers a re-render of every `useTranslation()` consumer, so the whole
 * UI updates live without a reload.
 */
export function setLanguagePreference(pref: LanguagePreference): void {
  localStorage.setItem(LANG_PREF_KEY, pref);
  void i18n.changeLanguage(resolveLanguage(pref));
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: resolveLanguage(getLanguagePreference()),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  // Allow `t('sidebar.favorites')` style dot-lookup on the flat JSON.
  keySeparator: '.',
  // Allow `defaultValue` to surface in missing-key situations, useful for
  // catching untranslated keys during development without breaking UX.
  returnEmptyString: false,
  interpolation: {
    // React already escapes, no need for i18next to do it.
    escapeValue: false,
  },
});

export default i18n;
