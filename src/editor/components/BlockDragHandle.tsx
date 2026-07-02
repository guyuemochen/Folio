import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BlockMenu } from './BlockMenu';

interface BlockDragHandleProps {
  editor: Editor;
  /** Container element (the wrapping div around EditorContent). Used for relative positioning. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface HandleState {
  visible: boolean;
  /** ProseMirror position at the start of the block being hovered/focused. */
  blockPos: number;
  /** Pixel offset from container top. */
  top: number;
}

const IDLE: HandleState = { visible: false, blockPos: -1, top: 0 };

/**
 * Notion-style left-edge drag handle that follows hover/focus.
 *
 * Behavior:
 *   - Visible whenever the mouse is over a top-level block in the editor.
 *   - Also visible when the editor has caret focus (sticks to the current block).
 *   - Click → opens BlockMenu (Duplicate / Turn into / Delete / Copy link).
 *   - Drag (HTML5) → starts native drag with the block's source DOM as drag image.
 *     Drop into the editor at any position moves the block (handled by
 *     ProseMirror's built-in drop logic when the source node is set as
 *     draggable).
 *
 * Position is computed by walking DOM coordinates → ProseMirror position
 * → back to the block's DOM node, so it follows scroll/resize correctly.
 */
export function BlockDragHandle({ editor, containerRef }: BlockDragHandleProps) {
  const [handle, setHandle] = useState<HandleState>(IDLE);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    if (!containerRef.current) return;

    const compute = (clientY: number): HandleState => {
      const container = containerRef.current;
      if (!container) return IDLE;

      // Find PM position at the start of the line at this Y.
      // We use a left offset of 16px inside the editor to find the block reliably.
      const rect = dom.getBoundingClientRect();
      const posInfo = editor.view.posAtCoords({
        left: rect.left + 16,
        top: clientY,
      });
      if (!posInfo) return IDLE;

      let $pos = editor.state.doc.resolve(posInfo.pos);
      // Walk back to the top-level block start.
      if ($pos.depth > 0) {
        $pos = editor.state.doc.resolve($pos.before(1));
      }
      const blockPos = $pos.pos;
      if (blockPos < 0) return IDLE;

      const nodeDom = editor.view.nodeDOM(blockPos) as HTMLElement | null;
      if (!nodeDom) return IDLE;

      const blockRect = nodeDom.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        visible: true,
        blockPos,
        top: blockRect.top - containerRect.top + (blockRect.height - 16) / 2,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !dom.contains(target)) {
        // Outside editor — keep handle visible if editor has focus
        if (!editor.isFocused) setHandle(IDLE);
        return;
      }
      const next = compute(e.clientY);
      // Avoid spurious re-renders: only update if the block changed
      setHandle((prev) =>
        prev.blockPos === next.blockPos && prev.visible === next.visible
          ? prev
          : next,
      );
    };

    const onMouseLeave = () => {
      if (!editor.isFocused) setHandle(IDLE);
    };

    dom.addEventListener('mousemove', onMouseMove);
    dom.addEventListener('mouseleave', onMouseLeave);
    return () => {
      dom.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [editor, containerRef]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (handle.blockPos < 0) return;
    setMenuRect(e.currentTarget.getBoundingClientRect());
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (handle.blockPos < 0) return;
    // Set drag data — ProseMirror's drop handler looks for text/html or
    // text/plain, but we use a custom MIME so our editor can recognize
    // the source and do a move instead of a copy.
    e.dataTransfer.setData('application/x-folio-block-pos', String(handle.blockPos));
    e.dataTransfer.effectAllowed = 'move';

    const nodeDom = editor.view.nodeDOM(handle.blockPos) as HTMLElement | null;
    if (nodeDom) {
      e.dataTransfer.setDragImage(nodeDom, 0, 0);
    }
  };

  if (!handle.visible && !menuRect) return null;

  return (
    <>
      <div
        className="absolute z-30 left-[-36px] flex items-center justify-center w-6 h-6 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-primary transition-colors"
        style={{ top: handle.top }}
        title="Drag to move · Click for actions"
        contentEditable={false}
        onMouseDown={handleClick}
        onDragStart={handleDragStart}
        draggable
      >
        <span className="text-[16px] leading-none select-none">⋮⋮</span>
      </div>

      {menuRect && handle.blockPos >= 0 && (
        <BlockMenu
          editor={editor}
          blockPos={handle.blockPos}
          anchorRect={menuRect}
          onClose={() => setMenuRect(null)}
        />
      )}
    </>
  );
}
