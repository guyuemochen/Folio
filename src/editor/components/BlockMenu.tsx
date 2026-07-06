import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Popover } from '../../components/ui/Popover';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface BlockMenuProps {
  editor: Editor;
  /** ProseMirror position of the block start (from editor.state). */
  blockPos: number;
  anchorRect: DOMRect;
  onClose: () => void;
}

type SubmenuName = null | 'turn-into' | 'color' | 'move-to';

/**
 * Block context menu — opened by clicking the ⋮⋮ drag handle.
 *
 * Actions (PRD §5.1.3):
 *   - Duplicate (Cmd/Ctrl+D)
 *   - Turn into → 10 text-type submenu (Text/H1/H2/H3/Quote/Code/Bulleted/Numbered/ToDo/Toggle)
 *   - Color → 9 highlight + 9 text colors + Default (remove)
 *   - Copy link to block
 *   - Comment (placeholder — dispatches a "coming in v1" toast)
 *   - Move to → page picker (renders workspace root + child tree)
 *   - Delete (Cmd+Delete)
 *
 * Drag-to-reorder is handled by the handle itself (HTML5 draggable), not here.
 */
export function BlockMenu({ editor, blockPos, anchorRect, onClose }: BlockMenuProps) {
  const [submenu, setSubmenu] = useState<SubmenuName>(null);

  // Resolve the current block to know its type for the Turn into submenu.
  const $pos = editor.state.doc.resolve(blockPos);
  const currentNode: PmNode | null = $pos.parent.maybeChild($pos.index(0)) ?? null;
  const currentType = currentNode?.type.name ?? 'paragraph';
  const currentLevel = (currentNode?.attrs?.level ?? null) as number | null;

  const duplicate = () => {
    const { node, from } = findBlockRange(editor, blockPos);
    if (!node) return;
    const nodeJson = node.toJSON();
    editor.chain().insertContentAt(from + node.nodeSize, nodeJson).focus().run();
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
      editor.chain().setTextSelection({ from, to }).setHeading({ level: safeLevel }).focus().run();
    } else if (type === 'blockquote') {
      editor.chain().setTextSelection({ from, to }).toggleBlockquote().focus().run();
    } else if (type === 'codeBlock') {
      editor.chain().setTextSelection({ from, to }).toggleCodeBlock().focus().run();
    } else if (type === 'bulletList') {
      editor.chain().setTextSelection({ from, to }).toggleBulletList().focus().run();
    } else if (type === 'orderedList') {
      editor.chain().setTextSelection({ from, to }).toggleOrderedList().focus().run();
    } else if (type === 'taskList') {
      editor.chain().setTextSelection({ from, to }).toggleTaskList().focus().run();
    } else if (type === 'toggle') {
      editor.chain().setTextSelection({ from, to }).setToggle().focus().run();
    }
    onClose();
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/#${blockPos}`;
    try {
      await navigator.clipboard.writeText(url);
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Block link copied' }));
    } catch {
      // ignore — clipboard may be blocked in webview
    }
    onClose();
  };

  const commentPlaceholder = () => {
    window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Comments — coming in v1' }));
    onClose();
  };

  const moveTo = (targetParentId: string | null) => {
    // Best-effort: dispatch a folio:move-block event. App.tsx or PageView may
    // listen; if none does, we still inform the user via toast.
    window.dispatchEvent(
      new CustomEvent('folio:move-block', {
        detail: { blockPos, targetParentId },
      }),
    );
    window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Move-to — coming in v1' }));
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
          <MenuItem
            icon="🎨"
            label="Color"
            trailing="▸"
            onClick={() => setSubmenu('color')}
          />
          <MenuItem icon="🔗" label="Copy link to block" onClick={copyLink} />
          <MenuItem icon="💬" label="Comment" onClick={commentPlaceholder} />
          <MenuItem
            icon="↪"
            label="Move to"
            trailing="▸"
            onClick={() => setSubmenu('move-to')}
          />
          <div className="my-1 border-t border-border-hairline" />
          <MenuItem icon="🗑" label="Delete" shortcut="Ctrl+⌫" danger onClick={remove} />
        </div>
      )}

      {submenu === 'turn-into' && (
        <div className="py-1">
          <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-text-tertiary">
            Turn into
          </div>
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
          <MenuItem
            icon="•"
            label="Bulleted list"
            trailing={currentType === 'bulletList' ? '✓' : undefined}
            onClick={() => turnInto('bulletList')}
          />
          <MenuItem
            icon="1."
            label="Numbered list"
            trailing={currentType === 'orderedList' ? '✓' : undefined}
            onClick={() => turnInto('orderedList')}
          />
          <MenuItem
            icon="☐"
            label="To-do list"
            trailing={currentType === 'taskList' ? '✓' : undefined}
            onClick={() => turnInto('taskList')}
          />
          <MenuItem
            icon="▸"
            label="Toggle"
            trailing={currentType === 'toggle' ? '✓' : undefined}
            onClick={() => turnInto('toggle')}
          />
        </div>
      )}

      {submenu === 'color' && (
        <div className="p-2">
          <ColorSubmenu editor={editor} blockPos={blockPos} onDone={onClose} onBack={() => setSubmenu(null)} />
        </div>
      )}

      {submenu === 'move-to' && (
        <div className="p-1">
          <MoveToSubpage onBack={() => setSubmenu(null)} onPick={moveTo} />
        </div>
      )}
    </Popover>
  );
}

/** Color submenu: 9 text colors + 9 highlight colors + Default (clear). */
function ColorSubmenu({
  editor,
  blockPos,
  onDone,
  onBack,
}: {
  editor: Editor;
  blockPos: number;
  onDone: () => void;
  onBack: () => void;
}) {
  const apply = (color: string | null, kind: 'text' | 'highlight') => {
    const { from, to } = findBlockRange(editor, blockPos);
    editor.chain().setTextSelection({ from, to }).focus();
    if (kind === 'text') {
      if (color) editor.chain().setColor(color).run();
      else editor.chain().unsetColor().run();
    } else {
      if (color) editor.chain().toggleHighlight({ color }).run();
      else editor.chain().unsetHighlight().run();
    }
    onDone();
  };

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Color</span>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onBack();
          }}
          className="text-[11px] text-text-tertiary hover:text-text-primary"
        >
          ◂ Back
        </button>
      </div>

      <div className="text-[10px] px-1 pt-1 text-text-tertiary">Text</div>
      <div className="grid grid-cols-5 gap-1 px-1 py-1">
        <ColorSwatch color={null} kind="text" onPick={apply} title="Default" />
        {TEXT_COLORS.map((c) => (
          <ColorSwatch key={c.value} color={c.value} kind="text" onPick={apply} title={c.label} />
        ))}
      </div>

      <div className="text-[10px] px-1 pt-2 text-text-tertiary">Background</div>
      <div className="grid grid-cols-5 gap-1 px-1 py-1">
        <ColorSwatch color={null} kind="highlight" onPick={apply} title="Default" />
        {HIGHLIGHT_COLORS.map((c) => (
          <ColorSwatch key={c.value} color={c.value} kind="highlight" onPick={apply} title={c.label} />
        ))}
      </div>
    </div>
  );
}

function ColorSwatch({
  color,
  kind,
  onPick,
  title,
}: {
  color: string | null;
  kind: 'text' | 'highlight';
  onPick: (color: string | null, kind: 'text' | 'highlight') => void;
  title: string;
}) {
  const style: React.CSSProperties =
    color === null
      ? { background: 'transparent', border: '1px dashed var(--color-border-strong)' }
      : kind === 'text'
        ? { background: 'transparent', color, border: `1px solid ${color}` }
        : { background: color, border: '1px solid rgba(0,0,0,0.08)' };
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(color, kind);
      }}
      className="w-7 h-7 rounded-md text-[11px] flex items-center justify-center hover:scale-110 transition-transform"
      style={style}
    >
      {color === null ? '∅' : ''}
    </button>
  );
}

/**
 * Inline page-tree picker for "Move to". Reads the workspace store's
 * `rootPages` + `childrenCache` and dispatches the selected parent id.
 */
function MoveToSubpage({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (parentId: string | null) => void;
}) {
  const rootPages = useWorkspaceStore((s) => s.rootPages);
  const childrenCache = useWorkspaceStore((s) => s.childrenCache);
  const loadChildren = useWorkspaceStore((s) => s.loadChildren);
  const expanded = useWorkspaceStore((s) => s.expanded);
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand);

  const renderNode = (page: { id: string; title: string; icon: string | null; parentType: string }, depth: number): React.ReactNode => {
    const isExpanded = expanded.has(page.id);
    const children = childrenCache[page.id] ?? [];
    return (
      <div key={page.id}>
        <div
          className="flex items-center gap-1 px-1 py-0.5 text-[12px] hover:bg-bg-hover rounded cursor-pointer"
          style={{ paddingLeft: depth * 10 }}
        >
          {page.parentType === 'page' || page.parentType === 'workspace' ? (
            <button
              type="button"
              className="w-4 text-text-tertiary"
              onMouseDown={(e) => {
                e.preventDefault();
                void loadChildren(page.id);
                toggleExpand(page.id);
              }}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <button
            type="button"
            className="flex-1 text-left truncate"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(page.id);
            }}
            title={page.title || 'Untitled'}
          >
            <span className="mr-1">{page.icon || '📄'}</span>
            <span className="text-text-primary">{page.title || 'Untitled'}</span>
          </button>
        </div>
        {isExpanded && children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="max-h-[280px] overflow-y-auto" style={{ width: 200 }}>
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Move to</span>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onBack();
          }}
          className="text-[11px] text-text-tertiary hover:text-text-primary"
        >
          ◂ Back
        </button>
      </div>
      <div
        className="flex items-center gap-1 px-1 py-0.5 text-[12px] hover:bg-bg-hover rounded cursor-pointer"
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(null);
        }}
      >
        <span className="w-4" />
        <span className="text-text-primary">Workspace root</span>
      </div>
      {rootPages.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-text-tertiary">No pages yet</div>
      ) : (
        rootPages.map((p) => renderNode(p, 0))
      )}
    </div>
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

/** 9 Notion semantic text colors. */
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: 'Gray', value: '#9b9a97' },
  { label: 'Brown', value: '#90765a' },
  { label: 'Orange', value: '#d9730d' },
  { label: 'Yellow', value: '#cb912f' },
  { label: 'Green', value: '#448361' },
  { label: 'Blue', value: '#0b6e99' },
  { label: 'Purple', value: '#6940a5' },
  { label: 'Pink', value: '#ad1a72' },
  { label: 'Red', value: '#e03e31' },
];

/** 9 Notion semantic highlight colors (soft tints). */
const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: 'Gray', value: 'rgba(120, 119, 116, 0.30)' },
  { label: 'Brown', value: 'rgba(159, 107, 83, 0.30)' },
  { label: 'Orange', value: 'rgba(217, 115, 13, 0.25)' },
  { label: 'Yellow', value: 'rgba(203, 145, 47, 0.30)' },
  { label: 'Green', value: 'rgba(68, 131, 97, 0.25)' },
  { label: 'Blue', value: 'rgba(51, 126, 169, 0.25)' },
  { label: 'Purple', value: 'rgba(144, 101, 176, 0.25)' },
  { label: 'Pink', value: 'rgba(193, 76, 138, 0.20)' },
  { label: 'Red', value: 'rgba(212, 76, 71, 0.25)' },
];

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
