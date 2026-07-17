import { memo, useMemo, useState } from 'react';
import type { DatabaseRow, PropertyDef } from '../../../lib/types';
import { pickPropertiesByType, useVisibleRows } from './shared';
import type { ViewRendererProps } from './types';

// ============================================================================
// Timeline (Gantt) view
// ----------------------------------------------------------------------------
// Plots each row as a horizontal bar between the first two `date` properties
// on the schema (start + end). Single-date schemas reuse that prop as end so
// every bar is a 1-day-wide point. Day / Week / Month zoom changes the pixel
// width per day; Prev / Next / Today move the window. A vertical accent line
// marks today; weekend columns get a subtle background band. Bars are
// click-to-open and read-only.
//
// Frozen-pane layout: sticky left labels column + sticky top axis inside one
// scroll container keeps row titles and date headers pinned during pan.
//
// Follow-ups (out of MVP scope): drag bar body to shift start+end; drag bar
// edges to resize; per-view start/end prop selection; group-by-select rows.
// ============================================================================

// ---- Layout constants ------------------------------------------------------
const MONTH_AXIS_HEIGHT = 28;
const DAY_AXIS_HEIGHT = 28;
const AXIS_HEIGHT = MONTH_AXIS_HEIGHT + DAY_AXIS_HEIGHT;
const ROW_HEIGHT = 32;
const BAR_HEIGHT = 22;
const LABEL_WIDTH = 200;
const HALF_WINDOW = 45; // days on each side of centerDate → 91 days total
const SHIFT_DAYS = 30; // Prev / Next step

type Scale = 'day' | 'week' | 'month';
const DAY_WIDTH_BY_SCALE: Record<Scale, number> = { day: 30, week: 7, month: 1 };

const MS_PER_DAY = 86_400_000;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const UNTITLED = 'Untitled'; // TODO i18n: common.untitled

interface DateRange {
  start: Date; // local midnight, first visible day
  totalDays: number; // HALF_WINDOW * 2 + 1
}

// ---- Date helpers (local-midnight, timezone-safe) --------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** Whole-day difference `b - a`, both treated as local midnights. Date.UTC
 *  avoids DST-shift off-by-ones. */
function daysBetween(a: Date, b: Date): number {
  const aMid = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bMid = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bMid - aMid) / MS_PER_DAY);
}

/** Parse a `'YYYY-MM-DD'` value (the format `date` cells store, see
 *  PropertyCells DateCell) into a local-midnight Date. Builds from local
 *  components (not `new Date(iso)`, which parses as UTC and drifts a day in
 *  some zones) and validates the round-trip to reject `2026-02-31`. */
function parseISODate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isSafeInteger(y) || !Number.isSafeInteger(mo) || !Number.isSafeInteger(d)) return null;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

/** Format a local-midnight Date as `'YYYY-MM-DD'` (inverse of parseISODate,
 *  matching the DateCell contract). Used for React keys; the drag follow-up
 *  will reuse it to commit shifted dates via onCellChange. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function formatDisplayDate(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function buildRange(centerDate: Date): DateRange {
  return { start: addDays(startOfDay(centerDate), -HALF_WINDOW), totalDays: HALF_WINDOW * 2 + 1 };
}

interface MonthSpan { key: number; label: string; span: number; }

function buildMonthSpans(rangeStart: Date, totalDays: number): MonthSpan[] {
  const out: MonthSpan[] = [];
  let cursor = new Date(rangeStart);
  for (let i = 0; i < totalDays; i++) {
    const key = cursor.getFullYear() * 12 + cursor.getMonth();
    const last = out[out.length - 1];
    if (!last || last.key !== key) {
      out.push({ key, label: `${MONTHS_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}`, span: 1 });
    } else {
      last.span++;
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

interface AxisDay {
  key: string;
  dayInMonth: number;
  weekdayIdx: number;
  isWeekend: boolean;
  isToday: boolean;
}

function buildAxisDays(rangeStart: Date, totalDays: number, today: Date): AxisDay[] {
  const out: AxisDay[] = [];
  let cursor = new Date(rangeStart);
  for (let i = 0; i < totalDays; i++) {
    const weekdayIdx = cursor.getDay();
    out.push({
      key: toISODate(cursor),
      dayInMonth: cursor.getDate(),
      weekdayIdx,
      isWeekend: weekdayIdx === 0 || weekdayIdx === 6,
      isToday:
        cursor.getFullYear() === today.getFullYear() &&
        cursor.getMonth() === today.getMonth() &&
        cursor.getDate() === today.getDate(),
    });
    cursor = addDays(cursor, 1);
  }
  return out;
}

// ---- Memoized subcomponents ------------------------------------------------

/** One horizontal bar. `startOffsetDays` is relative to the visible range
 *  start and may be negative or extend past `totalDays` — the parent track
 *  clips overflow. `durationDays` is inclusive (start..end) and at least 1. */
const Bar = memo(function Bar({
  startOffsetDays,
  durationDays,
  dayWidth,
  title,
  startDate,
  endDate,
  rowId,
  onOpenRow,
}: {
  startOffsetDays: number;
  durationDays: number;
  dayWidth: number;
  title: string;
  startDate: Date;
  endDate: Date | null;
  rowId: string;
  onOpenRow: (pageId: string) => void;
}) {
  const left = startOffsetDays * dayWidth;
  const width = Math.max(dayWidth, durationDays * dayWidth);
  const parts = [title, `Start: ${formatDisplayDate(startDate)}`]; // TODO i18n: timeline.startLabel
  if (endDate) parts.push(`End: ${formatDisplayDate(endDate)}`); // TODO i18n: timeline.endLabel
  const tooltip = parts.join(' · ');
  return (
    <button
      type="button"
      onClick={() => onOpenRow(rowId)}
      title={tooltip}
      aria-label={tooltip}
      className="absolute top-1/2 -translate-y-1/2 rounded bg-accent text-white text-xs font-medium px-1.5 text-left overflow-hidden whitespace-nowrap hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors"
      style={{ left, width, height: BAR_HEIGHT }}
    >
      <span className="truncate block pointer-events-none">{title}</span>
    </button>
  );
});

const RowLabel = memo(function RowLabel({
  row,
  onOpenRow,
}: {
  row: DatabaseRow;
  onOpenRow: (pageId: string) => void;
}) {
  const label = row.title || UNTITLED;
  return (
    <button
      type="button"
      onClick={() => onOpenRow(row.id)}
      title={label}
      className="w-full flex items-center gap-1.5 px-2 text-left text-sm text-text-primary hover:bg-bg-hover transition-colors border-b border-border-hairline"
      style={{ height: ROW_HEIGHT }}
    >
      {row.icon ? (
        <span className="shrink-0 text-sm leading-none" aria-hidden>{row.icon}</span>
      ) : null}
      <span className="truncate">{label}</span>
    </button>
  );
});

const RowTrack = memo(function RowTrack({
  row,
  startProp,
  endProp,
  rangeStart,
  totalDays,
  dayWidth,
  onOpenRow,
}: {
  row: DatabaseRow;
  startProp: PropertyDef;
  endProp: PropertyDef;
  rangeStart: Date;
  totalDays: number;
  dayWidth: number;
  onOpenRow: (pageId: string) => void;
}) {
  const startDate = parseISODate(row.properties[startProp.id]);
  if (!startDate) {
    return (
      <div
        className="border-b border-border-hairline"
        style={{ height: ROW_HEIGHT, minWidth: totalDays * dayWidth }}
      />
    );
  }
  // Single-date schema → endProp === startProp → 1-day point. Missing or
  // pre-start end falls back to start so the bar still reads as a point.
  const sameProp = endProp.id === startProp.id;
  const rawEnd = sameProp ? null : parseISODate(row.properties[endProp.id]);
  const effectiveEnd = rawEnd && daysBetween(startDate, rawEnd) >= 0 ? rawEnd : null;
  const startOffsetDays = daysBetween(rangeStart, startDate);
  const durationDays = effectiveEnd ? daysBetween(startDate, effectiveEnd) + 1 : 1;
  return (
    <div
      className="relative border-b border-border-hairline overflow-hidden"
      style={{ height: ROW_HEIGHT, minWidth: totalDays * dayWidth }}
    >
      <Bar
        startOffsetDays={startOffsetDays}
        durationDays={durationDays}
        dayWidth={dayWidth}
        title={row.title || UNTITLED}
        startDate={startDate}
        endDate={effectiveEnd}
        rowId={row.id}
        onOpenRow={onOpenRow}
      />
    </div>
  );
});

const DateAxis = memo(function DateAxis({
  rangeStart,
  totalDays,
  dayWidth,
}: {
  rangeStart: Date;
  totalDays: number;
  dayWidth: number;
}) {
  const months = useMemo(() => buildMonthSpans(rangeStart, totalDays), [rangeStart, totalDays]);
  const days = useMemo(
    () => buildAxisDays(rangeStart, totalDays, startOfDay(new Date())),
    [rangeStart, totalDays],
  );
  // Below ~18px the day number + weekday abbrev overlap; show weekday only at
  // wide scales, the number alone at medium, and just the 1st / 10th at tiny.
  const showEveryDay = dayWidth >= 18;
  const showSparseDay = dayWidth >= 6;
  return (
    <div className="flex flex-col select-none">
      <div className="flex border-b border-border-hairline bg-bg-page" style={{ height: MONTH_AXIS_HEIGHT }}>
        {months.map((m, idx) => (
          <div
            // key combines month key with position so two spans of the same
            // calendar month (rare, across a year boundary) don't collide.
            key={`${m.key}-${idx}`}
            className="flex items-center px-1.5 text-[11px] font-semibold text-text-secondary border-r border-border-hairline truncate"
            style={{ width: m.span * dayWidth, minWidth: 0 }}
          >
            <span className="truncate">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="flex border-b border-border-hairline bg-bg-page" style={{ height: DAY_AXIS_HEIGHT }}>
        {days.map((d) => {
          const showNumber =
            showEveryDay || (showSparseDay && (d.dayInMonth === 1 || d.dayInMonth % 10 === 0));
          const tone = d.isToday
            ? 'bg-bg-active text-accent font-semibold'
            : d.isWeekend
              ? 'bg-bg-section/30 text-text-tertiary'
              : 'text-text-secondary';
          return (
            <div
              key={d.key}
              className={`flex flex-col items-center justify-center text-[10px] leading-tight border-r border-border-hairline ${tone}`}
              style={{ width: dayWidth, minWidth: 0 }}
            >
              {showNumber && <span className="tabular-nums">{d.dayInMonth}</span>}
              {showEveryDay && <span className="opacity-70">{WEEKDAYS_SHORT[d.weekdayIdx]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** One subtle background band per weekend day (Sat + Sun). pointer-events-none
 *  so bars stay clickable through it. */
const WeekendOverlay = memo(function WeekendOverlay({
  rangeStart,
  totalDays,
  dayWidth,
  bodyHeight,
}: {
  rangeStart: Date;
  totalDays: number;
  dayWidth: number;
  bodyHeight: number;
}) {
  const bands = useMemo(() => {
    const out: Array<{ left: number; key: string }> = [];
    let cursor = new Date(rangeStart);
    for (let i = 0; i < totalDays; i++) {
      const wd = cursor.getDay();
      if (wd === 0 || wd === 6) out.push({ left: i * dayWidth, key: toISODate(cursor) });
      cursor = addDays(cursor, 1);
    }
    return out;
  }, [rangeStart, totalDays, dayWidth]);
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {bands.map((b) => (
        <div
          key={b.key}
          className="absolute top-0 bg-bg-section/30"
          style={{ left: b.left, width: dayWidth, height: bodyHeight }}
        />
      ))}
    </div>
  );
});

/** Vertical accent line through every row track at today's column. Rendered
 *  only inside the body — the axis's today cell already gets bg-active. */
const TodayLine = memo(function TodayLine({
  rangeStart,
  dayWidth,
  bodyHeight,
}: {
  rangeStart: Date;
  dayWidth: number;
  bodyHeight: number;
}) {
  const offset = daysBetween(rangeStart, startOfDay(new Date()));
  const left = offset * dayWidth + Math.max(0, dayWidth - 2) / 2;
  return (
    <div
      className="absolute top-0 pointer-events-none bg-accent"
      style={{ left, width: 2, height: bodyHeight, boxShadow: '0 0 6px var(--color-accent)' }}
      aria-label="Today indicator" // TODO i18n: timeline.todayIndicator
    />
  );
});

// ---- Toolbar ---------------------------------------------------------------

function TimelineToolbar({
  centerDate,
  scale,
  onPrev,
  onNext,
  onToday,
  onScaleChange,
  onAddRow,
}: {
  centerDate: Date;
  scale: Scale;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onScaleChange: (s: Scale) => void;
  onAddRow: () => void;
}) {
  const monthLabel = `${MONTHS_SHORT[centerDate.getMonth()]} ${centerDate.getFullYear()}`;
  const navBtn =
    'w-7 h-7 inline-flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover transition-colors';
  const actionBtn =
    'px-2.5 py-1 rounded-md text-xs font-medium bg-bg-page border border-border-hairline hover:border-accent/40 hover:bg-bg-hover text-text-primary transition-colors';
  return (
    <div className="h-11 flex-shrink-0 flex items-center justify-between px-3 gap-3 border-b border-border-hairline">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onPrev} aria-label="Previous range" /* TODO i18n: timeline.prevRange */ className={navBtn}>
          <span aria-hidden>‹</span>
        </button>
        <span className="text-sm font-medium text-text-primary min-w-[88px] text-center tabular-nums">
          {monthLabel}
        </span>
        <button type="button" onClick={onNext} aria-label="Next range" /* TODO i18n: timeline.nextRange */ className={navBtn}>
          <span aria-hidden>›</span>
        </button>
      </div>
      <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-bg-section" role="group" aria-label="Zoom level" /* TODO i18n: timeline.zoomGroup */>
        {(['day', 'week', 'month'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onScaleChange(s)}
            aria-pressed={scale === s}
            className={[
              'px-2 py-0.5 text-xs rounded capitalize transition-colors',
              scale === s
                ? 'bg-bg-page text-text-primary font-medium shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {s /* TODO i18n: timeline.scaleDay / scaleWeek / scaleMonth */}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onToday} className={actionBtn}>
          Today{/* TODO i18n: common.today */}
        </button>
        <button type="button" onClick={onAddRow} className={`inline-flex items-center gap-1 ${actionBtn}`}>
          + <span>New</span>
          {/* TODO i18n: common.new */}
        </button>
      </div>
    </div>
  );
}

// ---- Main renderer ---------------------------------------------------------

export function TimelineView({
  view,
  schema,
  rows,
  onOpenRow,
  onAddRow,
}: ViewRendererProps) {
  const visibleRows = useVisibleRows(rows, view);
  const dateProps = useMemo(() => pickPropertiesByType(schema, 'date'), [schema]);
  const startProp = dateProps[0] ?? null;

  const [centerDate, setCenterDate] = useState<Date>(() => startOfDay(new Date()));
  const [scale, setScale] = useState<Scale>('day');

  const range = useMemo(() => buildRange(centerDate), [centerDate]);
  const dayWidth = DAY_WIDTH_BY_SCALE[scale];
  const canvasWidth = range.totalDays * dayWidth;

  // No date property on the schema → cannot plot anything.
  if (!startProp) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="text-sm font-medium text-text-primary mb-1">
          Timeline view needs Date properties
          {/* TODO i18n: timeline.needsDateProperties */}
        </div>
        <div className="text-xs text-text-tertiary max-w-sm">
          Add two Date properties (start + end) to this database to plot rows as bars on a timeline.
          {/* TODO i18n: timeline.needsDatePropertiesHint */}
        </div>
      </div>
    );
  }

  // Single-date schema → reuse start as end so every bar is a 1-day point.
  const endProp: PropertyDef = dateProps[1] ?? startProp;

  const toolbar = (
    <TimelineToolbar
      centerDate={centerDate}
      scale={scale}
      onPrev={() => setCenterDate((d) => addDays(d, -SHIFT_DAYS))}
      onNext={() => setCenterDate((d) => addDays(d, SHIFT_DAYS))}
      onToday={() => setCenterDate(startOfDay(new Date()))}
      onScaleChange={setScale}
      onAddRow={onAddRow}
    />
  );

  // Date properties exist but no rows survived filter / sort.
  if (visibleRows.length === 0) {
    return (
      <div className="flex flex-col">
        {toolbar}
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <div className="text-sm text-text-secondary mb-3">
            No events to show. Adjust filters or click + to add a row.
            {/* TODO i18n: timeline.noEvents */}
          </div>
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-bg-page border border-border-hairline hover:border-accent/40 hover:bg-bg-hover text-text-primary transition-colors"
          >
            + <span>New</span>
            {/* TODO i18n: common.new */}
          </button>
        </div>
      </div>
    );
  }

  const bodyHeight = visibleRows.length * ROW_HEIGHT;
  const hasAnyDates = visibleRows.some((r) => parseISODate(r.properties[startProp.id]) != null);

  return (
    <div className="flex flex-col">
      {toolbar}
      {!hasAnyDates && (
        <div className="px-3 py-2 text-xs text-text-tertiary bg-bg-section/40 border-b border-border-hairline">
          No rows have a start date yet — set one to plot it here.
          {/* TODO i18n: timeline.noDatedRows */}
        </div>
      )}
      <div className="overflow-auto max-h-[70vh] bg-bg-page">
        {/* Inner flex lays out [sticky-left labels column] [canvas]. Fixed
            width forces horizontal scroll when the viewport is narrower. */}
        <div className="flex" style={{ width: LABEL_WIDTH + canvasWidth }}>
          {/* ---- Left labels column (sticky left) ---- */}
          <div
            className="sticky left-0 z-20 flex-shrink-0 bg-bg-page border-r border-border-hairline"
            style={{ width: LABEL_WIDTH }}
          >
            {/* Corner: nested sticky (top + left) pins it in both axes. */}
            <div
              className="sticky top-0 z-30 flex items-end px-2 pb-1 bg-bg-page border-b border-border-hairline"
              style={{ height: AXIS_HEIGHT }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                Title{/* TODO i18n: common.title */}
              </span>
            </div>
            <div>
              {visibleRows.map((row) => (
                <RowLabel key={row.id} row={row} onOpenRow={onOpenRow} />
              ))}
            </div>
          </div>
          {/* ---- Canvas column ---- */}
          <div className="relative flex-shrink-0" style={{ width: canvasWidth }}>
            <div className="sticky top-0 z-10">
              <DateAxis rangeStart={range.start} totalDays={range.totalDays} dayWidth={dayWidth} />
            </div>
            <div className="relative" style={{ height: bodyHeight }}>
              <WeekendOverlay
                rangeStart={range.start}
                totalDays={range.totalDays}
                dayWidth={dayWidth}
                bodyHeight={bodyHeight}
              />
              <TodayLine rangeStart={range.start} dayWidth={dayWidth} bodyHeight={bodyHeight} />
              {visibleRows.map((row) => (
                <RowTrack
                  key={row.id}
                  row={row}
                  startProp={startProp}
                  endProp={endProp}
                  rangeStart={range.start}
                  totalDays={range.totalDays}
                  dayWidth={dayWidth}
                  onOpenRow={onOpenRow}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
