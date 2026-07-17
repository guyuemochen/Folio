import { memo, useCallback, useMemo } from 'react';
import type { DatabaseRow, PropertyDef } from '../../../lib/types';
import type { ViewRendererProps } from './types';
import { useVisibleRows } from './shared';

/**
 * List view — one flat row per record. Lighter than the table: no column
 * headers, no inline cell editing. Each row shows the page icon + title +
 * a short summary of the first few non-title, non-hidden properties, and
 * opens the row page on click. Useful for journal / outline databases.
 *
 * Layout / interaction spec lives in the Phase 2 task brief; this is the
 * simplest of the alt renderers by design.
 */

/** Number of prominent non-title properties shown after the title. */
const MAX_SUMMARY_PROPS = 3;

/** Fallback emoji when the row has no icon of its own. */
const FALLBACK_ICON = '\u{1F4C4}'; // 📄

export function ListView({ view, schema, rows, onOpenRow, onAddRow }: ViewRendererProps) {
  const visibleRows = useVisibleRows(rows, view);

  // Stable prop list for the rows. Skipping the title prop here is correct —
  // the title is rendered in its own slot, so we don't want it duplicated
  // in the summary. Hidden props are also skipped so the list matches what
  // the user sees in the table view.
  const summaryProps = useMemo(() => {
    const hidden = new Set(view.hiddenProperties ?? []);
    return schema.properties
      .filter((p) => p.type !== 'title' && !hidden.has(p.id))
      .slice(0, MAX_SUMMARY_PROPS);
  }, [schema.properties, view.hiddenProperties]);

  const handleOpen = useCallback((pageId: string) => onOpenRow(pageId), [onOpenRow]);

  // Empty state. Centered, with the primary action (add a record) reachable.
  if (visibleRows.length === 0) {
    // TODO i18n: database.listEmpty
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <p className="text-sm text-text-secondary mb-1">No records</p>
        <p className="text-[12px] text-text-tertiary mb-4">Click + to add a record.</p>
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-accent text-bg-page hover:opacity-90 transition-opacity"
        >
          <span aria-hidden>+</span>
          {/* TODO i18n: database.newRow (reuse) */}
          <span>New</span>
        </button>
      </div>
    );
  }

  // TODO i18n: database.recordsCount_one / database.recordsCount_other
  const countLabel = `${visibleRows.length} record${visibleRows.length === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col">
      {/* Sticky header bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between h-9 px-3 bg-bg-page border-b border-border-hairline">
        <span className="text-[12px] text-text-secondary">{countLabel}</span>
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-accent hover:bg-bg-hover transition-colors"
        >
          <span aria-hidden>+</span>
          {/* TODO i18n: database.newRow (reuse) */}
          <span>New</span>
        </button>
      </div>

      {/* Scrollable body — same perf budget as the table view (max-h-[70vh]). */}
      <div className="max-h-[70vh] overflow-y-auto">
        {visibleRows.map((row) => (
          <ListRow
            key={row.id}
            row={row}
            summaryProps={summaryProps}
            onOpen={handleOpen}
          />
        ))}
      </div>
    </div>
  );
}

interface ListRowProps {
  row: DatabaseRow;
  summaryProps: PropertyDef[];
  onOpen: (pageId: string) => void;
}

const ListRow = memo(function ListRow({ row, summaryProps, onOpen }: ListRowProps) {
  const open = useCallback(() => onOpen(row.id), [onOpen, row.id]);

  // Enter / Space activate the row for keyboard users (role="button").
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
    [open],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      // TODO i18n: database.openRowAria ({{title}})
      aria-label={`Open ${row.title || 'Untitled'}`}
      className="group flex items-center gap-2 h-9 px-3 cursor-pointer rounded-[4px] hover:bg-bg-hover focus:outline-none focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors"
    >
      <span className="flex-shrink-0 w-6 text-center text-[14px] leading-none" aria-hidden>
        {row.icon ?? FALLBACK_ICON}
      </span>

      <span className="flex-1 min-w-0 text-[13px] text-text-primary font-medium truncate">
        {/* TODO i18n: common.untitled (reuse) */}
        {row.title || 'Untitled'}
      </span>

      {/* Property summary — always visible (only the timestamp is hover-only). */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {summaryProps.map((prop) => {
          const text = formatPropertyValue(prop, row.properties[prop.id]);
          if (!text) return null;
          return (
            <span
              key={prop.id}
              className="text-[12px] text-text-tertiary max-w-[180px] truncate"
            >
              <span className="opacity-80">{prop.name}:</span>{' '}
              <span>{text}</span>
            </span>
          );
        })}
      </div>

      {/* Relative timestamp — only revealed on hover, far right. */}
      <span className="flex-shrink-0 w-14 text-right text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
        {formatRelativeTime(row.updatedAt)}
      </span>
    </div>
  );
});

// ============================================================================
// Pure property formatters
//
// These duplicate a subset of the formatting logic from PropertyCells.tsx so
// the list renderer stays decoupled from the cell editors (which own live
// editing UX we don't need here). Keep them small and pure.
// ============================================================================

function formatPropertyValue(prop: PropertyDef, value: unknown): string {
  if (value == null) return '';
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return typeof value === 'string' ? value : '';
    case 'number':
      return formatNumber(value, prop.numberFormat ?? 'integer');
    case 'select':
    case 'status':
      return optionLabel(prop, value);
    case 'multi_select': {
      if (!Array.isArray(value)) return '';
      return value
        .map((v) => optionLabel(prop, v))
        .filter(Boolean)
        .join(', ');
    }
    case 'date':
      return typeof value === 'string' ? formatDate(value) : '';
    case 'checkbox':
      return value === true ? '\u2713' : '\u25A1'; // ✓ / □
    case 'url':
      return typeof value === 'string' ? domainOf(value) : '';
    case 'files':
      return Array.isArray(value)
        ? `${value.length} file${value.length === 1 ? '' : 's'}`
        : '';
    case 'person':
      // Mirrors PersonCell's MVP convention (single fixed value "Me").
      return value === 'Me' ? 'Me' : '';
    default:
      return '';
  }
}

function optionLabel(prop: PropertyDef, value: unknown): string {
  if (typeof value !== 'string') return '';
  return prop.options?.find((o) => o.value === value)?.value ?? '';
}

function formatNumber(
  value: unknown,
  fmt: NonNullable<PropertyDef['numberFormat']>,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  switch (fmt) {
    case 'percent':
      return `${(value * 100).toLocaleString()}%`;
    case 'currency':
      // Currency code is intentionally omitted — backend doesn't track one and
      // we only need a display string for the summary chip.
      return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    case 'decimal':
      return value.toLocaleString(undefined, { maximumFractionDigits: 20 });
    case 'integer':
    default:
      return Math.round(value).toLocaleString();
  }
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDate(iso: string): string {
  // DateCell persists a `datetime-local`-shaped string; `Date` parses both it
  // and full ISO 8601. Bail out quietly on garbage so we just render nothing.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE_FORMATTER.format(d);
}

function domainOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

function formatRelativeTime(updatedAt: number): string {
  if (!Number.isFinite(updatedAt)) return '';
  const diffMs = Date.now() - updatedAt;
  if (diffMs < 0) return '';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
