import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
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

interface DropIndicator {
  top: number;
  left: number;
  width: number;
  height: number;
  /** 'solid' = sibling drop, 'dashed' = nested drop, 'vertical' = column split. */
  kind: 'sibling' | 'nested' | 'column';
}

type DropAction =
  | { kind: 'sibling'; insertAt: number }
  | { kind: 'column'; targetBlockPos: number; side: 'left' | 'right' }
  | { kind: 'nested'; parentListPos: number }
  | null;

interface DropTarget {
  indicator: DropIndicator | null;
  scrollHint: number;
  action: DropAction;
}

const IDLE: HandleState = { visible: false, blockPos: -1, top: 0 };

/**
 * Notion-style left-edge drag handle + drop indicator + multi-select (PRD §5.1.4).
 *
 * Behavior:
 *   - ⋮⋮ handle visible on hover or whenever the editor has caret focus
 *   - Click → opens BlockMenu
 *   - Drag (HTML5) → moves the source block; we draw a blue drop indicator:
 *       - solid horizontal line = sibling drop (between blocks)
 *       - dashed horizontal line = nested drop (within 28px of a list left edge)
 *       - solid vertical line = column split (drop beside another top-level block)
 *   - Multi-select: a 24px-wide box at the left edge of the editor lets the
 *     user drag a marquee over multiple top-level blocks. The handle attaches
 *     to the first selected block; dragging moves all selected.
 *   - Auto-scroll: when the indicator approaches the viewport top/bottom, the
 *     parent scroll container scrolls toward it, faster by distance.
 */
export function BlockDragHandle({ editor, containerRef }: BlockDragHandleProps) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState<HandleState>(IDLE);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());

  // Refs for the drag loop (kept out of state to avoid re-renders mid-drag).
  const dragSourceRef = useRef<number | null>(null);
  const lastScrollHintRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollDirRef = useRef(0);

  // === Hover/focus tracking for the handle position =====================
  useEffect(() => {
    const dom = editor.view.dom;
    if (!containerRef.current) return;

    const compute = (clientY: number): HandleState => {
      const container = containerRef.current;
      if (!container) return IDLE;
      const rect = dom.getBoundingClientRect();
      const posInfo = editor.view.posAtCoords({ left: rect.left + 16, top: clientY });
      if (!posInfo) return IDLE;
      let $pos = editor.state.doc.resolve(posInfo.pos);
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
        if (!editor.isFocused) setHandle(IDLE);
        return;
      }
      const next = compute(e.clientY);
      setHandle((prev) =>
        prev.blockPos === next.blockPos && prev.visible === next.visible ? prev : next,
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

  // === Drag start / drag over / drop ====================================
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (handle.blockPos < 0) return;
    setMenuRect(e.currentTarget.getBoundingClientRect());
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (handle.blockPos < 0) return;
    dragSourceRef.current = handle.blockPos;
    e.dataTransfer.setData('application/x-folio-block-pos', String(handle.blockPos));
    e.dataTransfer.effectAllowed = 'move';
    const nodeDom = editor.view.nodeDOM(handle.blockPos) as HTMLElement | null;
    if (nodeDom) {
      e.dataTransfer.setDragImage(nodeDom, 0, 0);
    }
  };

  const handleDragEnd = () => {
    dragSourceRef.current = null;
    setIndicator(null);
    stopAutoScroll();
  };

  // Native drop handlers attached via editor.view.dom.
  useEffect(() => {
    const dom = editor.view.dom;
    const container = containerRef.current;
    if (!container) return;

    const over = (e: DragEvent) => {
      if (dragSourceRef.current === null) return;
      const dt = e.dataTransfer;
      if (!dt) return;
      const isOurDrag = dt.types.includes('application/x-folio-block-pos');
      if (!isOurDrag) return;
      e.preventDefault();
      dt.dropEffect = 'move';

      const info = computeDropTarget(dom, container, e.clientX, e.clientY, editor);
      // Update auto-scroll.
      if (info.scrollHint !== lastScrollHintRef.current) {
        lastScrollHintRef.current = info.scrollHint;
        if (info.scrollHint === 0) {
          stopAutoScroll();
        } else {
          startAutoScroll(container, info.scrollHint);
        }
      }
      setIndicator(info.indicator);
    };
    const drop = (e: DragEvent) => {
      if (dragSourceRef.current === null) return;
      e.preventDefault();
      const info = computeDropTarget(dom, container, e.clientX, e.clientY, editor);
      const src = dragSourceRef.current;
      applyDrop(editor, info, src);
      handleDragEnd();
    };
    dom.addEventListener('dragover', over);
    dom.addEventListener('drop', drop);
    return () => {
      dom.removeEventListener('dragover', over);
      dom.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, containerRef]);

  // === Multi-select: clear block selection when the user clicks text ===
  // The marquee drag itself is initiated from the gutter overlay (see render),
  // so a mousedown landing on the editor content is always a text-editing
  // gesture — exit block-selection mode, like Notion.
  useEffect(() => {
    const dom = editor.view.dom;
    const onContentMouseDown = () => setSelectedBlocks(new Set());
    dom.addEventListener('mousedown', onContentMouseDown);
    return () => dom.removeEventListener('mousedown', onContentMouseDown);
  }, [editor]);

  // === Marquee multi-select, initiated from the left gutter ==============
  // The gutter lives in the page's left padding (outside the editor content),
  // so dragging there never collides with text-cursor placement. Sits below
  // the drag handle (z-30) so handle clicks still open the block menu.
  const handleGutterMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const startY = e.clientY;

    const marqueeEl = document.createElement('div');
    marqueeEl.className = 'ln-block-marquee';
    marqueeEl.style.position = 'absolute';
    marqueeEl.style.left = '0';
    marqueeEl.style.width = `${containerRect.width}px`;
    marqueeEl.style.pointerEvents = 'none';
    marqueeEl.style.zIndex = '20';
    container.appendChild(marqueeEl);
    drawMarquee(marqueeEl, startY, e.clientY, container);
    e.preventDefault();

    const onMove = (mv: MouseEvent) => {
      drawMarquee(marqueeEl, startY, mv.clientY, container);
      const selected = collectBlocksInRect(startY, mv.clientY, editor);
      setSelectedBlocks(new Set(selected));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (marqueeEl.parentNode) {
        marqueeEl.parentNode.removeChild(marqueeEl);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // === Cleanup auto-scroll on unmount ===================================
  useEffect(() => {
    return () => stopAutoScroll();
  }, []);

  function stopAutoScroll() {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    autoScrollDirRef.current = 0;
    lastScrollHintRef.current = 0;
  }

  function startAutoScroll(container: HTMLElement, scrollHint: number) {
    stopAutoScroll();
    const scroller = findScrollParent(container);
    if (!scroller) return;
    autoScrollDirRef.current = scrollHint;
    const tick = () => {
      scroller.scrollTop += autoScrollDirRef.current;
      autoScrollRafRef.current = window.requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = window.requestAnimationFrame(tick);
  }

  return (
    <>
      {/* Left gutter overlay — hosts marquee multi-select in the page's left
          padding. Always mounted so the marquee is available even before the
          drag handle appears. Sits below the handle (z-30) so ⋮⋮ clicks still
          open the block menu. Width matches PageView's `px-10` (40px). */}
      <div
        className="ln-block-gutter"
        style={{
          position: 'absolute',
          left: -40,
          top: 0,
          bottom: 0,
          width: 40,
          zIndex: 5,
        }}
        onMouseDown={handleGutterMouseDown}
      />

      {/* Selection highlight backgrounds for multi-selected blocks */}
      {Array.from(selectedBlocks).map((pos) => {
        const nodeDom = editor.view.nodeDOM(pos) as HTMLElement | null;
        if (!nodeDom) return null;
        const rect = nodeDom.getBoundingClientRect();
        const c = containerRef.current?.getBoundingClientRect();
        if (!c) return null;
        return (
          <div
            key={`sel-${pos}`}
            className="ln-block-selected"
            style={{
              position: 'absolute',
              top: rect.top - c.top,
              left: rect.left - c.left,
              width: rect.width,
              height: rect.height,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        );
      })}

      {/* Drag handle (⋮⋮) — only while hovered/focused on a block */}
      {handle.visible && (
        <div
          className="absolute z-30 left-[-36px] flex items-center justify-center w-6 h-6 cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-primary transition-colors"
          style={{ top: handle.top }}
          title={t('editor.dragHandleTooltip')}
          contentEditable={false}
          onMouseDown={handleClick}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          draggable
        >
          <span className="text-[16px] leading-none select-none">⋮⋮</span>
        </div>
      )}

      {/* Drop indicator */}
      {indicator && (
        <div
          className={
            indicator.kind === 'column'
              ? 'ln-drop-indicator ln-drop-indicator-column'
              : indicator.kind === 'nested'
                ? 'ln-drop-indicator ln-drop-indicator-nested'
                : 'ln-drop-indicator ln-drop-indicator-sibling'
          }
          style={{
            position: 'absolute',
            top: indicator.top,
            left: indicator.left,
            width: indicator.width,
            height: indicator.height,
            pointerEvents: 'none',
            zIndex: 25,
          }}
        />
      )}

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

// === Drop target computation ===========================================

/**
 * Compute the drop indicator + action for the current mouse position.
 * Side effects: none (pure).
 */
function computeDropTarget(
  dom: HTMLElement,
  container: HTMLElement,
  clientX: number,
  clientY: number,
  editor: Editor,
): DropTarget {
  const rect = dom.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  // Auto-scroll hint when near viewport edges (within 80px).
  let scrollHint = 0;
  const margin = 80;
  if (clientY < margin) scrollHint = -Math.ceil(((margin - clientY) / margin) * 12);
  else if (clientY > window.innerHeight - margin) {
    scrollHint = Math.ceil(((clientY - (window.innerHeight - margin)) / margin) * 12);
  }

  // Locate the drop block.
  const posInfo = editor.view.posAtCoords({
    left: Math.max(rect.left + 8, Math.min(rect.right - 8, clientX)),
    top: clientY,
  });
  if (!posInfo) return { indicator: null, scrollHint, action: null };

  let $pos = editor.state.doc.resolve(posInfo.pos);
  if ($pos.depth > 0) {
    $pos = editor.state.doc.resolve($pos.before(1));
  }
  const blockPos = $pos.pos;
  if (blockPos < 0) return { indicator: null, scrollHint, action: null };

  const nodeDom = editor.view.nodeDOM(blockPos) as HTMLElement | null;
  if (!nodeDom) return { indicator: null, scrollHint, action: null };
  const blockRect = nodeDom.getBoundingClientRect();
  const midY = blockRect.top + blockRect.height / 2;

  // Column split: drop on left/right ~25% of a top-level block.
  if (clientY >= blockRect.top + 4 && clientY <= blockRect.bottom - 4) {
    const distFromLeft = clientX - blockRect.left;
    const distFromRight = blockRect.right - clientX;
    if (
      distFromLeft < blockRect.width * 0.25 ||
      distFromRight < blockRect.width * 0.25
    ) {
      const side: 'left' | 'right' = distFromLeft < distFromRight ? 'left' : 'right';
      const indicator: DropIndicator = {
        kind: 'column',
        top: blockRect.top - containerRect.top,
        left:
          side === 'left'
            ? blockRect.left - containerRect.left - 1
            : blockRect.right - containerRect.left + 1,
        width: 2,
        height: blockRect.height,
      };
      return {
        indicator,
        scrollHint,
        action: { kind: 'column', targetBlockPos: blockPos, side },
      };
    }
  }

  // Nested drop — only over a list (LI / UL / OL) when 28px+ from its left edge.
  const isListContainer = nodeDom.tagName === 'LI' || !!nodeDom.querySelector('ul,ol');
  const distFromLeft = clientX - blockRect.left;
  if (isListContainer && distFromLeft >= 28 && clientY < midY) {
    const indicator: DropIndicator = {
      kind: 'nested',
      top: blockRect.top - containerRect.top - 1,
      left: blockRect.left - containerRect.left + 28,
      width: blockRect.width - 28,
      height: 2,
    };
    return {
      indicator,
      scrollHint,
      action: { kind: 'nested', parentListPos: blockPos },
    };
  }

  // Sibling drop — line above or below depending on Y.
  const above = clientY < midY;
  const sourceNode = editor.state.doc.nodeAt(blockPos);
  const sourceSize = sourceNode?.nodeSize ?? 0;
  const indicatorTop = above
    ? blockRect.top - containerRect.top - 1
    : blockRect.bottom - containerRect.top + 1;
  const indicator: DropIndicator = {
    kind: 'sibling',
    top: indicatorTop,
    left: blockRect.left - containerRect.left,
    width: blockRect.width,
    height: 2,
  };
  return {
    indicator,
    scrollHint,
    action: {
      kind: 'sibling',
      insertAt: above ? blockPos : blockPos + sourceSize,
    },
  };
}

/** Walk up the DOM looking for the nearest vertically-scrollable ancestor. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Apply the computed drop action — move the dragged node into place. */
function applyDrop(editor: Editor, target: DropTarget, sourceBlockPos: number) {
  if (!target.action) return;
  const sourceNode = editor.state.doc.nodeAt(sourceBlockPos);
  if (!sourceNode) return;
  const sourceJson = sourceNode.toJSON();
  const sourceSize = sourceNode.nodeSize;

  if (target.action.kind === 'column') {
    const targetPos = target.action.targetBlockPos;
    const targetNode = editor.state.doc.nodeAt(targetPos);
    if (!targetNode) return;
    const targetJson = targetNode.toJSON();
    const targetSize = targetNode.nodeSize;

    // Order matters: build the columns wrapper, then replace target with it,
    // then delete the original source (in whichever order avoids offset bugs).
    const tr = editor.state.tr;
    const schema = editor.state.schema;
    // Step 1: delete source first if source is BEFORE target so target pos
    // doesn't shift on insert.
    const srcBeforeTarget = sourceBlockPos < targetPos;
    if (srcBeforeTarget) {
      tr.delete(sourceBlockPos, sourceBlockPos + sourceSize);
      const shiftedTargetPos = targetPos - sourceSize;
      tr.delete(shiftedTargetPos, shiftedTargetPos + targetSize);
      const left = target.action.side === 'left' ? [sourceJson] : [targetJson];
      const right = target.action.side === 'left' ? [targetJson] : [sourceJson];
      tr.insert(shiftedTargetPos, schema.nodeFromJSON(buildColumns(left, right)));
    } else {
      tr.delete(targetPos, targetPos + targetSize);
      const shiftedSourcePos = sourceBlockPos - targetSize;
      tr.delete(shiftedSourcePos, shiftedSourcePos + sourceSize);
      const left = target.action.side === 'left' ? [sourceJson] : [targetJson];
      const right = target.action.side === 'left' ? [targetJson] : [sourceJson];
      tr.insert(targetPos, schema.nodeFromJSON(buildColumns(left, right)));
    }
    editor.view.dispatch(tr);
    return;
  }

  if (target.action.kind === 'nested') {
    // Best-effort nested drop: insert source as first child of the target list.
    const tr = editor.state.tr;
    const schema = editor.state.schema;
    // Delete source first if it's before the target.
    if (sourceBlockPos < target.action.parentListPos) {
      tr.delete(sourceBlockPos, sourceBlockPos + sourceSize);
      const shiftedTarget = target.action.parentListPos - sourceSize;
      tr.insert(shiftedTarget + 1, schema.nodeFromJSON(sourceJson));
    } else {
      tr.insert(target.action.parentListPos + 1, schema.nodeFromJSON(sourceJson));
      // Source position shifted by +sourceSize because of insert above.
      tr.delete(sourceBlockPos + sourceSize, sourceBlockPos + sourceSize + sourceSize);
    }
    editor.view.dispatch(tr);
    return;
  }

  // sibling drop
  const insertAt = target.action.insertAt;
  const tr = editor.state.tr;
  const schema = editor.state.schema;
  if (sourceBlockPos < insertAt) {
    // Source is before insert point — delete first, then insert at shifted position.
    tr.delete(sourceBlockPos, sourceBlockPos + sourceSize);
    const shifted = insertAt - sourceSize;
    tr.insert(shifted, schema.nodeFromJSON(sourceJson));
  } else {
    tr.insert(insertAt, schema.nodeFromJSON(sourceJson));
    tr.delete(sourceBlockPos + sourceSize, sourceBlockPos + sourceSize + sourceSize);
  }
  editor.view.dispatch(tr);
}

function buildColumns(left: unknown[], right: unknown[]): unknown {
  return {
    type: 'columns',
    content: [
      { type: 'column', content: left },
      { type: 'column', content: right },
    ],
  };
}

// === Marquee selection helpers =========================================

function drawMarquee(el: HTMLDivElement, startY: number, currentY: number, container: HTMLElement) {
  const c = container.getBoundingClientRect();
  const top = Math.min(startY, currentY) - c.top;
  const height = Math.abs(currentY - startY);
  el.style.top = `${top}px`;
  el.style.height = `${height}px`;
  el.style.background = 'rgba(35, 131, 226, 0.10)';
  el.style.border = '1px solid rgba(35, 131, 226, 0.35)';
}

function collectBlocksInRect(startY: number, currentY: number, editor: Editor): number[] {
  const top = Math.min(startY, currentY);
  const bottom = Math.max(startY, currentY);
  const out: number[] = [];
  // Walk top-level blocks; resolve absolute positions.
  let pos = 0;
  editor.state.doc.forEach((child: PmNode) => {
    const childStart = pos + 1; // content starts at +1 (doc is at 0)
    void child;
    const nodeDom = editor.view.nodeDOM(childStart) as HTMLElement | null;
    if (nodeDom) {
      const r = nodeDom.getBoundingClientRect();
      if (r.bottom >= top && r.top <= bottom) {
        out.push(childStart);
      }
    }
    pos += child.nodeSize;
  });
  return out;
}
