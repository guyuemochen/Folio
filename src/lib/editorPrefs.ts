/**
 * Editor display preferences — font size scale + spell check toggle.
 *
 * Persisted in localStorage (like theme / language / update-channel). Font
 * size is applied as a CSS variable on `:root` so `.prose-mirror` and its
 * descendants pick it up via `calc(<px> * var(--editor-font-scale))` without
 * a re-render. Spell check is read by the Editor at mount and updated live
 * via the `folio:editor-prefs-changed` event.
 */

export type EditorFontPref = 'small' | 'medium' | 'large';

const FONT_SCALE: Record<EditorFontPref, number> = {
  small: 0.93,
  medium: 1,
  large: 1.13,
};

const FONT_PREF_KEY = 'folio:editor-font';
const SPELLCHECK_PREF_KEY = 'folio:editor-spellcheck';

function isFontPref(v: string | null): v is EditorFontPref {
  return v === 'small' || v === 'medium' || v === 'large';
}

/** Read the persisted font-size preference (defaults to `'medium'`). */
export function getEditorFontPref(): EditorFontPref {
  const v = localStorage.getItem(FONT_PREF_KEY);
  return isFontPref(v) ? v : 'medium';
}

/**
 * Persist + immediately apply the font-size preference, then notify running
 * editors via the `folio:editor-prefs-changed` event.
 */
export function setEditorFontPref(pref: EditorFontPref): void {
  localStorage.setItem(FONT_PREF_KEY, pref);
  applyFontScale(pref);
  window.dispatchEvent(new CustomEvent('folio:editor-prefs-changed'));
}

/** Read the persisted spell-check preference (defaults to `true`). */
export function getSpellcheckPref(): boolean {
  const v = localStorage.getItem(SPELLCHECK_PREF_KEY);
  // Treat any explicit "false" as off; everything else (including missing) as on.
  return v !== 'false';
}

/** Persist + notify running editors so they toggle `spellcheck` live. */
export function setSpellcheckPref(enabled: boolean): void {
  localStorage.setItem(SPELLCHECK_PREF_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('folio:editor-prefs-changed'));
}

function applyFontScale(pref: EditorFontPref): void {
  document.documentElement.style.setProperty(
    '--editor-font-scale',
    String(FONT_SCALE[pref]),
  );
}

/**
 * Call once before React renders (in `main.tsx`, right after `initTheme()`)
 * so the editor paints at the right size on first mount.
 */
export function initEditorPrefs(): void {
  applyFontScale(getEditorFontPref());
}
