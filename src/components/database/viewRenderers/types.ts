import type { ComponentType } from 'react';
import type { DatabaseRow, DatabaseWithSchema, PropertyDef, ViewConfig } from '../../../lib/types';

/**
 * Contract every non-table view renderer (board / gallery / calendar / list /
 * timeline) must implement.
 *
 * The DatabaseView component owns the schema + rows + mutators and hands them
 * to whichever renderer matches `view.type`. Renderers are responsible for:
 *   1. Applying `view.filter` and `view.sort` themselves (use the helpers in
 *      `shared.ts` — never reach into DatabaseView's internals).
 *   2. Rendering their own layout (rows / cards / columns / days / etc.).
 *   3. Wiring cell edits, row opens, and new-row triggers back through the
 *      callbacks below — never call `api.*` directly.
 *
 * View-type-specific layout (e.g. which property a board groups by, which
 * date property a calendar uses) is read from `view` itself:
 *   - Board  → `view.group?.propertyId` (an existing field)
 *   - Calendar → first property of type `'date'` on the schema (MVP convention)
 *   - Timeline → first two `'date'` properties on the schema (MVP convention)
 *   - Gallery → first property of type `'files'` / `'url'` as cover (MVP)
 *   - List    → title + first 2-3 visible properties (MVP)
 *
 * Phase 2 keeps things backend-free: no new SQL columns, no new commands.
 * Phase 3 can introduce typed per-view layout config if the conventions
 * above prove too rigid.
 */
export interface ViewRendererProps {
  /** The saved view (filter / sort / group / type-specific layout lives here
   *  or in conventions described above). */
  view: ViewConfig;
  /** Database schema (page metadata + properties + all saved views). */
  schema: DatabaseWithSchema;
  /** All non-trashed rows with their property values; renderers filter/sort
   *  locally so the table view and other views stay decoupled. */
  rows: DatabaseRow[];

  // --- Mutators -----------------------------------------------------------
  /** Commit a cell update (e.g. card title edit, drag-to-change-column on a
   *  board moves the row into a new select value). The parent handles the
   *  backend round-trip and row refetch. */
  onCellChange: (row: DatabaseRow, prop: PropertyDef, value: unknown) => void;
  /** Open a row's full page in the main editor. */
  onOpenRow: (pageId: string) => void;
  /** Add a new blank row to the database. */
  onAddRow: () => void;
}

export type ViewRenderer = ComponentType<ViewRendererProps>;
