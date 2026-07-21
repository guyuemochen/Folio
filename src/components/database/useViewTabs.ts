import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../../lib/invoke';
import type { ViewConfig } from '../../lib/types';

/**
 * View CRUD operations for the multi-tab database feature (Phase 1).
 *
 * Each method calls the corresponding backend command and then invalidates
 * the `['database', databaseId]` query so the schema (which carries the
 * `views[]` array) re-fetches and the ViewTabs UI reflects the new state.
 *
 * Design note: there is intentionally no `setDefaultView` here. The active
 * tab is persisted per-device via localStorage (see `dbActiveView.ts`) rather
 * than by mutating the backend's `is_default` column — that keeps Phase 1 a
 * pure-frontend change and preserves `is_default` semantics as "the view
 * opened on first visit to this database".
 */
export function useViewTabs(databaseId: string) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['database', databaseId] }),
    [queryClient, databaseId],
  );

  const createView = useCallback(
    async (input: { name: string; type: ViewConfig['type'] }): Promise<ViewConfig> => {
      const v = await api.createView({ databaseId, name: input.name, type: input.type });
      await invalidate();
      return v;
    },
    [databaseId, invalidate],
  );

  const renameView = useCallback(
    async (viewId: string, name: string): Promise<void> => {
      await api.updateView(viewId, { name });
      await invalidate();
    },
    [invalidate],
  );

  const deleteView = useCallback(
    async (viewId: string): Promise<void> => {
      await api.deleteView(viewId);
      await invalidate();
    },
    [invalidate],
  );

  /**
   * Duplicate a view: create a new view with the same `type` and a
   * "(copy)" suffix on the name, then copy the source's full config
   * (filter / sort / group / hiddenProperties / columnWidths / manualOrder)
   * into the new one. Two API calls instead of one backend `duplicate_view`
   * command keeps Phase 1 frontend-only.
   */
  const duplicateView = useCallback(
    async (source: ViewConfig): Promise<ViewConfig> => {
      const created = await api.createView({
        databaseId,
        name: `${source.name} (copy)`,
        type: source.type,
      });
      await api.updateView(created.id, {
        filter: source.filter ?? null,
        sort: source.sort ?? null,
        group: source.group ?? null,
        hiddenProperties: source.hiddenProperties ?? [],
        columnWidths: source.columnWidths ?? {},
        manualOrder: source.manualOrder ?? null,
      });
      await invalidate();
      return created;
    },
    [databaseId, invalidate],
  );

  return { createView, renameView, deleteView, duplicateView };
}

/**
 * Pick a sensible default name for a newly created view of the given type.
 * Counts existing views of the same type to produce "Board", "Board 2", …
 * (matching Notion's convention where the first of a kind has no suffix).
 */
export function nextViewName(
  existing: ViewConfig[],
  type: ViewConfig['type'],
  typeLabel: string,
): string {
  const sameTypeCount = existing.filter((v) => v.type === type).length;
  // First view of a type gets the bare label ("Board"); subsequent ones
  // get an incrementing suffix ("Board 2", "Board 3", …).
  return sameTypeCount === 0 ? typeLabel : `${typeLabel} ${sameTypeCount + 1}`;
}
