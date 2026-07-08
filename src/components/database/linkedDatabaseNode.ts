import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { LinkedDatabaseAttrs } from '../../lib/types';
import { LinkedDatabaseBlock } from './LinkedDatabaseBlock';

/**
 * TipTap Node definition for the `linkedDatabase` block (PRD §5.3.8).
 *
 * Atomic, non-editable leaf node. Persists:
 *   - sourceDatabaseId — id of the source `page` row with type='database'
 *   - viewId            — id of a saved view on the source db (null = default)
 *
 * Mutations made inside the linked view write through to the source db via
 * `update_cell_cmd` / `add_database_row` etc., so both views stay in sync.
 *
 * INTEGRATION NOTE (M2 / Editor.tsx owner):
 * -----------------------------------------
 * This file EXPORTS the node definition only. It is **not** registered
 * anywhere yet — registering it requires editing `src/editor/Editor.tsx`
 * (owned by M2), which is out of scope here. The editor should:
 *
 *   1. import { linkedDatabaseNode } from '../components/database/linkedDatabaseNode';
 *   2. add it to the `extensions: [...]` array of `useEditor(...)`.
 *
 * Until M2 wires it, the `/linked-database` slash command still opens the
 * picker (via the loose-coupling event `folio:insert-block`) but the actual
 * node insertion will be rejected by ProseMirror's schema. See
 * `slashCommands.ts` for the event contract.
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
      viewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-view-id'),
        renderHTML: (attrs: LinkedDatabaseAttrs) =>
          attrs.viewId ? ['data-view-id', attrs.viewId] : [],
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
