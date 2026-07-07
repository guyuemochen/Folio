import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../../lib/invoke';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  DatabaseRow,
  DatabaseTemplate,
  FilterNode,
  GroupConfig,
  PropertyDef,
  SelectOption,
  SortEntry,
  ViewConfig,
} from '../../lib/types';
import { PropertyCell } from './PropertyCells';
import { PropertyMenu } from './PropertyMenu';
import { FilterBar } from './FilterBar';
import { FilterEditor } from './FilterEditor';
import { applyFilter } from './filterEngine';

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
 * Config is persisted to the active database_view row via update_view.
 *
 * `linked` renders a "🔗 linked" badge for linked-database blocks (§5.3.8).
 * `viewId` selects which view config to read/write (defaults to the default view).
 */
interface DatabaseViewProps {
  databaseId: string;
  linked?: boolean;
  viewId?: string;
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

export function DatabaseView({ databaseId, linked, viewId }: DatabaseViewProps) {
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);

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

  // --- Active view + persisted config --------------------------------------
  const activeView: ViewConfig | undefined = useMemo(() => {
    if (!schema) return undefined;
    if (viewId) return schema.views.find((v) => v.id === viewId);
    return schema.views.find((v) => v.isDefault) ?? schema.views[0];
  }, [schema, viewId]);

  const [filter, setFilter] = useState<FilterNode | null>(null);
  const [sorts, setSorts] = useState<SortEntry[]>([]);
  const [group, setGroup] = useState<GroupConfig | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);

  // Hydrate local config when the active view changes.
  useEffect(() => {
    if (!activeView) return;
    setFilter(activeView.filter ?? null);
    setSorts(activeView.sort ?? []);
    setGroup(activeView.group ?? null);
    setHidden(activeView.hiddenProperties ?? []);
    setWidths(activeView.columnWidths ?? {});
    setCollapsedGroups(new Set(activeView.group?.collapsedGroups ?? []));
  }, [activeView?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced view persistence.
  const persistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // M6 perf: scroll container ref shared with the body virtualizer.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const persistView = (patch: Partial<ViewConfig>) => {
    if (!activeView) return;
    if (persistRef.current) clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => {
      api.updateView(activeView.id, patch).catch((e) =>
        console.error('[Folio] view persist failed', e),
      );
    }, 250);
  };
  useEffect(() => () => { if (persistRef.current) clearTimeout(persistRef.current); }, []);

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
  const sortedRows = useMemo(() => applySorts(filteredRows, sorts), [filteredRows, sorts]);
  const groupedRows = useMemo(
    () => (groupProp ? groupBy(filteredRows, groupProp) : []),
    [filteredRows, groupProp],
  );

  if (!schema) {
    return <div className="py-12 text-center text-text-tertiary">Loading database…</div>;
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
  };

  const handleAddRowFromTemplate = async (tpl: DatabaseTemplate) => {
    await api.addDatabaseRowFromTemplate(databaseId, tpl.id);
    setNewMenuOpen(false);
    refetchRows();
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
    if (!confirm('Delete this property and all its values?')) return;
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

  const handleRemoveFilterLeaf = (leaf: { propertyId: string; operator: string }) => {
    if (!filter) return;
    const next = removeLeaf(filter, leaf);
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
      const ids = sortedRows.map((r) => r.id);
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
    setSelectedRowIds(new Set());
    refetchRows();
  };

  const handleDuplicateRow = async (rowId: string) => {
    setContextMenu(null);
    await api.duplicateDatabaseRow(rowId);
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

  // --- Drag across groups --------------------------------------------------
  const handleDropOnGroup = async (groupValue: string) => {
    if (!groupProp || selectedRowIds.size === 0) return;
    await Promise.all(
      [...selectedRowIds].map((id) => {
        const value =
          groupProp.type === 'multi_select'
            ? toggleMultiSelectValue(rows?.find((r) => r.id === id)?.properties[groupProp.id], groupValue)
            : groupValue;
        return api.updateCell({ pageId: id, propertyId: groupProp.id, value });
      }),
    );
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

  // ========================================================================
  // Render
  // ========================================================================
  return (
    <div className="border border-border-hairline rounded-md overflow-hidden bg-bg-page">
      {/* View tabs / actions bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-hairline">
        {linked && (
          <span className="inline-flex items-center gap-1 text-[11px] text-accent bg-bg-active px-1.5 py-0.5 rounded">
            🔗 linked
          </span>
        )}
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-text-primary">
            {activeView?.name ?? 'Table'}
          </span>
        </div>
        <span className="text-[11px] text-text-tertiary">
          {sortedRows.length} row{sortedRows.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Sort/group/filter quick buttons */}
          <button
            type="button"
            onClick={() => setFilterEditorOpen(true)}
            className="px-2 py-1 text-[12px] rounded text-text-secondary hover:bg-bg-hover transition-colors"
            title="Filter"
          >
            ▽ Filter
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setGroupMenuOpen((v) => !v)}
              className="px-2 py-1 text-[12px] rounded text-text-secondary hover:bg-bg-hover transition-colors"
              title="Group"
            >
              ◐ Group{group ? ' ✓' : ''}
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
            title="Export CSV"
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
              + New
            </button>
            {(templates?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setNewMenuOpen((v) => !v)}
                className="ml-0.5 px-1.5 py-1 text-[12px] rounded bg-bg-hover text-text-primary hover:bg-bg-active transition-colors"
                title="New from template"
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
          {hidden.length} hidden column(s):{' '}
          {hidden
            .map((id) => allProps.find((p) => p.id === id)?.name ?? id)
            .join(', ')}
          <button
            type="button"
            onClick={() => { setHidden([]); persistView({ hiddenProperties: [] }); }}
            className="ml-2 text-accent hover:underline"
          >
            show all
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
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-bg-section border-b border-border-hairline">
              {visibleProps.map((prop) => {
                const w = widths[prop.id] ?? DEFAULT_COL_WIDTH;
                const sort = sorts.find((s) => s.propertyId === prop.id);
                return (
                  <th
                    key={prop.id}
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
                      onMouseDown={(e) => startResize(e, prop.id, w, setWidths, (next) =>
                        persistView({ columnWidths: next }),
                      )}
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
              <th className="relative px-2 py-2 min-w-[48px] border-b border-border-hairline">
                <button
                  type="button"
                  onClick={(e) =>
                    setMenuOpenFor({
                      new: true,
                      anchorRect: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  className="text-text-tertiary hover:text-text-primary text-lg leading-none px-2"
                  title="Add property"
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
          <tbody>
            {groupProp ? (
              <GroupedBody
                groups={groupedRows}
                groupProp={groupProp}
                visibleProps={visibleProps}
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
              />
            ) : (
              <FlatBody
                rows={sortedRows}
                visibleProps={visibleProps}
                selectedRowIds={selectedRowIds}
                onRowClick={onRowClick}
                onRowContextMenu={onRowContextMenu}
                onCellChange={handleCellChange}
                onOpenRow={setCurrentPage}
                databaseId={databaseId}
                onAfterCellCommit={refetchRows}
                scrollRef={tableScrollRef}
              />
            )}
          </tbody>
        </table>
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
          hasMultiple={selectedRowIds.size > 1}
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
}: BodyProps & { rows: DatabaseRow[]; scrollRef: RefObject<HTMLDivElement | null> }) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (rows.length === 0) {
    return (
      <tr>
        <td colSpan={visibleProps.length + 1} className="px-3 py-16 text-center text-[13px] text-text-tertiary">
          No rows match. Adjust filters or click <strong>+ New</strong>.
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
  const colSpan = visibleProps.length + 1;

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

function GroupedBody({
  groups,
  visibleProps,
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
}: BodyProps & {
  groups: { key: string; label: string; color: string; rows: DatabaseRow[] }[];
  groupProp: PropertyDef;
  collapsedGroups: Set<string>;
  onToggleCollapse: (key: string) => void;
  onDropOnGroup: (groupValue: string) => void;
}) {
  return (
    <>
      {groups.map((g) => {
        const collapsed = collapsedGroups.has(g.key);
        return (
          <>
            <tr
              key={g.key}
              className="border-t border-border-hairline bg-bg-section/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onDropOnGroup(g.key); }}
            >
              <td colSpan={visibleProps.length + 1} className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleCollapse(g.key)}
                    className="text-xs text-text-tertiary w-4"
                  >
                    {collapsed ? '▸' : '▾'}
                  </button>
                  <span className={`w-1 h-4 rounded-sm ${dotClass(g.color)}`} />
                  <span className="text-[13px] font-medium text-text-primary">
                    {g.label}
                  </span>
                  <span className="text-[11px] text-text-tertiary">{g.rows.length}</span>
                </div>
              </td>
            </tr>
            {!collapsed &&
              g.rows.map((row) => (
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
                />
              ))}
          </>
        );
      })}
    </>
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
}: Omit<BodyProps, 'selectedRowIds'> & { row: DatabaseRow; selected: boolean }) {
  return (
    <tr
      className={[
        'border-t border-border-hairline/60 transition-colors group cursor-default',
        selected ? 'bg-bg-active' : 'hover:bg-bg-hover/60',
      ].join(' ')}
      onClick={(e) => onRowClick(e, row.id)}
      onContextMenu={(e) => onRowContextMenu(e, row.id)}
    >
      {visibleProps.map((prop) => (
        <td
          key={prop.id}
          className="relative px-3 py-1 align-top"
          onClick={(e) => {
            if (prop.type === 'title') {
              e.stopPropagation();
              onOpenRow(row.id);
            }
          }}
        >
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
      <td className="px-2 text-center">
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            if (confirm('Delete this row?')) {
              await api.deleteDatabaseRow(row.id);
              onAfterCellCommit();
            }
          }}
          className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-red px-1 transition-opacity"
          title="Delete row"
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
  hasMultiple,
  onClose,
  onDelete,
  onDuplicate,
  onExportCsv,
}: {
  x: number;
  y: number;
  hasMultiple: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExportCsv: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[1050]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        data-popover-root
        className="fixed z-[1051] w-44 rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-sm"
        style={{ left: x, top: y }}
      >
        <ContextItem label={hasMultiple ? `Delete ${''} selected` : 'Delete'} danger onClick={onDelete} />
        {!hasMultiple && <ContextItem label="Duplicate" onClick={onDuplicate} />}
        <ContextItem label="Export CSV" onClick={onExportCsv} />
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
          <span>Blank</span>
        </button>
        <div className="my-1 border-t border-border-hairline" />
        <div className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">
          Templates
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
            {tpl.isDefault && <span className="text-[10px] text-text-tertiary">default</span>}
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
          No grouping
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

function removeLeaf(
  node: FilterNode,
  target: { propertyId: string; operator: string },
): FilterNode | null {
  if (node.kind === 'leaf') {
    if (node.propertyId === target.propertyId && node.operator === target.operator) return null;
    return node;
  }
  const next = node.children
    .map((c) => removeLeaf(c, target))
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
) {
  e.preventDefault();
  const startX = e.clientX;
  let nextMap: Record<string, number> = {};
  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    const w = Math.max(MIN_COL_WIDTH, startW + dx);
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
