import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/invoke';
import type { LinkedDatabaseAttrs } from '../../lib/types';
import { DatabaseView } from './DatabaseView';
import { LinkedDatabasePicker } from './LinkedDatabasePicker';

/**
 * TipTap NodeView for the `linkedDatabase` block (PRD §5.3.8).
 *
 * Renders a `DatabaseView` inline inside a page document. The view reflects
 * the latest rows of the source database — mutations propagate automatically
 * because both views query the same source via `query_database`.
 *
 * `sourceDatabaseId` selects the source; `viewId` selects which of the
 * source database's saved views to use (null → default view).
 */
export function LinkedDatabaseBlock(props: NodeViewProps) {
  const attrs = props.node.attrs as LinkedDatabaseAttrs;
  const sourceDatabaseId: string | null = attrs.sourceDatabaseId ?? null;
  const viewId: string | null = attrs.viewId ?? null;
  const updateAttrs = props.updateAttributes;

  const [pickerOpen, setPickerOpen] = useState(false);

  // Pre-fetch source db title + available views for the header switcher.
  const { data: sourceDb } = useQuery({
    queryKey: ['database', sourceDatabaseId],
    queryFn: () => api.getDatabase(sourceDatabaseId!),
    enabled: !!sourceDatabaseId,
  });

  // No source yet — show a "pick a database" placeholder.
  if (!sourceDatabaseId) {
    return (
      <NodeViewWrapper className="folio-linked-database">
        <div className="my-3 flex items-center gap-2 rounded-md border border-dashed border-border-strong/60 px-3 py-3 text-[13px] text-text-tertiary">
          <span>🔗</span>
          <button
            type="button"
            contentEditable={false}
            draggable={false}
            onClick={() => setPickerOpen(true)}
            className="text-accent hover:underline"
          >
            Pick a database to link
          </button>
          {pickerOpen && (
            <LinkedDatabasePicker
              onClose={() => setPickerOpen(false)}
              onPick={(id) => {
                updateAttrs({ sourceDatabaseId: id, viewId: null });
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const views = sourceDb?.views ?? [];

  return (
    <NodeViewWrapper className="folio-linked-database" data-source-database={sourceDatabaseId}>
      <div className="my-3 rounded-md border border-border-hairline bg-bg-page overflow-hidden">
        {/* Header: view switcher */}
        {views.length > 1 && (
          <div className="flex items-center gap-2 px-3 py-1 border-b border-border-hairline bg-bg-section/40 text-[11px]">
            <span className="text-text-tertiary">View:</span>
            <select
              value={viewId ?? ''}
              contentEditable={false}
              draggable={false}
              onChange={(e) => updateAttrs({ viewId: e.target.value || null })}
              className="text-[11px] bg-bg-page border border-border-hairline rounded px-1.5 py-0.5 outline-none focus:border-accent"
            >
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <DatabaseView databaseId={sourceDatabaseId} linked viewId={viewId ?? undefined} />
      </div>
    </NodeViewWrapper>
  );
}

