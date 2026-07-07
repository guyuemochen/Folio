import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  const [pos, setPos] = useState<ComputedPos | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const padding = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Measure the popover's real rendered height so flip / clamping decisions
    // match the actual content. The previous hard-coded `360` estimate caused
    // popovers with short content (e.g. select option lists) to be flipped
    // above the anchor and pushed far off because `top = anchorRect.top -
    // offset - 360` subtracted far more than the real height.
    const measured = popRef.current?.offsetHeight ?? 360;

    let top: number;
    let left: number;

    // Vertical placement
    const below = anchorRect.bottom + offset;
    const above = anchorRect.top - offset - measured;
    const hasRoomBelow = below + measured < vh - padding;
    const hasRoomAbove = above > padding;

    const wantsTop = placement.startsWith('top');
    if (wantsTop && hasRoomAbove) {
      top = above;
    } else if (hasRoomBelow || !hasRoomAbove) {
      top = below;
    } else {
      top = above;
    }

    // Vertical clamp — never let the popover spill outside the viewport.
    // This matters for tall popovers (e.g. PropertyMenu with options editor)
    // where placing `top = anchorRect.bottom + offset` would otherwise push
    // the popover's bottom edge past the page.
    if (top + measured > vh - padding) top = vh - padding - measured;
    if (top < padding) top = padding;

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
      ref={popRef}
      data-popover-root
      className="fixed z-[1000] rounded-lg border border-border-hairline bg-bg-page shadow-popover"
      style={{
        // Hold the popover off-screen (but laid out, so offsetHeight is real)
        // until the first measurement completes. useLayoutEffect runs before
        // paint, so users never see this fallback position.
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        // Cap height to the viewport and scroll inside if content is taller
        // (e.g. a select list with many options, or PropertyMenu with the
        // options editor open). Paired with the vertical clamp above, this
        // guarantees the popover can never exceed the page.
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
