import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DatabaseRow,
  FilterNode,
  SortEntry,
} from '../../../../lib/types';
import { applyFilter, normalizeFilter } from '../../filterEngine';
import { applySorts } from '../shared';
import { WidgetFrame } from './WidgetFrame';

interface RecentRowsWidgetProps {
  title: string;
  filter?: FilterNode | null;
  sort?: SortEntry[] | null;
  /** Max rows to display; defaults to 10. */
  limit?: number;
  rows: DatabaseRow[];
  /** Open a row's full page. */
  onOpenRow?: (pageId: string) => void;
  /** Optional × button handler; when omitted the frame hides the button. */
  onRemove?: () => void;
}

/**
 * Compact list of the most recently updated rows. Default behaviour:
 * apply the widget's filter (if any), apply explicit sorts (if any),
 * otherwise fall back to "most recently updated first", then take the
 * first `limit` rows.
 *
 * Each row renders as a single line: icon + title, with a relative-ish
 * timestamp on the right. The whole row is a button when `onOpenRow` is
 * provided, otherwise static text.
 */
export function RecentRowsWidget({
  title,
  filter,
  sort,
  limit = 10,
  rows,
  onOpenRow,
  onRemove,
}: RecentRowsWidgetProps) {
  const { t } = useTranslation();
  const headerTitle = title || t('database.dashboard.untitledRecentRows');

  const visible = useMemo(() => {
    const filtered = applyFilter(rows, normalizeFilter(filter ?? null));
    const sorted =
      sort && sort.length > 0
        ? applySorts(filtered, sort)
        : // Default: most recently updated first. Stable on the prior order
          // so rows with identical timestamps keep their positions.
          [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.slice(0, Math.max(0, limit));
  }, [rows, filter, sort, limit]);

  return (
    <WidgetFrame title={headerTitle} onRemove={onRemove}>
      {visible.length === 0 ? (
        <div className="flex items-center justify-center h-full text-xs text-text-tertiary px-3 text-center">
          {t('database.dashboard.noRows')}
        </div>
      ) : (
        <ul className="h-full overflow-y-auto divide-y divide-border-hairline">
          {visible.map((row) => (
            <li key={row.id}>
              <RowButton row={row} onOpenRow={onOpenRow} />
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

function RowButton({
  row,
  onOpenRow,
}: {
  row: DatabaseRow;
  onOpenRow?: (pageId: string) => void;
}) {
  const dateLabel = useMemo(() => formatRelativeTime(row.updatedAt), [row.updatedAt]);
  const content = (
    <>
      <span className="shrink-0 text-sm" aria-hidden>
        {row.icon ?? '📄'}
      </span>
      <span className="truncate text-sm text-text-primary flex-1">
        {row.title || 'Untitled'}
      </span>
      <span className="shrink-0 text-[11px] text-text-tertiary tabular-nums">
        {dateLabel}
      </span>
    </>
  );
  if (onOpenRow) {
    return (
      <button
        type="button"
        onClick={() => onOpenRow(row.id)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover transition-colors"
      >
        {content}
      </button>
    );
  }
  return <div className="flex items-center gap-2 px-3 py-1.5">{content}</div>;
}

/**
 * Compact relative time: "<1m", "12m", "3h", "2d", then falls back to
 * M/D. Keeps the widget dense; full timestamp is on the row's page.
 */
function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  if (diffMs < 60_000) return '<1m';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
