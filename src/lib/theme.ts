import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
/**
 * The user's theme preference. `'system'` follows the OS color scheme;
 * `'light'` / `'dark'` force a specific appearance regardless of the OS.
 */
export type ThemePreference = 'system' | Theme;

const MQ = '(prefers-color-scheme: dark)';
const PREF_KEY = 'folio:theme-preference';

function readSystemTheme(): Theme {
  return window.matchMedia(MQ).matches ? 'dark' : 'light';
}

function resolveTheme(pref: ThemePreference): Theme {
  return pref === 'system' ? readSystemTheme() : pref;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Read the persisted theme preference (defaults to `'system'`). */
export function getThemePreference(): ThemePreference {
  const p = localStorage.getItem(PREF_KEY);
  return p === 'light' || p === 'dark' ? p : 'system';
}

/**
 * Persist + immediately apply a theme preference, then notify the running
 * app via the `folio:theme-changed` event so any mounted `useTheme()` hook
 * stays in sync without a reload.
 */
export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(PREF_KEY, pref);
  const resolved = resolveTheme(pref);
  applyTheme(resolved);
  window.dispatchEvent(new CustomEvent<Theme>('folio:theme-changed', { detail: resolved }));
}

/**
 * Call once before React renders (in `main.tsx`, right after the CSS import)
 * to set the initial theme and avoid a flash of the wrong color scheme.
 * Respects a manually chosen preference; falls back to the OS scheme.
 */
export function initTheme(): void {
  applyTheme(resolveTheme(getThemePreference()));
}

/**
 * Keep the resolved theme in sync at runtime.
 *
 * - In `'system'` mode, subscribes to live OS theme changes (PRD §10.4).
 * - In a manual mode, ignores OS changes but still reflects preference
 *   switches made via `setThemePreference()` through `folio:theme-changed`.
 *
 * Mount once near the app root (e.g. `<App/>`). Returns the currently
 * resolved theme so callers may branch on it.
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const mql = window.matchMedia(MQ);
    const onOSChange = (e: MediaQueryListEvent) => {
      // Only react to OS changes when no manual preference is set.
      if (getThemePreference() !== 'system') return;
      const next: Theme = e.matches ? 'dark' : 'light';
      applyTheme(next);
      setTheme(next);
    };
    const onPrefChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      setTheme(next);
    };
    mql.addEventListener('change', onOSChange);
    window.addEventListener('folio:theme-changed', onPrefChange);
    return () => {
      mql.removeEventListener('change', onOSChange);
      window.removeEventListener('folio:theme-changed', onPrefChange);
    };
  }, []);

  return theme;
}
