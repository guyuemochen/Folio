import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../../lib/invoke';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  DatabaseRow,
  DatabaseTemplate,
  FilterNode,
  GroupConfig,
  LocalViewConfig,
  PropertyDef,
  SelectOption,
  SortEntry,
  ViewConfig,
} from '../../lib/types';
import { PropertyCell } from './PropertyCells';
import { PropertyMenu } from './PropertyMenu';
import { FilterBar } from './FilterBar';
import { FilterEditor } from './FilterEditor';
import { applyFilter, normalizeFilter } from './filterEngine';

/**
 * Table view for a database page (PRD §5.3.3–§5.3.7).
 *
 * Loads schema + rows + templates via TanStack Query, renders the table with:
 *   - column drag-to-resize (persisted to view.column_widths)
 *   - column header menu (rename / edit / sort / filter / hide / duplicate / delete)
 *   - filter bar + recursive filter editor (persisted to view.filter)
 *   - multi-level sort (column click cycles asc/desc/clear; persisted to view.sort)
 *   - grouping by select/multi_select/status (collapsible, drag across groups)
 *   - row Shift/Ctrl+click multi-select + right-click menu (delete/duplicate/export csv)
 *   - "+ New" with template picker (§5.3.7)
 *
 * Filter/sort/group evaluation is client-side (rows are <10k in MVP).
 *
 * Two persistence modes:
 *   - **Persisted** (default): config is read from / written to the active
 *     `database_view` row via `update_view`. Used when the DatabaseView is
 *     the main view of a database page.
 *   - **Embedded**: config is supplied by the caller via `embeddedView` and
 *     changes are reported back through `onEmbeddedViewChange`. No
 *     `update_view` calls are made — the caller owns persistence (e.g. a
 *     linked-database block stores the config in the page document).
 *
 * `linked` renders a "🔗 linked" badge for linked-database blocks (§5.3.8).
 */
interface DatabaseViewProps {
  databaseId: string;
  linked?: boolean;
  /** Persisted mode: id of the saved view to read/write. */
  viewId?: string;
  /** Embedded mode: caller-supplied local view config. */
  embeddedView?: LocalViewConfig | null;
  /** Embedded mode: callback whenever the local view config changes. */
  onEmbeddedViewChange?: (next: LocalViewConfig) => void;
}

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 80;
const COL_GROUPABLE: PropertyDef['type'][] = ['select', 'multi_select', 'status'];
/**
 * M6 perf: estimated row height for TanStack Virtual. Matches PRD §5.3.3
 * (min body row height = 40px). Virtualization keeps 1000+ row tables
 * smooth (PRD §10.1: render < 500ms).
 */
const ROW_HEIGHT = 40;

export function DatabaseView({
  databaseId,
  linked,
  viewId,
  embeddedView,
  onEmbeddedViewChange,
}: DatabaseViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const loadChildren = useWorkspaceStore((s) => s.loadChildren);
  const removePageLocally = useWorkspaceStore((s) => s.removePageLocally);

  const { data: schema, refetch: refetchSchema } = useQuery({
    queryKey: ['database', databaseId],
    queryFn: () => api.getDatabase(databaseId),
  });

  const { data: rows, refetch: refetchRows } = useQuery({
    queryKey: ['database-rows', databaseId],
    queryFn: () => api.queryDatabase(databaseId),
  });

  const { data: templates } = useQuery({
    queryKey: ['database-templates', databaseId],
    queryFn: () => api.listTemplates(databaseId),
  });

  const isEmbedded = embeddedView !== undefined;

  // --- Active view + persisted config --------------------------------------
  // In embedded mode, build a synthetic ViewConfig from the caller-supplied
  // LocalViewConfig so downstream code (which expects a ViewConfig-shaped
  // object) keeps working. The id/name are placeholders; persistence goes
  // through onEmbeddedViewChange instead of api.updateView.
  const activeView: ViewConfig | undefined = useMemo(() => {
    if (isEmbedded) {
      return {
        id: '__embedded__',
        databaseId,
        name: '',
        type: 'table',
        filter: embeddedView?.filter ?? null,
        sort: embeddedView?.sort ?? null,
        group: embeddedView?.group ?? null,
        hiddenProperties: embeddedView?.hiddenProperties ?? null,
        columnWidths: embeddedView?.columnWidths ?? null,
        manualOrder: embeddedView?.manualOrder ?? null,
        isDefault: false,
        createdAt: 0,
      };
    }
    if (!schema) return undefined;
    if (viewId) return schema.views.find((v) => v.id === viewId);
    return schema.views.find((v) => v.isDefault) ?? schema.views[0];
  }, [schema, viewId, isEmbedded, embeddedView, databaseId]);

  const [filter, setFilter] = useState<FilterNode | null>(null);
  const [sorts, setSorts] = useState<SortEntry[]>([]);
  const [group, setGroup] = useState<GroupConfig | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  // --- Manual row drag-reorder state ---------------------------------------
  // `dragRowId` tracks the row whose handle is being dragged (ref so the
  // dragstart/drop handlers read the latest value without re-rendering).
  // `dragOverId` drives the drop indicator on the row currently hovered.
  const dragRowId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Hydrate local config when the active view changes.
  useEffect(() => {
    if (!activeView) return;
    setFilter(normalizeFilter(activeView.filter));
    setSorts(activeView.sort ?? []);
    setGroup(activeView.group ?? null);
    setHidden(activeView.hiddenProperties ?? []);
    setWidths(activeView.columnWidths ?? {});
    setManualOrder(activeView.manualOrder ?? null);
    setCollapsedGroups(new Set(activeView.group?.collapsedGroups ?? []));
  }, [activeView?.id, embeddedView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced view persistence.
  const persistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest patch + viewId that has not yet been flushed to the backend.
  // Captured so the unmount cleanup can fire a final api.updateView instead
  // of silently discarding the 250ms debounce timer.
  const pendingPersistRef = useRef<{ viewId: string; databaseId: string; patch: Partial<ViewConfig> } | null>(null);
  // M6 perf: scroll container ref shared with the body virtualizer.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  // In embedded mode collapsed-groups are persisted via onEmbeddedViewChange
  // too — keep a ref so the persistView closure can read the latest array.
  const collapsedGroupsArrayRef = useRef<string[]>([]);
  useEffect(() => {
    collapsedGroupsArrayRef.current = [...collapsedGroups];
  }, [collapsedGroups]);
  const persistView = (patch: Partial<ViewConfig>) => {
    if (!activeView) return;
    // Embedded mode: report the change to the caller — do not call api.updateView.
    if (isEmbedded) {
      if (!onEmbeddedViewChange) return;
      const next: LocalViewConfig = {
        filter: ('filter' in patch ? patch.filter : activeView.filter) ?? null,
        sort: ('sort' in patch ? patch.sort : activeView.sort) ?? null,
        group: ('group' in patch ? patch.group : activeView.group) ?? null,
        hiddenProperties: ('hiddenProperties' in patch ? patch.hiddenProperties : activeView.hiddenProperties) ?? [],
        columnWidths: ('columnWidths' in patch ? patch.columnWidths : activeView.columnWidths) ?? {},
        manualOrder: ('manualOrder' in patch ? patch.manualOrder : activeView.manualOrder) ?? null,
      };
      // collapsedGroups live inside `group` — preserve them when patch updates group.
      if ('group' in patch && patch.group) {
        next.group = { ...patch.group, collapsedGroups: patch.group.collapsedGroups ?? collapsedGroupsArrayRef.current };
      }
      onEmbeddedViewChange(next);
      return;
    }
    if (persistRef.current) clearTimeout(persistRef.current);
    pendingPersistRef.current = { viewId: activeView.id, databaseId, patch };
    persistRef.current = setTimeout(() => {
      pendingPersistRef.current = null;
      api.updateView(activeView.id, patch).then(() => {
        // Invalidate the schema cache so a remount (navigate away + back)
        // reads the updated view config from the backend instead of stale
        // cached data.
        void queryClient.invalidateQueries({ queryKey: ['database', databaseId] });
      }).catch((e) =>
        console.error('[Folio] view persist failed', e),
      );
    }, 250);
  };
  // Flush unsaved view changes on unmount. Without this, the 250ms debounce
  // timer is discarded and the last filter/sort/group/column change is lost
  // when the user navigates to another page.
  useEffect(() => {
    return () => {
      if (persistRef.current) {
        clearTimeout(persistRef.current);
        persistRef.current = null;
      }
      const pending = pendingPersistRef.current;
      if (pending) {
        // Fire-and-forget: the component is unmounting, we cannot await.
        api.updateView(pending.viewId, pending.patch).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['database', pending.databaseId] });
        }).catch((e) =>
          console.error('[Folio] view persist flush on unmount failed', e),
        );
      }
    };
  }, []);

  // --- Column menu state ---------------------------------------------------
  const [menuOpenFor, setMenuOpenFor] = useState<
    | { col: string; anchorRect: DOMRect }
    | { new: true; anchorRect: DOMRect }
    | null
  >(null);

  // --- Selection state -----------------------------------------------------
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);

  // --- Derived data (MUST be computed before any early return so the hook
  //     order stays stable across renders — React Rules of Hooks) ----------
  const allProps = schema?.properties ?? [];
  const visibleProps = allProps.filter((p) => !hidden.includes(p.id));
  const groupProp = group ? allProps.find((p) => p.id === group.propertyId) : undefined;

  const filteredRows = useMemo(() => applyFilter(rows ?? [], filter), [rows, filter]);
  // Display order precedence: explicit property sorts win; otherwise the
  // manual drag order; otherwise the raw query order (created_at). Drag-
  // to-reorder is only enabled when no sort is active, so the two never
  // compete for the same rows.
  const displayedRows = useMemo(() => {
    if (sorts.length > 0) return applySorts(filteredRows, sorts);
    if (manualOrder && manualOrder.length > 0) return applyManualOrder(filteredRows, manualOrder);
    return filteredRows;
  }, [filteredRows, sorts, manualOrder]);
  const groupedRows = useMemo(
    () => (groupProp ? groupBy(displayedRows, groupProp) : []),
    [displayedRows, groupProp],
  );

  if (!schema) {
    return <div className="py-12 text-center text-text-tertiary">{t('database.loading')}</div>;
  }

  // --- Handlers ------------------------------------------------------------
  const handleCellChange = async (row: DatabaseRow, prop: PropertyDef, value: unknown) => {
    try {
      await api.updateCell({ pageId: row.id, propertyId: prop.id, value });
      refetchRows();
    } catch (err) {
      console.error('[Folio] cell update failed', err);
    }
  };

  const handleAddRowBlank = async () => {
    await api.addDatabaseRow(databaseId);
    setNewMenuOpen(false);
    refetchRows();
    // Refresh sidebar's childrenCache for this database so the new row
    // appears in the page tree without a manual refresh.
    void loadChildren(databaseId);
  };

  const handleAddRowFromTemplate = async (tpl: DatabaseTemplate) => {
    await api.addDatabaseRowFromTemplate(databaseId, tpl.id);
    setNewMenuOpen(false);
    refetchRows();
    void loadChildren(databaseId);
  };

  const handleAddProperty = async (input: {
    name: string;
    type: PropertyDef['type'];
    options?: PropertyDef['options'];
    numberFormat?: string;
  }) => {
    await api.addProperty({
      databaseId,
      name: input.name,
      type: input.type,
      options: input.options,
      numberFormat: input.numberFormat,
    });
    setMenuOpenFor(null);
    refetchSchema();
  };

  const handleEditProperty = async (
    propId: string,
    input: {
      name: string;
      type: PropertyDef['type'];
      options?: PropertyDef['options'];
      numberFormat?: string;
    },
  ) => {
    await api.updateProperty(propId, {
      name: input.name,
      options: input.options,
      numberFormat: input.numberFormat,
    }).catch(() => {});
    // updateProperty needs the property id — re-fetch via schema; the menu passes prop.
    setMenuOpenFor(null);
    refetchSchema();
  };

  const handleDeleteProperty = async (propId: string) => {
    if (!confirm(t('database.deletePropertyConfirm'))) return;
    await api.deleteProperty(propId);
    setMenuOpenFor(null);
    refetchSchema();
    refetchRows();
  };

  const handleDuplicateProperty = async (propId: string) => {
    await api.duplicateProperty(propId);
    setMenuOpenFor(null);
    refetchSchema();
  };

  const toggleHide = (propId: string) => {
    const next = hidden.includes(propId) ? hidden.filter((x) => x !== propId) : [...hidden, propId];
    setHidden(next);
    persistView({ hiddenProperties: next });
    setMenuOpenFor(null);
  };

  const cycleSort = (propId: string) => {
    const idx = sorts.findIndex((s) => s.propertyId === propId);
    let next: SortEntry[];
    if (idx === -1) next = [...sorts, { propertyId: propId, direction: 'asc' }];
    else if (sorts[idx]!.direction === 'asc')
      next = sorts.map((s) => (s.propertyId === propId ? { ...s, direction: 'desc' as const } : s));
    else next = sorts.filter((s) => s.propertyId !== propId);
    setSorts(next);
    persistView({ sort: next });
  };

  const openFilterForColumn = (propId: string) => {
    // Open editor; the user can add a leaf for this column inside.
    void propId;
    setMenuOpenFor(null);
    setFilterEditorOpen(true);
  };

  const handleRemoveFilterLeaf = (leafId: string) => {
    if (!filter) return;
    const next = removeLeaf(filter, leafId);
    setFilter(next);
    persistView({ filter: next });
  };

  const handleFilterChange = (next: FilterNode | null) => {
    setFilter(next);
    persistView({ filter: next });
  };

  // --- Selection handlers --------------------------------------------------
  const onRowClick = (e: React.MouseEvent, rowId: string) => {
    if (e.shiftKey && lastSelectedId) {
      const ids = displayedRows.map((r) => r.id);
      const a = ids.indexOf(lastSelectedId);
      const b = ids.indexOf(rowId);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedRowIds(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      });
    } else {
      setSelectedRowIds(new Set([rowId]));
    }
    setLastSelectedId(rowId);
  };

  const onRowContextMenu = (e: React.MouseEvent, rowId: string) => {
    e.preventDefault();
    if (!selectedRowIds.has(rowId)) {
      setSelectedRowIds(new Set([rowId]));
      setLastSelectedId(rowId);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, rowId });
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedRowIds];
    setContextMenu(null);
    await Promise.all(ids.map((id) => api.deleteDatabaseRow(id)));
    // Sync sidebar: remove each deleted page from the page tree, otherwise
    // the sidebar keeps showing ghost rows that 404 on click.
    ids.forEach((id) => removePageLocally(id));
    setSelectedRowIds(new Set());
    refetchRows();
  };

  const handleDuplicateRow = async (rowId: string) => {
    setContextMenu(null);
    await api.duplicateDatabaseRow(rowId);
    // Sync sidebar so the new page appears in the page tree.
    void loadChildren(databaseId);
    refetchRows();
  };

  const handleExportCsv = async () => {
    setContextMenu(null);
    try {
      const csv = await api.exportDatabaseCsv(databaseId);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${schema.title || 'database'}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Folio] csv export failed', err);
    }
  };

  // --- Manual row drag-reorder --------------------------------------------
  // Dragging rows by their handle is only meaningful when the order isn't
  // being dictated by an explicit property sort. When a sort is active the
  // handle is hidden (the sort arrows in the header explain why).
  const dragEnabled = sorts.length === 0;

  const handleRowDragStart = (rowId: string, e: React.DragEvent) => {
    dragRowId.current = rowId;
    e.dataTransfer.effectAllowed = 'move';
    // Stash the id in the transfer so drop targets can recognise this as a
    // row drag even if the dragRowId ref is briefly stale (also makes the
    // drag "real" for browsers that cancel drags with no payload).
    e.dataTransfer.setData('application/x-folio-db-row', rowId);
  };

  const handleRowDragOver = (e: React.DragEvent, rowId: string) => {
    // Only rows act as drop targets for our own row drags. Checking the MIME
    // type (written in dragstart) is robust regardless of the ref state, so
    // the browser always shows a "move" cursor instead of the forbidden one.
    if (!e.dataTransfer.types.includes('application/x-folio-db-row')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragRowId.current !== rowId) setDragOverId(rowId);
  };

  const handleRowDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    // Stop the event bubbling to the group <section>'s onDrop, otherwise a
    // row-on-row drop would also trigger a cross-group move.
    e.stopPropagation();
    const src = dragRowId.current;
    dragRowId.current = null;
    setDragOverId(null);
    if (!src || src === targetId) return;
    // In grouped mode, row-on-row drop only reorders within the same group.
    // Cross-group moves go through the group-section drop (which changes the
    // row's group property) — otherwise groupBy would re-bucket by property
    // and the reorder would land in a confusing spot.
    if (groupProp) {
      const srcRow = filteredRows.find((r) => r.id === src);
      const tgtRow = filteredRows.find((r) => r.id === targetId);
      if (srcRow && tgtRow && rowGroupKey(srcRow, groupProp) !== rowGroupKey(tgtRow, groupProp)) return;
    }
    // Reorder off the currently displayed flat order so the result is
    // correct in both flat and grouped modes (manualOrder is global; the
    // per-group order falls out of groupBy preserving input order).
    const ids = displayedRows.map((r) => r.id);
    const from = ids.indexOf(src);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, src);
    // Prune ids that are no longer live (deleted / filtered out) so the
    // persisted array doesn't accumulate stale entries.
    const live = new Set(filteredRows.map((r) => r.id));
    const next = ids.filter((id) => live.has(id));
    setManualOrder(next);
    persistView({ manualOrder: next });
  };

  const handleRowDragEnd = () => {
    dragRowId.current = null;
    setDragOverId(null);
  };

  // --- Drag across groups --------------------------------------------------
  const handleDropOnGroup = async (groupValue: string) => {
    if (!groupProp) return;
    // Prefer the row being dragged by its handle; fall back to the current
    // multi-selection so the pre-existing select-then-drop flow still works.
    const rowIds = dragRowId.current ? [dragRowId.current] : [...selectedRowIds];
    if (rowIds.length === 0) return;
    await Promise.all(
      rowIds.map((id) => {
        const value =
          groupProp.type === 'multi_select'
            ? toggleMultiSelectValue(rows?.find((r) => r.id === id)?.properties[groupProp.id], groupValue)
            : groupValue;
        return api.updateCell({ pageId: id, propertyId: groupProp.id, value });
      }),
    );
    dragRowId.current = null;
    setDragOverId(null);
    refetchRows();
  };

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistView({
        group: { propertyId: group!.propertyId, collapsedGroups: [...next] },
      });
      return next;
    });
  };

  const setGroupProperty = (propId: string | null) => {
    const next = propId ? { propertyId: propId, collapsedGroups: [...collapsedGroups] } : null;
    setGroup(next);
    persistView({ group: next });
    setGroupMenuOpen(false);
  };

  // Bundled drag-reorder handlers passed down to FlatBody / GroupedTables /
  // RowLine so the call sites stay compact.
  const drag: RowDragProps = {
    enabled: dragEnabled,
    overId: dragOverId,
    onStart: handleRowDragStart,
    onOver: handleRowDragOver,
    onDrop: handleRowDrop,
    onEnd: handleRowDragEnd,
  };

  // ========================================================================
  // Render
  // ========================================================================
  return (
    <div className="border border-border-hairline rounded-md overflow-hidden bg-bg-page">
      {/* View tabs / actions bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-hairline">
        {linked && (
          <span className="inline-flex items-center gap-1 text-[11px] text-accent bg-bg-active px-1.5 py-0.5 rounded">
            {t('database.linked')}
          </span>
        )}
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-text-primary">
            {activeView?.name ?? t('database.table')}
          </span>
        </div>
        <span className="text-[11px] text-text-tertiary">
          {t('database.rowCount', { count: displayedRows.length })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Sort/group/filter quick buttons */}
          <button
            type="button"
            onClick={() => setFilterEditorOpen(true)}
            className="px-2 py-1 text-[12px] rounded text-text-secondary hover:bg-bg-hover transition-colors"
            title={t('database.filter')}
          >
            ▽ {t('database.filter')}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setGroupMenuOpen((v) => !v)}
              className="px-2 py-1 text-[12px] rounded text-text-secondary hover:bg-bg-hover transition-colors"
              title={t('database.group')}
            >
              {group ? `◐ ${t('database.groupActive')}` : `◐ ${t('database.group')}`}
            </button>
            {groupMenuOpen && (
              <GroupMenu
                properties={allProps}
                currentId={group?.propertyId ?? null}
                onPick={setGroupProperty}
                onClose={() => setGroupMenuOpen(false)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-2 py-1 text-[12px] rounded text-text-secondary hover:bg-bg-hover transition-colors"
            title={t('database.exportCsv')}
          >
            ⤓ CSV
          </button>
          {/* + New with template picker */}
          <div className="relative">
            <button
              type="button"
              onClick={handleAddRowBlank}
              className="px-2.5 py-1 text-[12px] rounded bg-bg-hover text-text-primary hover:bg-bg-active transition-colors"
            >
              {t('database.newRow')}
            </button>
            {(templates?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setNewMenuOpen((v) => !v)}
                className="ml-0.5 px-1.5 py-1 text-[12px] rounded bg-bg-hover text-text-primary hover:bg-bg-active transition-colors"
                title={t('database.newFromTemplate')}
              >
                ▾
              </button>
            )}
            {newMenuOpen && templates && (
              <NewRowMenu
                templates={templates}
                onBlank={handleAddRowBlank}
                onPick={handleAddRowFromTemplate}
                onClose={() => setNewMenuOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Hidden columns indicator */}
      {hidden.length > 0 && (
        <div className="px-3 py-1 text-[11px] text-text-tertiary border-b border-border-hairline bg-bg-section/50">
          {t('database.hiddenColumns', {
            hidden: hidden.length,
            names: hidden
              .map((id) => allProps.find((p) => p.id === id)?.name ?? id)
              .join(', '),
          })}
          <button
            type="button"
            onClick={() => { setHidden([]); persistView({ hiddenProperties: [] }); }}
            className="ml-2 text-accent hover:underline"
          >
            {t('database.showAll')}
          </button>
        </div>
      )}

      {/* Filter bar */}
      <FilterBar
        filter={filter}
        properties={allProps}
        onOpenEditor={() => setFilterEditorOpen(true)}
        onRemoveLeaf={handleRemoveFilterLeaf}
      />

      {/* Table */}
      {/* M6 perf: bounded vertical scroll so TanStack Virtual can window the
          body rows (PRD §10.1: 1000 rows render < 500ms). Horizontal scroll
          still works via `overflow-auto`. */}
      <div ref={tableScrollRef} className="overflow-auto max-h-[70vh] border-b border-border-hairline">
        {groupProp ? (
          // Feishu-style grouped view: each group is an INDEPENDENT table
          // (its own column header row) wrapped in a bordered card, stacked
          // vertically. Column widths stay aligned across groups because
          // every table shares the same `widths` map and uses table-fixed.
          <GroupedTables
            groups={groupedRows}
            groupProp={groupProp}
            visibleProps={visibleProps}
            widths={widths}
            sorts={sorts}
            menuOpenFor={menuOpenFor}
            setMenuOpenFor={setMenuOpenFor}
            setWidths={setWidths}
            persistView={persistView}
            cycleSort={cycleSort}
            handleEditProperty={handleEditProperty}
            handleDeleteProperty={handleDeleteProperty}
            handleDuplicateProperty={handleDuplicateProperty}
            handleAddProperty={handleAddProperty}
            openFilterForColumn={openFilterForColumn}
            toggleHide={toggleHide}
            startResize={startResize}
            collapsedGroups={collapsedGroups}
            selectedRowIds={selectedRowIds}
            onToggleCollapse={toggleGroupCollapse}
            onRowClick={onRowClick}
            onRowContextMenu={onRowContextMenu}
            onCellChange={handleCellChange}
            onOpenRow={setCurrentPage}
            databaseId={databaseId}
            onDropOnGroup={handleDropOnGroup}
            onAfterCellCommit={refetchRows}
            drag={drag}
          />
        ) : (
          <table aria-label={schema.title || t('database.table')} className="w-full border-collapse text-[13px] table-fixed">
            <TableHeaderRow
              visibleProps={visibleProps}
              widths={widths}
              sorts={sorts}
              menuOpenFor={menuOpenFor}
              setMenuOpenFor={setMenuOpenFor}
              setWidths={setWidths}
              persistView={persistView}
              cycleSort={cycleSort}
              handleEditProperty={handleEditProperty}
              handleDeleteProperty={handleDeleteProperty}
              handleDuplicateProperty={handleDuplicateProperty}
              handleAddProperty={handleAddProperty}
              openFilterForColumn={openFilterForColumn}
              toggleHide={toggleHide}
              startResize={startResize}
            />
            <tbody>
              <FlatBody
                rows={displayedRows}
                visibleProps={visibleProps}
                selectedRowIds={selectedRowIds}
                onRowClick={onRowClick}
                onRowContextMenu={onRowContextMenu}
                onCellChange={handleCellChange}
                onOpenRow={setCurrentPage}
                databaseId={databaseId}
                onAfterCellCommit={refetchRows}
                scrollRef={tableScrollRef}
                drag={drag}
              />
            </tbody>
          </table>
        )}
      </div>

      {/* Filter editor modal */}
      {filterEditorOpen && (
        <FilterEditor
          filter={filter}
          properties={allProps}
          onClose={() => setFilterEditorOpen(false)}
          onChange={handleFilterChange}
        />
      )}

      {/* Row right-click menu */}
      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          count={selectedRowIds.size}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteSelected}
          onDuplicate={() => contextMenu.rowId && handleDuplicateRow(contextMenu.rowId)}
          onExportCsv={handleExportCsv}
        />
      )}
    </div>
  );
}

// =============================================================================
// Header row (shared by the flat table and every per-group table)
// =============================================================================

interface HeaderProps {
  visibleProps: PropertyDef[];
  widths: Record<string, number>;
  sorts: SortEntry[];
  menuOpenFor:
    | { col: string; anchorRect: DOMRect }
    | { new: true; anchorRect: DOMRect }
    | null;
  setMenuOpenFor: (
    v:
      | { col: string; anchorRect: DOMRect }
      | { new: true; anchorRect: DOMRect }
      | null,
  ) => void;
  setWidths: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
  persistView: (patch: Partial<ViewConfig>) => void;
  cycleSort: (propId: string) => void;
  handleEditProperty: (
    propId: string,
    input: {
      name: string;
      type: PropertyDef['type'];
      options?: PropertyDef['options'];
      numberFormat?: string;
    },
  ) => void;
  handleDeleteProperty: (propId: string) => void;
  handleDuplicateProperty: (propId: string) => void;
  handleAddProperty: (input: {
    name: string;
    type: PropertyDef['type'];
    options?: PropertyDef['options'];
    numberFormat?: string;
  }) => void;
  openFilterForColumn: (propId: string) => void;
  toggleHide: (propId: string) => void;
  startResize: (
    e: React.MouseEvent,
    propId: string,
    startW: number,
    setWidths: (
      updater: (prev: Record<string, number>) => Record<string, number>,
    ) => void,
    onDone: (next: Record<string, number>) => void,
    maxWidth?: number,
  ) => void;
}

/**
 * The column header row. Extracted from the original inline `<thead>` so it
 * can be reused by both the flat table and each Feishu-style per-group
 * table. Renders `<thead><tr>...</tr></thead>` so the parent just wraps it
 * in a `<table>`. Markup is identical to the original inline version.
 */
function TableHeaderRow({
  visibleProps,
  widths,
  sorts,
  menuOpenFor,
  setMenuOpenFor,
  setWidths,
  persistView,
  cycleSort,
  handleEditProperty,
  handleDeleteProperty,
  handleDuplicateProperty,
  handleAddProperty,
  openFilterForColumn,
  toggleHide,
  startResize,
}: HeaderProps) {
  const { t } = useTranslation();
  return (
    <thead>
      <tr className="bg-bg-section border-b border-border-hairline">
        {/* Spacer header for the drag-handle column (matches RowLine's
            leading w-7 cell). aria-hidden so screen readers skip it. */}
        <th className="w-7 border-b border-border-hairline" aria-hidden />
        {visibleProps.map((prop) => {
          const w = widths[prop.id] ?? DEFAULT_COL_WIDTH;
          const sort = sorts.find((s) => s.propertyId === prop.id);
          return (
            <th
              key={prop.id}
              scope="col"
              aria-sort={sort ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              style={{ width: w, minWidth: MIN_COL_WIDTH }}
              className="relative text-left text-xs font-medium text-text-secondary px-3 py-2 cursor-pointer hover:bg-bg-hover border-b border-border-hairline group"
              onClick={(e) =>
                setMenuOpenFor({
                  col: prop.id,
                  anchorRect: e.currentTarget.getBoundingClientRect(),
                })
              }
            >
              <div className="flex items-center gap-1.5 pr-2">
                <TypeIcon type={prop.type} />
                <span className="truncate">{prop.name}</span>
                {sort && (
                  <span className="text-text-tertiary">
                    {sort.direction === 'asc' ? '↑' : '↓'}
                    {sorts.length > 1 ? ` ${sorts.indexOf(sort) + 1}` : ''}
                  </span>
                )}
              </div>
              {/* Resize handle */}
              <div
                className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-accent/40"
                onMouseDown={(e) => {
                  // Cap the column width so it can't exceed the visible table
                  // area, leaving at least 48px for the "+" add-column column
                  // and respecting other columns' current widths.
                  const scrollContainer = e.currentTarget.closest('.overflow-auto') as HTMLElement | null;
                  const containerW = scrollContainer?.clientWidth ?? 0;
                  const otherColsW = visibleProps
                    .filter((p) => p.id !== prop.id)
                    .reduce((sum, p) => sum + (widths[p.id] ?? DEFAULT_COL_WIDTH), 0);
                  const maxW = containerW > 0
                    ? Math.max(MIN_COL_WIDTH, containerW - 48 - otherColsW)
                    : undefined;
                  startResize(e, prop.id, w, setWidths, (next) =>
                    persistView({ columnWidths: next }), maxW);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              {menuOpenFor && 'col' in menuOpenFor && menuOpenFor.col === prop.id && (
                <PropertyMenu
                  anchorRect={menuOpenFor.anchorRect}
                  property={prop}
                  onClose={() => setMenuOpenFor(null)}
                  onSubmit={(input) => handleEditProperty(prop.id, input)}
                  onDelete={() => handleDeleteProperty(prop.id)}
                  onSort={() => { cycleSort(prop.id); setMenuOpenFor(null); }}
                  onFilter={() => openFilterForColumn(prop.id)}
                  onHide={() => toggleHide(prop.id)}
                  onDuplicate={() => handleDuplicateProperty(prop.id)}
                />
              )}
            </th>
          );
        })}
        <th
          className="relative px-2 py-2 border-b border-border-hairline"
        >
          <button
            type="button"
            onClick={(e) =>
              setMenuOpenFor({
                new: true,
                anchorRect: e.currentTarget.getBoundingClientRect(),
              })
            }
            className="text-text-tertiary hover:text-text-primary text-lg leading-none px-2"
            title={t('database.addProperty')}
          >
            +
          </button>
          {menuOpenFor && 'new' in menuOpenFor && (
            <PropertyMenu
              anchorRect={menuOpenFor.anchorRect}
              onClose={() => setMenuOpenFor(null)}
              onSubmit={handleAddProperty}
            />
          )}
        </th>
      </tr>
    </thead>
  );
}

// =============================================================================
// Body renderers
// =============================================================================

interface BodyProps {
  visibleProps: PropertyDef[];
  selectedRowIds: Set<string>;
  onRowClick: (e: React.MouseEvent, rowId: string) => void;
  onRowContextMenu: (e: React.MouseEvent, rowId: string) => void;
  onCellChange: (row: DatabaseRow, prop: PropertyDef, value: unknown) => void;
  onOpenRow: (pageId: string) => void;
  databaseId: string;
  onAfterCellCommit: () => void;
}

/**
 * Bundled drag-to-reorder handlers shared by the flat and grouped bodies.
 * `enabled` is false when a property sort is active (order is sort-driven,
 * so manual reorder is disabled); the handle column still reserves space.
 */
interface RowDragProps {
  enabled: boolean;
  /** Row id currently hovered during a drag (for the drop indicator), or null. */
  overId: string | null;
  onStart: (rowId: string, e: React.DragEvent) => void;
  onOver: (e: React.DragEvent, rowId: string) => void;
  onDrop: (e: React.DragEvent, rowId: string) => void;
  onEnd: () => void;
}

/**
 * M6 perf: FlatBody uses TanStack Virtual with the "padding rows" pattern.
 * Off-screen row ranges collapse into a single `<tr>` spacer with the
 * appropriate height, so the scrollbar reflects the full row count while
 * only visible + overscan rows are actually mounted. Standard table layout
 * is preserved (no display: block/flex rewrite), so column auto-alignment
 * with the header still works (PRD §10.1: 1000 rows < 500ms).
 */
function FlatBody({
  rows,
  visibleProps,
  selectedRowIds,
  onRowClick,
  onRowContextMenu,
  onCellChange,
  onOpenRow,
  databaseId,
  onAfterCellCommit,
  scrollRef,
  drag,
}: BodyProps & {
  rows: DatabaseRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  drag: RowDragProps;
}) {
  const { t } = useTranslation();
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (rows.length === 0) {
    return (
      <tr>
        {/* +2 = drag-handle column + row-action column */}
        <td colSpan={visibleProps.length + 2} className="px-3 py-16 text-center text-[13px] text-text-tertiary">
          {t('database.emptyRows')}
        </td>
      </tr>
    );
  }

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const firstStart = items.length > 0 ? items[0]!.start : 0;
  const lastEnd = items.length > 0 ? items[items.length - 1]!.end : 0;
  const padTop = firstStart;
  const padBottom = Math.max(0, totalSize - lastEnd);
  const colSpan = visibleProps.length + 2;

  return (
    <>
      {padTop > 0 && (
        <tr style={{ height: padTop }} aria-hidden>
          <td colSpan={colSpan} style={{ padding: 0, border: 'none', height: padTop }} />
        </tr>
      )}
      {items.map((vi) => {
        const row = rows[vi.index];
        if (!row) return null;
        return (
          <RowLine
            key={row.id}
            row={row}
            visibleProps={visibleProps}
            selected={selectedRowIds.has(row.id)}
            onRowClick={onRowClick}
            onRowContextMenu={onRowContextMenu}
            onCellChange={onCellChange}
            onOpenRow={onOpenRow}
            databaseId={databaseId}
            onAfterCellCommit={onAfterCellCommit}
            drag={drag}
          />
        );
      })}
      {padBottom > 0 && (
        <tr style={{ height: padBottom }} aria-hidden>
          <td colSpan={colSpan} style={{ padding: 0, border: 'none', height: padBottom }} />
        </tr>
      )}
    </>
  );
}

function GroupedTables({
  groups,
  groupProp,
  visibleProps,
  widths,
  sorts,
  menuOpenFor,
  setMenuOpenFor,
  setWidths,
  persistView,
  cycleSort,
  handleEditProperty,
  handleDeleteProperty,
  handleDuplicateProperty,
  handleAddProperty,
  openFilterForColumn,
  toggleHide,
  startResize,
  collapsedGroups,
  selectedRowIds,
  onToggleCollapse,
  onRowClick,
  onRowContextMenu,
  onCellChange,
  onOpenRow,
  databaseId,
  onDropOnGroup,
  onAfterCellCommit,
  drag,
}: HeaderProps & {
  groups: { key: string; label: string; color: string; rows: DatabaseRow[] }[];
  groupProp: PropertyDef;
  collapsedGroups: Set<string>;
  selectedRowIds: Set<string>;
  onToggleCollapse: (key: string) => void;
  onRowClick: (e: React.MouseEvent, rowId: string) => void;
  onRowContextMenu: (e: React.MouseEvent, rowId: string) => void;
  onCellChange: (row: DatabaseRow, prop: PropertyDef, value: unknown) => void;
  onOpenRow: (pageId: string) => void;
  databaseId: string;
  onDropOnGroup: (groupValue: string) => void;
  onAfterCellCommit: () => void;
  drag: RowDragProps;
}) {
  return (
    <div className="p-3 space-y-3">
      {groups.map((g) => {
        const collapsed = collapsedGroups.has(g.key);
        return (
          <section
            key={g.key}
            className="rounded-md border border-border-hairline bg-bg-page overflow-hidden"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onDropOnGroup(g.key); }}
          >
            {/* Group title bar — NOT inside any table. Indented (pl-4) so it
                clearly sits ABOVE-AND-INDENTED relative to the column header
                row of the per-group table below. */}
            <div className="flex items-center gap-2 pl-4 pr-3 py-1.5 bg-bg-section/60 border-b border-border-hairline">
              <button
                type="button"
                onClick={() => onToggleCollapse(g.key)}
                className="text-xs text-text-tertiary w-4 hover:text-text-secondary"
                aria-label={collapsed ? 'Expand group' : 'Collapse group'}
              >
                {collapsed ? '▸' : '▾'}
              </button>
              <span className={`w-2.5 h-2.5 rounded-full ${dotClass(g.color)}`} />
              <span className="text-[13px] font-semibold text-text-primary tracking-tight">
                {groupProp.name}: {g.label}
              </span>
              <span className="text-[11px] text-text-tertiary">{g.rows.length}</span>
            </div>
            {/* Per-group table — independent column header row + body.
                `table-fixed` guarantees every group's columns align since
                they all read from the same `widths` map (auto-layout would
                drift per-group based on cell content). */}
            {!collapsed && (
              <table className="w-full border-collapse text-[13px] table-fixed">
                <TableHeaderRow
                  visibleProps={visibleProps}
                  widths={widths}
                  sorts={sorts}
                  menuOpenFor={menuOpenFor}
                  setMenuOpenFor={setMenuOpenFor}
                  setWidths={setWidths}
                  persistView={persistView}
                  cycleSort={cycleSort}
                  handleEditProperty={handleEditProperty}
                  handleDeleteProperty={handleDeleteProperty}
                  handleDuplicateProperty={handleDuplicateProperty}
                  handleAddProperty={handleAddProperty}
                  openFilterForColumn={openFilterForColumn}
                  toggleHide={toggleHide}
                  startResize={startResize}
                />
                <tbody>
                  {g.rows.map((row) => (
                    <RowLine
                      key={row.id}
                      row={row}
                      visibleProps={visibleProps}
                      selected={selectedRowIds.has(row.id)}
                      onRowClick={onRowClick}
                      onRowContextMenu={onRowContextMenu}
                      onCellChange={onCellChange}
                      onOpenRow={onOpenRow}
                      databaseId={databaseId}
                      onAfterCellCommit={onAfterCellCommit}
                      groupColor={g.color}
                      drag={drag}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RowLine({
  row,
  visibleProps,
  selected,
  onRowClick,
  onRowContextMenu,
  onCellChange,
  onOpenRow,
  databaseId,
  onAfterCellCommit,
  groupColor,
  drag,
}: Omit<BodyProps, 'selectedRowIds'> & {
  row: DatabaseRow;
  selected: boolean;
  groupColor?: string;
  drag: RowDragProps;
}) {
  const { t } = useTranslation();
  const removePageLocally = useWorkspaceStore((s) => s.removePageLocally);
  const grouped = Boolean(groupColor);
  const isDropTarget = drag.enabled && drag.overId === row.id;
  return (
    <tr
      className={[
        'transition-colors group cursor-default',
        // Flat rows keep their original inter-row separator.
        // Grouped rows drop it so siblings read as one block; the group
        // header's stronger top border carries the between-group separation.
        grouped ? '' : 'border-t border-border-hairline/60',
        selected
          ? 'bg-bg-active'
          : grouped
            ? 'bg-bg-section/25'
            : 'hover:bg-bg-hover/60',
        // Drop indicator: a 2px accent line at the top of the hovered row.
        // Inset box-shadow avoids the layout shift a real border would cause.
        isDropTarget ? '[box-shadow:inset_0_2px_0_var(--color-accent)]' : '',
      ].join(' ')}
      onClick={(e) => onRowClick(e, row.id)}
      onContextMenu={(e) => onRowContextMenu(e, row.id)}
      onDragOver={(e) => drag.onOver(e, row.id)}
      onDrop={(e) => drag.onDrop(e, row.id)}
    >
      {/* Drag handle column. Always present so column count (and thus the
          FlatBody colSpan) stays constant; the handle only renders when
          manual reorder is enabled (no active sort). A <span> (not <button>)
          is used so the element's native drag behaviour isn't intercepted —
          matches the Sidebar favorites drag handle. */}
      <td className="w-7 text-center select-none" onClick={(e) => e.stopPropagation()}>
        {drag.enabled && (
          <span
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => drag.onStart(row.id, e)}
            onDragEnd={drag.onEnd}
            onClick={(e) => e.stopPropagation()}
            className="inline-block opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-secondary px-1 text-xs leading-none transition-opacity"
            title={t('database.dragToReorder')}
            aria-label={t('database.dragToReorder')}
          >
            ⋮⋮
          </span>
        )}
      </td>
      {visibleProps.map((prop, i) => (
        <td
          key={prop.id}
          className="relative px-3 py-1 align-top"
          onClick={(e) => {
            // Title cell is editable in place now — opening the page is done
            // via the dedicated ↗ button at the end of the row. We still
            // stopPropagation on the title cell so clicking into the input
            // to edit doesn't toggle row selection (which fires on the <tr>).
            if (prop.type === 'title') {
              e.stopPropagation();
            }
          }}
        >
          {i === 0 && groupColor && (
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 ${dotClass(groupColor)}`}
            />
          )}
          <PropertyCell
            value={row.properties[prop.id]}
            property={prop}
            pageId={row.id}
            databaseId={databaseId}
            onAfterCommit={onAfterCellCommit}
            onChange={(v) => onCellChange(row, prop, v)}
          />
        </td>
      ))}
      <td className="px-2 text-center whitespace-nowrap">
        {/* Open page — dedicated button so the title cell stays editable
            in place. Hover-revealed alongside the delete button. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenRow(row.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-accent px-1 transition-opacity"
          title={t('database.openRow')}
          aria-label={t('database.openRow')}
        >
          ↗
        </button>
        <button
          type="button"
          aria-label={t('database.deleteRow')}
          onClick={async (e) => {
            e.stopPropagation();
            if (confirm(t('database.deleteRowConfirm'))) {
              await api.deleteDatabaseRow(row.id);
              // Sync sidebar so the deleted page disappears from the tree.
              removePageLocally(row.id);
              onAfterCellCommit();
            }
          }}
          className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-red px-1 transition-opacity"
          title={t('database.deleteRow')}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

// =============================================================================
// Menus & helpers
// =============================================================================

function RowContextMenu({
  x,
  y,
  count,
  onClose,
  onDelete,
  onDuplicate,
  onExportCsv,
}: {
  x: number;
  y: number;
  count: number;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExportCsv: () => void;
}) {
  const { t } = useTranslation();
  const hasMultiple = count > 1;
  return (
    <>
      <div className="fixed inset-0 z-[1050]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        data-popover-root
        className="fixed z-[1051] w-44 rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-sm"
        style={{ left: x, top: y }}
      >
        <ContextItem
          label={hasMultiple ? t('database.deleteSelected', { count }) : t('common.delete')}
          danger
          onClick={onDelete}
        />
        {!hasMultiple && <ContextItem label={t('common.duplicate')} onClick={onDuplicate} />}
        <ContextItem label={t('database.exportCsv')} onClick={onExportCsv} />
      </div>
    </>
  );
}

function ContextItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-bg-hover ${danger ? 'text-status-red' : 'text-text-primary'}`}
    >
      {label}
    </button>
  );
}

function NewRowMenu({
  templates,
  onBlank,
  onPick,
  onClose,
}: {
  templates: DatabaseTemplate[];
  onBlank: () => void;
  onPick: (tpl: DatabaseTemplate) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="fixed inset-0 z-[1050]" onClick={onClose} />
      <div
        data-popover-root
        className="absolute right-0 top-full mt-1 z-[1051] w-56 rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-sm"
      >
        <button
          type="button"
          onClick={onBlank}
          className="w-full text-left px-3 py-1.5 hover:bg-bg-hover flex items-center gap-2"
        >
          <span>📄</span>
          <span>{t('database.blank')}</span>
        </button>
        <div className="my-1 border-t border-border-hairline" />
        <div className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">
          {t('database.templates')}
        </div>
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onPick(tpl)}
            className="w-full text-left px-3 py-1.5 hover:bg-bg-hover flex items-center gap-2"
          >
            <span>{tpl.icon ?? '📝'}</span>
            <span className="flex-1 truncate">{tpl.name}</span>
            {tpl.isDefault && <span className="text-[10px] text-text-tertiary">{t('database.default')}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

function GroupMenu({
  properties,
  currentId,
  onPick,
  onClose,
}: {
  properties: PropertyDef[];
  currentId: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const groupable = properties.filter((p) => COL_GROUPABLE.includes(p.type));
  return (
    <>
      <div className="fixed inset-0 z-[1050]" onClick={onClose} />
      <div
        data-popover-root
        className="absolute right-0 top-full mt-1 z-[1051] w-56 rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-sm"
      >
        <button
          type="button"
          onClick={() => onPick(null)}
          className="w-full text-left px-3 py-1.5 hover:bg-bg-hover"
        >
          {t('database.noGrouping')}
        </button>
        {groupable.length > 0 && <div className="my-1 border-t border-border-hairline" />}
        {groupable.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="w-full text-left px-3 py-1.5 hover:bg-bg-hover flex items-center justify-between"
          >
            <span>{p.name}</span>
            {currentId === p.id && <span className="text-accent">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function TypeIcon({ type }: { type: PropertyDef['type'] }) {
  const map: Partial<Record<PropertyDef['type'], string>> = {
    title: 'T',
    rich_text: 'Aa',
    number: '#',
    select: '◉',
    multi_select: '⌘',
    status: '◐',
    date: '🗓',
    person: '👤',
    checkbox: '☑',
    url: '🔗',
    files: '📎',
  };
  return (
    <span className="inline-block w-3 text-center text-[10px] text-text-tertiary">
      {map[type] ?? '•'}
    </span>
  );
}

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

/**
 * Apply a per-view manual row order (the result of drag-to-reorder). Rows
 * whose id appears in `order` are emitted in that relative sequence; any
 * rows not listed (e.g. newly added since the last reorder, or rows whose
 * id predates a re-parent) keep their incoming relative order, appended
 * after the ordered ones. Ids in `order` that no longer exist are ignored.
 */
function applyManualOrder(rows: DatabaseRow[], order: string[]): DatabaseRow[] {
  if (order.length === 0) return rows;
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  const ordered: DatabaseRow[] = [];
  const rest: DatabaseRow[] = [];
  for (const r of rows) {
    if (rank.has(r.id)) ordered.push(r);
    else rest.push(r);
  }
  ordered.sort((a, b) => (rank.get(a.id)! - rank.get(b.id)!));
  return [...ordered, ...rest];
}

/**
 * Stable per-row group key for the same-group drag guard. Mirrors the
 * bucketing logic in `groupBy`: select/status → the scalar string,
 * multi_select → sorted values joined by a NUL separator (so two rows share
 * a key only when their tag sets match exactly).
 */
function rowGroupKey(row: DatabaseRow, prop: PropertyDef): string {
  const raw = row.properties[prop.id];
  if (prop.type === 'multi_select') {
    const vals: string[] = Array.isArray(raw) ? (raw as string[]) : [];
    return [...vals].sort().join('\u0000');
  }
  return typeof raw === 'string' ? raw : '';
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return String(a).localeCompare(String(b));
}

interface GroupBucket {
  key: string;
  label: string;
  color: string;
  rows: DatabaseRow[];
}

function groupBy(rows: DatabaseRow[], prop: PropertyDef): GroupBucket[] {
  const buckets = new Map<string, GroupBucket>();
  const getOrCreate = (key: string, label: string, color: string) => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, label, color, rows: [] };
      buckets.set(key, b);
    }
    return b;
  };

  const options: SelectOption[] = prop.options ?? [];
  // Pre-seed buckets in option order so groups are stable.
  for (const opt of options) {
    getOrCreate(opt.value, opt.value, opt.color);
  }
  const unfiledKey = '__unfiled__';
  getOrCreate(unfiledKey, 'No value', 'gray');

  for (const row of rows) {
    const raw = row.properties[prop.id];
    if (prop.type === 'multi_select') {
      const vals: string[] = Array.isArray(raw) ? (raw as string[]) : [];
      if (vals.length === 0) {
        getOrCreate(unfiledKey, 'No value', 'gray').rows.push(row);
      } else {
        for (const v of vals) {
          const opt = options.find((o) => o.value === v);
          getOrCreate(v, v, opt?.color ?? 'gray').rows.push(row);
        }
      }
    } else {
      const v = typeof raw === 'string' ? raw : '';
      if (!v) {
        getOrCreate(unfiledKey, 'No value', 'gray').rows.push(row);
      } else {
        const opt = options.find((o) => o.value === v);
        getOrCreate(v, v, opt?.color ?? 'gray').rows.push(row);
      }
    }
  }

  // Drop empty pre-seeded option buckets (keep "No value" only if it has rows).
  return [...buckets.values()].filter((b) => b.rows.length > 0 || b.key === unfiledKey && b.rows.length > 0);
}

function removeLeaf(node: FilterNode, leafId: string): FilterNode | null {
  if (node.kind === 'leaf') {
    return node.id === leafId ? null : node;
  }
  const next = node.children
    .map((c) => removeLeaf(c, leafId))
    .filter((c): c is FilterNode => c !== null);
  if (next.length === 0) return null;
  return { kind: 'group', op: node.op, children: next };
}

function toggleMultiSelectValue(current: unknown, value: string): string[] {
  const arr: string[] = Array.isArray(current) ? (current as string[]) : [];
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function startResize(
  e: React.MouseEvent,
  propId: string,
  startW: number,
  setWidths: (updater: (prev: Record<string, number>) => Record<string, number>) => void,
  onDone: (next: Record<string, number>) => void,
  maxWidth?: number,
) {
  e.preventDefault();
  const startX = e.clientX;
  let nextMap: Record<string, number> = {};
  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    let w = Math.max(MIN_COL_WIDTH, startW + dx);
    if (maxWidth !== undefined) w = Math.min(w, maxWidth);
    setWidths((prev) => {
      nextMap = { ...prev, [propId]: w };
      return nextMap;
    });
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (Object.keys(nextMap).length > 0) onDone(nextMap);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// === Color helpers =========================================================

const COLOR_MAP: Record<string, { dot: string }> = {
  gray: { dot: 'bg-text-tertiary' },
  brown: { dot: 'bg-[#c9b5a8]' },
  orange: { dot: 'bg-[#ffaf80]' },
  yellow: { dot: 'bg-[#ffcc00]' },
  green: { dot: 'bg-[#66d66b]' },
  blue: { dot: 'bg-accent' },
  purple: { dot: 'bg-[#9b7fdb]' },
  pink: { dot: 'bg-[#ff9bd6]' },
  red: { dot: 'bg-status-red' },
};

function dotClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).dot;
}
