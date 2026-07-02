import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Popover } from '../../components/ui/Popover';
import { api } from '../../lib/invoke';

interface BlockMenuProps {
  editor: Editor;
  /** ProseMirror position of the block start (from editor.state). */
  blockPos: number;
  anchorRect: DOMRect;
  onClose: () => void;
}

/**
 * Block context menu — opened by clicking the ⋮⋮ drag handle.
 *
 * Actions (Notion-aligned):
 *   - Duplicate (Cmd+D)
 *   - Turn into (Paragraph / H1 / H2 / H3 / Quote / Code)
 *   - Delete (Cmd+Delete)
 *   - Copy link to block (copies a `#block-{id}` URL; uses position since we
 *     don't have stable block ids in M2.5 — accurate when the doc doesn't
 *     shift)
 *
 * Drag-to-reorder is handled by the handle itself (HTML5 draggable), not here.
 */
export function BlockMenu({ editor, blockPos, anchorRect, onClose }: BlockMenuProps) {
  const [submenu, setSubmenu] = useState<null | 'turn-into'>(null);

  // Resolve the current block to know its type for the Turn into submenu
  const $pos = editor.state.doc.resolve(blockPos);
  const currentNode: PmNode | null =
    $pos.parent.maybeChild($pos.index(0)) ?? null;
  const currentType = currentNode?.type.name ?? 'paragraph';
  const currentLevel = (currentNode?.attrs?.level ?? null) as number | null;

  const duplicate = () => {
    const { node, from } = findBlockRange(editor, blockPos);
    if (!node) return;
    // Build a new node from the source JSON and insert after the source.
    const nodeJson = node.toJSON();
    editor.chain()
      .insertContentAt(from + node.nodeSize, nodeJson)
      .focus()
      .run();
    onClose();
  };

  const remove = () => {
    const { node, from } = findBlockRange(editor, blockPos);
    if (!node) return;
    editor.chain().deleteRange({ from, to: from + node.nodeSize }).focus().run();
    onClose();
  };

  const turnInto = (type: string, level?: number) => {
    const { from, to } = findBlockRange(editor, blockPos);
    const safeLevel = (level ?? 1) as 1 | 2 | 3;
    if (type === 'paragraph') {
      editor.chain().setTextSelection({ from, to }).setParagraph().focus().run();
    } else if (type === 'heading') {
      editor.chain()
        .setTextSelection({ from, to })
        .setHeading({ level: safeLevel })
        .focus()
        .run();
    } else if (type === 'blockquote') {
      editor.chain().setTextSelection({ from, to }).toggleBlockquote().focus().run();
    } else if (type === 'codeBlock') {
      editor.chain().setTextSelection({ from, to }).toggleCodeBlock().focus().run();
    }
    onClose();
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/#${blockPos}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore — clipboard may be blocked in webview
    }
    onClose();
  };

  const saveBlock = async () => {
    // No-op placeholder — M5+ might add explicit "save as snippet" feature
    try {
      await api.getWorkspace(); // ensure backend reachable
    } catch {
      // ignore
    }
    onClose();
  };

  return (
    <Popover anchorRect={anchorRect} placement="bottom-start" width={220} onClose={onClose}>
      {!submenu && (
        <div className="py-1">
          <MenuItem icon="⎘" label="Duplicate" shortcut="Ctrl+D" onClick={duplicate} />
          <MenuItem
            icon="⇄"
            label="Turn into"
            trailing="▸"
            onClick={() => setSubmenu('turn-into')}
          />
          <MenuItem icon="🔗" label="Copy link to block" onClick={copyLink} />
          <MenuItem icon="★" label="Save block" onClick={saveBlock} />
          <div className="my-1 border-t border-border-hairline" />
          <MenuItem icon="🗑" label="Delete" shortcut="Ctrl+⌫" danger onClick={remove} />
        </div>
      )}

      {submenu === 'turn-into' && (
        <div className="py-1">
          <MenuItem
            icon="Aa"
            label="Text"
            trailing={currentType === 'paragraph' ? '✓' : undefined}
            onClick={() => turnInto('paragraph')}
          />
          <MenuItem
            icon="H₁"
            label="Heading 1"
            trailing={currentType === 'heading' && currentLevel === 1 ? '✓' : undefined}
            onClick={() => turnInto('heading', 1)}
          />
          <MenuItem
            icon="H₂"
            label="Heading 2"
            trailing={currentType === 'heading' && currentLevel === 2 ? '✓' : undefined}
            onClick={() => turnInto('heading', 2)}
          />
          <MenuItem
            icon="H₃"
            label="Heading 3"
            trailing={currentType === 'heading' && currentLevel === 3 ? '✓' : undefined}
            onClick={() => turnInto('heading', 3)}
          />
          <MenuItem
            icon="❝"
            label="Quote"
            trailing={currentType === 'blockquote' ? '✓' : undefined}
            onClick={() => turnInto('blockquote')}
          />
          <MenuItem
            icon="</>"
            label="Code"
            trailing={currentType === 'codeBlock' ? '✓' : undefined}
            onClick={() => turnInto('codeBlock')}
          />
        </div>
      )}
    </Popover>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  trailing,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  shortcut?: string;
  trailing?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={[
        'w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-left transition-colors',
        danger ? 'text-status-red hover:bg-status-red/10' : 'text-text-primary hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className="w-4 text-center text-[12px] opacity-70">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-text-tertiary">{shortcut}</span>}
      {trailing && <span className="text-[11px] text-text-tertiary">{trailing}</span>}
    </button>
  );
}

// === Helpers ===

/**
 * Find the (node, from, to) of the top-level block whose start is `blockPos`.
 * `blockPos` is the doc position returned by `view.posAtCoords` and resolved
 * to the start of the block.
 */
function findBlockRange(
  editor: Editor,
  blockPos: number,
): { node: PmNode | null; from: number; to: number } {
  const doc = editor.state.doc;
  let $pos = doc.resolve(blockPos);
  // If pos is inside a paragraph (depth > 0), walk back to start of top-level.
  if ($pos.depth > 0) {
    $pos = doc.resolve($pos.before(1));
  }
  const from = $pos.pos;
  const node = doc.nodeAt(from);
  return { node, from, to: from + (node?.nodeSize ?? 0) };
}
