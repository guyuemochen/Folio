import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Opens the user manual in a standalone OS window.
 *
 * Implementation notes:
 *
 * - The manual reuses the app's `index.html` bundle — the routing happens
 *   via a URL hash (`#manual`) that `src/main.tsx` checks before mounting.
 *   This avoids a second Vite entry AND sidesteps the Tauri production
 *   limitation where the asset protocol does not fall back to index.html
 *   for unknown paths (BrowserRouter sub-routes would 404 in a packaged
 *   build). A hash always resolves to the same index.html.
 *
 * - `WebviewWindow` is keyed by a stable label (`manual`); if the user
 *   clicks the button again we just focus the existing window instead of
 *   spawning a duplicate.
 *
 * - The label `manual` MUST be covered by a capability in
 *   `src-tauri/capabilities/default.json` (its `windows` array) or the new
 *   window will spawn without permissions and fail to load core APIs.
 */

const MANUAL_LABEL = 'manual';

export async function openUserManual(): Promise<void> {
  // Reuse an already-open manual window (focus + unminimize) instead of
  // opening a second one — Notion/VS Code-style.
  const existing = await WebviewWindow.getByLabel(MANUAL_LABEL);
  if (existing) {
    try {
      await existing.unminimize();
      await existing.setFocus();
    } catch {
      // Focus is best-effort; ignore errors (e.g. already-focused).
    }
    return;
  }

  // Build the URL on the same origin/path as the current window so dev
  // (http://localhost:1420) and the packaged build (tauri://localhost or
  // https://tauri.localhost on Windows) both work without config.
  const url = new URL(window.location.href);
  url.hash = MANUAL_LABEL;

  new WebviewWindow(MANUAL_LABEL, {
    url: url.toString(),
    title: 'Folio · User Manual',
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    minimizable: true,
    maximizable: true,
    center: true,
    // The manual is a secondary window — no drag-drop, keep it simple.
    dragDropEnabled: false,
  });
}
