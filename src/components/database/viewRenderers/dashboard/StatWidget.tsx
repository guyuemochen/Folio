import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DatabaseRow, FilterNode } from '../../../../lib/types';
import { applyFilter, normalizeFilter } from '../../filterEngine';
import { WidgetFrame } from './WidgetFrame';

interface StatWidgetProps {
  /** Title for the frame header; empty falls back to a localized default. */
  title: string;
  /** Optional row filter; when null/undefined every row is counted. */
  filter?: FilterNode | null;
  /** All non-trashed rows of the database. */
  rows: DatabaseRow[];
}

/**
 * Big-number stat card. Counts the rows that pass `filter` (or all rows
 * when no filter is configured) and shows the count as a large numeral
 * with a localized "rows" unit label below.
 *
 * MVP scope: count only — no breakdown, no sparkline, no comparison. The
 * data flow is the closed-loop demo (rows → filter → number → screen).
 */
export function StatWidget({ title, filter, rows }: StatWidgetProps) {
  const { t } = useTranslation();
  const count = useMemo(
    () => applyFilter(rows, normalizeFilter(filter ?? null)).length,
    [rows, filter],
  );
  const headerTitle = title || t('database.dashboard.untitledStat');
  const unitLabel = t('database.dashboard.statUnitRows', { count });
  return (
    <WidgetFrame title={headerTitle}>
      <div className="flex flex-col items-center justify-center h-full px-3 py-2">
        <span className="text-3xl font-semibold text-text-primary tabular-nums leading-none">
          {count}
        </span>
        <span className="mt-1 text-xs text-text-tertiary">{unitLabel}</span>
      </div>
    </WidgetFrame>
  );
}
