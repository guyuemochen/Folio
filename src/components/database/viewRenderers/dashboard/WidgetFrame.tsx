import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

interface WidgetFrameProps {
  /** Title shown in the header. Falls back to a localized default if empty. */
  title: string;
  /** Children rendered in the body (below the header). */
  children: ReactNode;
  /** Click handler for the × button. When omitted the × is hidden (e.g.
   *  in read-only contexts). */
  onRemove?: () => void;
}

/**
 * Visual chrome shared by every dashboard widget: a rounded card with a
 * header strip (title + remove button) and a body slot.
 *
 * Drag and resize handles are provided externally by ReactGridLayout — this
 * component intentionally does not render them, so the same frame works
 * inside and outside the grid (e.g. in a future preview pane).
 *
 * The body fills the remaining height so widgets can use `h-full` to size
 * their content (charts, scroll areas) to whatever the user resized to.
 */
export function WidgetFrame({ title, children, onRemove }: WidgetFrameProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full rounded-md border border-border-hairline bg-bg-page overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-hairline bg-bg-section/50">
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {title}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('database.dashboard.removeWidget')}
            title={t('database.dashboard.removeWidget')}
            className="text-text-tertiary hover:text-status-red text-sm leading-none px-1 transition-colors"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
