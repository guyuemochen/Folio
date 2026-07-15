import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { LinkedDatabaseAttrs } from '../../lib/types';
import { LinkedDatabaseBlock } from './LinkedDatabaseBlock';

/**
 * TipTap Node definition for the `linkedDatabase` block (PRD §5.3.8).
 *
 * Atomic, non-editable leaf node. Persists:
 *   - sourceDatabaseId — id of the source `page` row with type='database'
 *   - viewConfig       — LOCAL view config (filter/sort/group/hidden/widths),
 *                        stored in the document so each linked-database
 *                        block has its own independent view. Row data still
 *                        comes from the source db via query_database.
 *   - sourceViewId     — optional id of the source-db view this link was
 *                        originally based on (metadata only, not used to
 *                        look up live state).
 *
 * Mutations to the underlying rows (cell edits, new rows, deletes) write
 * through to the source db, so the data stays in sync. Filter / sort /
 * group / column layout stay local to this block.
 */
export const linkedDatabaseNode = Node.create<{
  HTMLAttributes: Record<string, unknown>;
}>({
  name: 'linkedDatabase',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      sourceDatabaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-source-database'),
        renderHTML: (attrs: LinkedDatabaseAttrs) =>
          attrs.sourceDatabaseId
            ? ['data-source-database', attrs.sourceDatabaseId]
            : [],
      },
      // viewConfig is a JSON blob — TipTap serializes it to the doc JSON as-is.
      viewConfig: {
        default: { filter: null, sort: null, group: null, hiddenProperties: [], columnWidths: {} },
        parseHTML: (el) => {
          const raw = el.getAttribute('data-view-config');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        renderHTML: (attrs: LinkedDatabaseAttrs) =>
          attrs.viewConfig && Object.keys(attrs.viewConfig).length > 0
            ? ['data-view-config', JSON.stringify(attrs.viewConfig)]
            : [],
      },
      sourceViewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-source-view-id'),
        renderHTML: (attrs: LinkedDatabaseAttrs) =>
          attrs.sourceViewId ? ['data-source-view-id', attrs.sourceViewId] : [],
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="linked-database"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'linked-database', ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkedDatabaseBlock);
  },
});

export default linkedDatabaseNode;
