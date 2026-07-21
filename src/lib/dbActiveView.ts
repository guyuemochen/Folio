/**
 * Per-database "last active view" memory, persisted to localStorage.
 *
 * Why localStorage (not a backend column):
 * - We deliberately keep `is_default` semantics meaning "the view opened on
 *   first visit to this database" rather than "the most recently opened view".
 * - "Last viewed" is a per-device preference (Notion mirrors the same
 *   behaviour): reopening the same db on a different machine should land on
 *   the default, not whatever you happened to click last on another device.
 *
 * Key shape: `folio:db-active-view:<databaseId>` → viewId string.
 * Failures (private mode, quota, etc.) degrade silently to "no preference",
 * which the caller falls back from to the default view.
 */

const PREFIX = 'folio:db-active-view:';

export function getActiveViewId(databaseId: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + databaseId);
  } catch {
    // localStorage may throw in private mode or when disabled — treat as miss.
    return null;
  }
}

export function setActiveViewId(databaseId: string, viewId: string): void {
  try {
    window.localStorage.setItem(PREFIX + databaseId, viewId);
  } catch {
    // Best-effort; ignoring is safe — next load just falls back to default.
  }
}

export function clearActiveViewId(databaseId: string): void {
  try {
    window.localStorage.removeItem(PREFIX + databaseId);
  } catch {
    // Same rationale as setActiveViewId.
  }
}
