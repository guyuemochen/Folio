import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal-rendered popover with viewport-aware positioning.
 *
 * Why: tables and other containers with `overflow: auto` clip absolute-positioned
 * children. This component renders into `document.body` via React Portal and
 * computes fixed coordinates from a trigger anchor's bounding rect.
 *
 * Placement strategy:
 *   1. Try the requested `placement` (default 'bottom-start').
 *   2. If it overflows the viewport, flip on the relevant axis.
 *   3. Clamp left/right so the popover never spills horizontally.
 */

export type PopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom-center'
  | 'top-start'
  | 'top-end';

interface PopoverProps {
  /** Anchor rectangle (typically from event.currentTarget.getBoundingClientRect()). */
  anchorRect: DOMRect;
  /** Preferred placement; flipped automatically on overflow. */
  placement?: PopoverPlacement;
  /** Offset from anchor in pixels (default 6). */
  offset?: number;
  /** Popover width in pixels (used for clamping). */
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

interface ComputedPos {
  top: number;
  left: number;
}

export function Popover({
  anchorRect,
  placement = 'bottom-start',
  offset = 6,
  width = 288,
  onClose,
  children,
}: PopoverProps) {
  const [pos, setPos] = useState<ComputedPos>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const padding = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedHeight = 360; // conservative; real height measured by browser

    let top: number;
    let left: number;

    // Vertical placement
    const below = anchorRect.bottom + offset;
    const above = anchorRect.top - offset - estimatedHeight;
    const hasRoomBelow = below + estimatedHeight < vh - padding;
    const hasRoomAbove = above > padding;

    const wantsTop = placement.startsWith('top');
    if (wantsTop && hasRoomAbove) {
      top = above;
    } else if (hasRoomBelow || !hasRoomAbove) {
      top = below;
    } else {
      top = above;
    }

    // Horizontal placement
    const center = anchorRect.left + anchorRect.width / 2;
    switch (placement) {
      case 'bottom-start':
      case 'top-start':
        left = anchorRect.left;
        break;
      case 'bottom-end':
      case 'top-end':
        left = anchorRect.right - width;
        break;
      case 'bottom-center':
        left = center - width / 2;
        break;
    }

    // Clamp horizontally into viewport
    if (left < padding) left = padding;
    if (left + width > vw - padding) left = vw - padding - width;

    setPos({ top, left });
  }, [anchorRect, placement, offset, width]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Close on outside mousedown
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // The popover subtree is marked with data-popover-root
      if (!target.closest('[data-popover-root]')) {
        onClose();
      }
    };
    // Defer by one tick so the click that opened the popover doesn't close it
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onMouseDown);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      data-popover-root
      className="fixed z-[1000] rounded-lg border border-border-hairline bg-bg-page shadow-popover"
      style={{ top: pos.top, left: pos.left, width }}
    >
      {children}
    </div>,
    document.body,
  );
}
