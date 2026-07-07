import { useQuery } from '@tanstack/react-query';
import { memo, useCallback, useState } from 'react';
import { api } from '../../lib/invoke';
import type { PropertyDef } from '../../lib/types';
import { PropertyCell } from './PropertyCells';

interface RowPropertyPanelProps {
  rowPageId: string;
  databaseId: string;
}

interface PropertyRowProps {
  prop: PropertyDef;
  value: unknown;
  onCommit: (propId: string, value: unknown) => void;
}

/**
 * Memoized per-property row. Building `onChange` via `useCallback` keeps the
 * callback stable per prop.id, so PropertyCell (also memoized) only re-renders
 * when this cell's `value` actually changes — not on every keystroke in a
 * sibling cell.
 */
const PropertyRow = memo(function PropertyRow({
  prop,
  value,
  onCommit,
}: PropertyRowProps) {
  const handleChange = useCallback(
    (v: unknown) => onCommit(prop.id, v),
    [onCommit, prop.id],
  );
  return (
    <div className="contents">
      <div className="text-xs text-text-tertiary truncate">{prop.name}</div>
      <div className="relative min-h-[24px] px-2 py-1 rounded hover:bg-bg-hover">
        <PropertyCell
          value={value}
          property={prop}
          onChange={handleChange}
        />
      </div>
    </div>
  );
});

/**
 * Sticky 80px panel at the top of a database row page (decision Q5-B).
 *
 * Renders the row's properties as horizontal pills so the user can edit them
 * without leaving the page. Click chevron to collapse.
 */
export const RowPropertyPanel = memo(function RowPropertyPanel({
  rowPageId,
  databaseId,
}: RowPropertyPanelProps) {
  const { data: schema } = useQuery({
    queryKey: ['database', databaseId],
    queryFn: () => api.getDatabase(databaseId),
  });
  const { data: rows, refetch } = useQuery({
    queryKey: ['database-rows', databaseId],
    queryFn: () => api.queryDatabase(databaseId),
  });

  const [collapsed, setCollapsed] = useState(false);

  const handleCommit = useCallback(
    async (propId: string, v: unknown) => {
      try {
        await api.updateCell({
          pageId: rowPageId,
          propertyId: propId,
          value: v,
        });
        refetch();
      } catch (err) {
        console.error('[Folio] cell update failed', err);
      }
    },
    [rowPageId, refetch],
  );

  if (!schema || !rows) return null;
  const row = rows.find((r) => r.id === rowPageId);
  if (!row) return null;

  // Show all properties except the title (it's already in the page heading)
  const shownProps: PropertyDef[] = schema.properties.filter((p) => p.type !== 'title');

  if (shownProps.length === 0) {
    return (
      <div className="mb-4 p-2 rounded-md border border-border-hairline bg-bg-section text-xs text-text-tertiary">
        This row has no extra properties. Edit them in the database.
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10 -mx-24 mb-6 px-24 py-3 bg-bg-page/95 backdrop-blur border-b border-border-hairline">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="text-xs text-text-tertiary hover:text-text-primary w-4"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Properties
        </span>
      </div>
      {!collapsed && (
        <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 items-center">
          {shownProps.map((prop) => (
            <PropertyRow
              key={prop.id}
              prop={prop}
              value={row.properties[prop.id]}
              onCommit={handleCommit}
            />
          ))}
        </div>
      )}
    </div>
  );
});
