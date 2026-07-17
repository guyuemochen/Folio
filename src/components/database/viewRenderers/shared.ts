/**
 * Shared helpers for non-table view renderers (board / gallery / calendar /
 * list / timeline). Centralises filter/sort application and the property-
 * picking conventions documented in `types.ts` so each renderer doesn't
 * reinvent them.
 *
 * These mirror the logic in DatabaseView.tsx (which the table renderer still
 * owns). We deliberately duplicate the pure sort/manual-order helpers here
 * rather than refactor DatabaseView to import them — Phase 2 stays out of
 * DatabaseView's blast radius. If the two ever diverge in behaviour, the
 * table view is the source of truth.
 */
import { useMemo } from 'react';
import type { DatabaseRow, PropertyDef, SortEntry, ViewConfig } from '../../../lib/types';
import { applyFilter, normalizeFilter } from '../filterEngine';

/**
 * Apply the view's filter tree to the rows. `normalizeFilter` backfills
 * `leaf.id` for filters persisted before that field existed.
 */
export function useFilteredRows(rows: DatabaseRow[], view: ViewConfig): DatabaseRow[] {
  return useMemo(
    () => applyFilter(rows, normalizeFilter(view.filter ?? null)),
    [rows, view.filter],
  );
}

/**
 * Apply the view's sort entries to filtered rows. Sort is stable on the
 * original (created_at) order so rows with equal sort keys keep their
 * relative positions.
 */
export function useSortedRows(rows: DatabaseRow[], view: ViewConfig): DatabaseRow[] {
  return useMemo(() => applySorts(rows, view.sort ?? []), [rows, view.sort]);
}

/**
 * Convenience: filter → sort in one shot. Most renderers want both.
 */
export function useVisibleRows(rows: DatabaseRow[], view: ViewConfig): DatabaseRow[] {
  const filtered = useFilteredRows(rows, view);
  return useSortedRows(filtered, view);
}

// ---------------------------------------------------------------------------
// Property-picking conventions (MVP — no per-view layout config in Phase 2)
// ---------------------------------------------------------------------------

/** First property of a given type on the schema (excludes the title prop,
 *  which is type `'title'` not `'text'`). Returns `null` when none exists. */
export function pickFirstPropertyByType(
  schema: { properties: PropertyDef[] },
  type: PropertyDef['type'],
): PropertyDef | null {
  return schema.properties.find((p) => p.type === type) ?? null;
}

/** All properties of a given type, in declared order. Used by timeline
 *  (needs start + end) and any renderer offering "group by date" options. */
export function pickPropertiesByType(
  schema: { properties: PropertyDef[] },
  type: PropertyDef['type'],
): PropertyDef[] {
  return schema.properties.filter((p) => p.type === type);
}

// ---------------------------------------------------------------------------
// Pure sort helpers (duplicated from DatabaseView to keep renderers decoupled)
// ---------------------------------------------------------------------------

function applySorts(rows: DatabaseRow[], sorts: SortEntry[]): DatabaseRow[] {
  if (sorts.length === 0) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const s of sorts) {
      const cmp = compareValues(a.properties[s.propertyId], b.properties[s.propertyId]);
      if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls sort last regardless of direction
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}
