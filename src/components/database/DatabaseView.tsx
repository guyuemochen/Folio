import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/invoke';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  DatabaseRow,
  PropertyDef,
  SortEntry,
} from '../../lib/types';
import { PropertyCell } from './PropertyCells';
import { PropertyMenu } from './PropertyMenu';

/**
 * Table view for a database page.
 *
 * Loads schema + rows via TanStack Query, renders table, delegates cell
 * edits to PropertyCell and column ops to PropertyMenu.
 *
 * Sort is applied client-side (rows are always <10k in MVP). Filter UI
 * deferred to M3.5.
 */
export function DatabaseView({ databaseId }: { databaseId: string }) {
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);

  const { data: schema, refetch: refetchSchema } = useQuery({
    queryKey: ['database', databaseId],
    queryFn: () => api.getDatabase(databaseId),
  });

  const { data: rows, refetch: refetchRows } = useQuery({
    queryKey: ['database-rows', databaseId],
    queryFn: () => api.queryDatabase(databaseId),
  });

  const [sorts, setSorts] = useState<SortEntry[]>([]);
  const [menuOpenFor, setMenuOpenFor] =
    useState<
      | { col: string; anchorRect: DOMRect }
      | { new: true; anchorRect: DOMRect }
      | null
    >(null);

  if (!schema) {
    return <div className="py-12 text-center text-text-tertiary">Loading database…</div>;
  }

  const visibleProps = schema.properties; // hidden_properties deferred

  // Apply sorts
  const sortedRows = applySorts(rows ?? [], sorts);

  // Cell update handler — mutate then invalidate
  const handleCellChange = async (row: DatabaseRow, prop: PropertyDef, value: unknown) => {
    // Optimistic update: mutate cache
    // For simplicity, we just call backend + refetch.
    try {
      await api.updateCell({ pageId: row.id, propertyId: prop.id, value });
      refetchRows();
      if (prop.type === 'title') {
        // Title change should also refresh sidebar (handled by parent listener)
      }
    } catch (err) {
      console.error('[Folio] cell update failed', err);
    }
  };

  const handleAddRow = async () => {
    await api.addDatabaseRow(databaseId);
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
    });
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

  return (
    <div className="border border-border-hairline rounded-md overflow-hidden bg-bg-page">
      {/* View tabs / actions bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-hairline">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-text-primary">
            {schema.views[0]?.name ?? 'Table'}
          </span>
        </div>
        <span className="text-[11px] text-text-tertiary">
          {sortedRows.length} row{sortedRows.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleAddRow}
            className="px-2.5 py-1 text-[12px] rounded bg-bg-hover text-text-primary hover:bg-bg-active transition-colors"
          >
            + New
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          {/* Header */}
          <thead>
            <tr className="bg-bg-section border-b border-border-hairline">
              {visibleProps.map((prop) => (
                <th
                  key={prop.id}
                  className="relative text-left text-xs font-medium text-text-secondary px-3 py-2 cursor-pointer hover:bg-bg-hover min-w-[160px] border-b border-border-hairline"
                  onClick={(e) =>
                    setMenuOpenFor({
                      col: prop.id,
                      anchorRect: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <TypeIcon type={prop.type} />
                    <span>{prop.name}</span>
                  </div>
                  {menuOpenFor &&
                    'col' in menuOpenFor &&
                    menuOpenFor.col === prop.id && (
                      <PropertyMenu
                        anchorRect={menuOpenFor.anchorRect}
                        property={prop}
                        onClose={() => setMenuOpenFor(null)}
                        onSubmit={(input) => handleEditProperty(prop.id, input)}
                        onDelete={() => handleDeleteProperty(prop.id)}
                      />
                    )}
                </th>
              ))}
              {/* "+ New column" */}
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
            {/* Sort indicators row */}
            {sorts.length > 0 && (
              <tr className="border-b border-border-hairline text-xs text-text-tertiary">
                {visibleProps.map((p) => {
                  const sort = sorts.find((s) => s.propertyId === p.id);
                  return (
                    <th
                      key={p.id}
                      className="px-3 py-1 cursor-pointer hover:bg-bg-hover"
                      onClick={() => {
                        const next = [...sorts];
                        const idx = next.findIndex((s) => s.propertyId === p.id);
                        if (idx === -1) {
                          next.push({ propertyId: p.id, direction: 'asc' });
                        } else if (next[idx]!.direction === 'asc') {
                          next[idx]!.direction = 'desc';
                        } else {
                          next.splice(idx, 1);
                        }
                        setSorts(next);
                      }}
                    >
                      {sort ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  );
                })}
                <th />
              </tr>
            )}
          </thead>
          {/* Body */}
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleProps.length + 1}
                  className="px-3 py-16 text-center text-[13px] text-text-tertiary"
                >
                  No rows yet. Click <strong>+ New</strong> to add one.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border-hairline/60 hover:bg-bg-hover/60 transition-colors group"
                >
                  {visibleProps.map((prop) => (
                    <td
                      key={prop.id}
                      className="relative px-3 py-1 align-top"
                      onClick={(e) => {
                        if (prop.type === 'title') {
                          e.stopPropagation();
                          setCurrentPage(row.id);
                        }
                      }}
                    >
                      <PropertyCell
                        value={row.properties[prop.id]}
                        property={prop}
                        onChange={(v) => handleCellChange(row, prop, v)}
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
                          refetchRows();
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-red px-1 transition-opacity"
                      title="Delete row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
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
  // nulls sort first
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
