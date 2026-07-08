import { Extension } from '@tiptap/core';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';

/**
 * Global keyboard shortcuts for the editor (PRD §5.1.5).
 *
 * StarterKit already covers Mod+B/I/U (bold/italic/underline),
 * Mod+Z / Mod+Shift+Z (undo/redo), Enter (new paragraph), Tab/Shift+Tab
 * inside list items (sink/lift). This extension wires the rest:
 *
 *   Mod+E            — toggle inline code
 *   Mod+Shift+S      — toggle strikethrough
 *   Mod+Shift+1/2/3  — turn into H1/H2/H3
 *   Mod+D            — duplicate the current top-level block
 *   Mod+Delete       — delete the current top-level block (Backspace fallback)
 *   Mod+K            — insert link (with selection) / defer to global search (no selection)
 *   Mod+Shift+K      — remove link
 *   Mod+/            — open slash palette (dispatch `folio:open-slash`)
 *   Mod+Shift+Up     — move current block up
 *   Mod+Shift+Down   — move current block down
 *   Mod+F            — open in-page find bar (dispatch `folio:open-find`)
 *   Backspace @ empty-block-start — delete the block + lift caret
 */
export interface KeyboardShortcutsOptions {
  onOpenSlash?: () => void;
  onOpenFind?: () => void;
  onOpenGlobalSearch?: () => void;
}

export const KeyboardShortcuts = Extension.create<KeyboardShortcutsOptions>({
  name: 'folioKeyboardShortcuts',

  addOptions() {
    return {
      onOpenSlash: () => window.dispatchEvent(new CustomEvent('folio:open-slash')),
      onOpenFind: () => window.dispatchEvent(new CustomEvent('folio:open-find')),
      onOpenGlobalSearch: () => window.dispatchEvent(new CustomEvent('folio:open-search')),
    };
  },

  addKeyboardShortcuts() {
    const opts = this.options;
    return {
      // === Inline marks ===
      'Mod-e': () => this.editor.commands.toggleCode(),
      'Mod-Shift-s': () => this.editor.commands.toggleStrike(),

      // === Turn into ===
      'Mod-Shift-1': () => this.editor.commands.setHeading({ level: 1 }),
      'Mod-Shift-2': () => this.editor.commands.setHeading({ level: 2 }),
      'Mod-Shift-3': () => this.editor.commands.setHeading({ level: 3 }),

      // === Block ops ===
      'Mod-d': () => duplicateCurrentBlock(this.editor.view),
      'Mod-Delete': () => deleteCurrentBlock(this.editor.view),
      'Mod-Backspace': () => deleteCurrentBlock(this.editor.view),

      // === Move block ===
      'Mod-Shift-Up': () => moveCurrentBlock(this.editor.view, -1),
      'Mod-Shift-Down': () => moveCurrentBlock(this.editor.view, +1),

      // === Link ===
      'Mod-k': () => {
        const { empty } = this.editor.state.selection;
        if (empty) {
          opts.onOpenGlobalSearch?.();
          return true;
        }
        if (this.editor.isActive('link')) {
          this.editor.chain().focus().unsetLink().run();
          return true;
        }
        const url = window.prompt('Link URL:');
        if (url) {
          this.editor.chain().focus().setLink({ href: url.trim() }).run();
        }
        return true;
      },
      'Mod-Shift-k': () => {
        this.editor.chain().focus().unsetLink().run();
        return true;
      },

      // === Slash palette ===
      'Mod-/': () => {
        opts.onOpenSlash?.();
        return true;
      },

      // === In-page find ===
      'Mod-f': () => {
        opts.onOpenFind?.();
        return true;
      },

      // === Empty block: Backspace at start deletes the block (lifts up) ===
      Backspace: () => {
        const { state, view } = this.editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const $from = selection.$from;
        if ($from.parentOffset !== 0) return false;
        const parent = $from.parent;
        if (!parent.isTextblock || parent.content.size !== 0) return false;
        if (state.doc.childCount <= 1) return false;
        const from = $from.before($from.depth);
        const tr = state.tr.delete(from, from + parent.nodeSize);
        // Move caret into the end of the previous block.
        const $prevEnd = tr.doc.resolve(Math.max(0, from - 1));
        const sel = TextSelection.near($prevEnd, -1);
        tr.setSelection(sel);
        view.dispatch(tr);
        return true;
      },
    };
  },
});

// === Helpers ===========================================================

/**
 * Resolve the top-level block containing the selection.
 * Returns `{ node, from }` (from = position of the block start) or null.
 */
function currentTopBlock(state: EditorState): { node: PmNode; from: number } | null {
  const $pos = state.selection.$from;
  if ($pos.depth === 0) return null;
  const from = $pos.before(1);
  const node = state.doc.nodeAt(from);
  return node ? { node, from } : null;
}

function duplicateCurrentBlock(view: EditorView): boolean {
  const { state } = view;
  const cur = currentTopBlock(state);
  if (!cur) return false;
  const json = cur.node.toJSON();
  const insertAt = cur.from + cur.node.nodeSize;
  const tr = state.tr.insert(insertAt, json);
  view.dispatch(tr);
  // Move caret into the duplicate.
  const $dup = tr.doc.resolve(insertAt + 1);
  const sel = TextSelection.near($dup, 1);
  view.dispatch(tr.setSelection(sel));
  return true;
}

function deleteCurrentBlock(view: EditorView): boolean {
  const { state } = view;
  const cur = currentTopBlock(state);
  if (!cur) return false;
  const isLast = state.doc.childCount <= 1;
  const tr: Transaction = isLast
    ? state.tr.replaceWith(cur.from, cur.from + cur.node.nodeSize, state.schema.nodes.paragraph.create())
    : state.tr.delete(cur.from, cur.from + cur.node.nodeSize);
  // Place caret in/near the previous block.
  const $prev = tr.doc.resolve(Math.max(0, cur.from - 1));
  tr.setSelection(TextSelection.near($prev, -1));
  view.dispatch(tr);
  return true;
}

function moveCurrentBlock(view: EditorView, delta: -1 | 1): boolean {
  const { state } = view;
  const cur = currentTopBlock(state);
  if (!cur) return false;
  const doc = state.doc;
  // Find index of the current block.
  let idx = -1;
  let scan = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (scan === cur.from) {
      idx = i;
      break;
    }
    scan += doc.child(i).nodeSize;
  }
  if (idx === -1) return false;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= doc.childCount) return false;
  // Compute target position.
  let targetPos = 0;
  for (let i = 0; i < targetIdx; i++) targetPos += doc.child(i).nodeSize;
  const nodeJson = cur.node.toJSON();
  const tr = state.tr;
  tr.delete(cur.from, cur.from + cur.node.nodeSize);
  // After delete, positions after `cur.from` shift by -nodeSize.
  // If moving down (delta>0), targetPos was computed before delete and
  // the target sits above the source's old slot, so subtract nodeSize.
  const insertAt = delta < 0 ? targetPos : Math.max(0, targetPos - cur.node.nodeSize);
  tr.insert(insertAt, nodeJson);
  // Place caret inside the moved block.
  const $after = tr.doc.resolve(insertAt + 1);
  tr.setSelection(TextSelection.near($after, 1));
  view.dispatch(tr);
  return true;
}
