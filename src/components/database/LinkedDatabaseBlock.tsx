import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/invoke';
import type { LinkedDatabaseAttrs, LocalViewConfig } from '../../lib/types';
import { DatabaseView } from './DatabaseView';
import { LinkedDatabasePicker } from './LinkedDatabasePicker';

/**
 * TipTap NodeView for the `linkedDatabase` block (PRD §5.3.8).
 *
 * Renders a DatabaseView inline inside a page document. Row data (cells, new
 * rows, deletes) flows through to the source database, so the linked view
 * always reflects the latest rows. The view *configuration* (filter / sort /
 * group / hidden columns / column widths) lives in the document — every
 * linked-database block has its own independent view, distinct from any
 * saved view on the source database.
 *
 * The header dropdown lets the user re-base the link on one of the source
 * db's saved views; doing so **copies** that view's current config into the
 * block as the new starting point. Subsequent edits stay local.
 */
export function LinkedDatabaseBlock(props: NodeViewProps) {
  const attrs = props.node.attrs as LinkedDatabaseAttrs;
  const sourceDatabaseId: string | null = attrs.sourceDatabaseId ?? null;
  // viewConfig is always present on the node (defaulted by linkedDatabaseNode);
  // fall back to an empty config defensively in case of legacy docs.
  const viewConfig: LocalViewConfig =
    attrs.viewConfig ?? { filter: null, sort: null, group: null, hiddenProperties: [], columnWidths: {} };
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
                updateAttrs({ sourceDatabaseId: id, viewConfig: emptyViewConfig(), sourceViewId: null });
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const views = sourceDb?.views ?? [];

  // Re-basing on a different source view: copy that view's current config
  // into the block's local viewConfig (not a reference — a snapshot).
  const rebaseOnSourceView = (newViewId: string | null) => {
    const picked = newViewId
      ? views.find((v) => v.id === newViewId)
      : views.find((v) => v.isDefault) ?? views[0];
    if (picked) {
      updateAttrs({
        sourceViewId: picked.id,
        viewConfig: {
          filter: picked.filter ?? null,
          sort: picked.sort ?? null,
          group: picked.group ?? null,
          hiddenProperties: picked.hiddenProperties ?? [],
          columnWidths: picked.columnWidths ?? {},
        },
      });
    } else {
      updateAttrs({
        sourceViewId: newViewId,
        viewConfig: emptyViewConfig(),
      });
    }
  };

  return (
    <NodeViewWrapper className="folio-linked-database" data-source-database={sourceDatabaseId}>
      <div className="my-3 rounded-md border border-border-hairline bg-bg-page overflow-hidden">
        {/* Header: source-view switcher (re-bases the local config) */}
        {views.length > 1 && (
          <div className="flex items-center gap-2 px-3 py-1 border-b border-border-hairline bg-bg-section/40 text-[11px]">
            <span className="text-text-tertiary">View:</span>
            <select
              value={attrs.sourceViewId ?? ''}
              contentEditable={false}
              draggable={false}
              onChange={(e) => rebaseOnSourceView(e.target.value || null)}
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
        <DatabaseView
          databaseId={sourceDatabaseId}
          linked
          embeddedView={viewConfig}
          onEmbeddedViewChange={(next) => updateAttrs({ viewConfig: next })}
        />
      </div>
    </NodeViewWrapper>
  );
}

function emptyViewConfig(): LocalViewConfig {
  return { filter: null, sort: null, group: null, hiddenProperties: [], columnWidths: {} };
}
