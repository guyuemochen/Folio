/**
 * Re-export the plugin protocol types from the SDK package so the host
 * (`src/plugins/*`) imports from a single source of truth.
 *
 * The SDK package (`@folio/plugin-sdk`) owns these types because plugin
 * authors depend on that package; the host re-exports to avoid drift.
 */
export * from '@folio/plugin-sdk/types';
export { FolioPermissionError } from '@folio/plugin-sdk/types';
