import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const MQ = '(prefers-color-scheme: dark)';

function readSystemTheme(): Theme {
  return window.matchMedia(MQ).matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Call once before React renders (in `main.tsx`, right after the CSS import)
 * to set the initial theme and avoid a flash of the wrong color scheme.
 *
 * MVP follows the OS preference only (PRD §10.4 / §10.5 — no Settings UI for
 * manual toggle yet); the returned `useTheme` hook is the extension point.
 */
export function initTheme(): void {
  applyTheme(readSystemTheme());
}

/**
 * Subscribe to live OS theme changes. Returns the current theme so callers
 * may branch on it. Mount once near the app root (e.g. `<App/>`).
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const mql = window.matchMedia(MQ);
    const onChange = (e: MediaQueryListEvent) => {
      const next: Theme = e.matches ? 'dark' : 'light';
      applyTheme(next);
      setTheme(next);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return theme;
}
