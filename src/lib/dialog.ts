import { useEffect, useRef } from 'react';

interface DialogOptions {
  /** Called when the user requests dismissal (Escape key). */
  onClose: () => void;
  /** Accessible name for the dialog (passed through i18n). */
  label: string;
  /**
   * CSS selector for the element that should receive initial focus.
   * Defaults to the first focusable element inside the container.
   */
  initialFocusSelector?: string;
}

/** Elements that participate in Tab cycling. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

/**
 * Unified accessibility behavior for modal dialogs (PRD §10.4).
 *
 * Provides:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-label`
 *   - Escape to close (replaces per-modal keydown handlers)
 *   - Tab / Shift+Tab focus trap (stays inside the dialog)
 *   - Initial focus on the first focusable element (or `initialFocusSelector`)
 *   - Focus restore to the triggering element on close
 *   - Background scroll lock while open
 *
 * Spread `containerProps` onto the inner dialog element (NOT the backdrop):
 *
 *   const dialog = useDialog({ onClose, label: t('search.title') });
 *   return createPortal(
 *     <div className="backdrop" onClick={backdropClose}>
 *       <div {...dialog.containerProps} className="dialog-card">…</div>
 *     </div>,
 *     document.body,
 *   );
 *
 * Note: arrow-key navigation (e.g. SearchModal ↑↓) is intentionally NOT
 * intercepted — only Tab and Escape are handled here.
 */
export function useDialog({ onClose, label, initialFocusSelector }: DialogOptions) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Remember what was focused before opening so we can return to it.
    const previousFocus = document.activeElement as HTMLElement | null;

    const initial = initialFocusSelector
      ? container.querySelector<HTMLElement>(initialFocusSelector)
      : container.querySelector<HTMLElement>(FOCUSABLE);
    // Focus the container itself as a fallback so focus is at least inside.
    if (initial) {
      initial.focus();
    } else {
      container.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    container.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      container.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the element that opened the dialog.
      previousFocus?.focus?.();
    };
  }, [onClose, initialFocusSelector]);

  const containerProps = {
    ref: containerRef,
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-label': label,
    tabIndex: -1,
  };

  return { containerProps };
}
