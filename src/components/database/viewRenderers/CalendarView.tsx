import { memo, useCallback, useMemo, useState } from 'react';
import type { DatabaseRow } from '../../../lib/types';
import type { ViewRendererProps } from './types';
import { pickFirstPropertyByType, useVisibleRows } from './shared';

// ============================================================================
// Calendar view — month grid
// ============================================================================
// Layout / interaction spec lives in the Phase 2 task brief. Summary:
//   - First `date` property on the schema is the event date (MVP convention;
//     see `pickFirstPropertyByType`). No per-view picker UI in MVP.
//   - 6×7 grid (Sun..Sat) covering the current month plus overflow days.
//   - Events are draggable across days to change the date (HTML5 DnD).
//   - Click an event pill to open the row's page.
//
// MVP limitations documented inline below (locale-aware first-day-of-week,
// "+N more" popover, "+ New" pre-filling the date).

/** Number of events a cell may show before collapsing the rest into "+N more". */
const MAX_EVENTS_PER_CELL = 3;

/** Number of events actually rendered before the "+N more" label appears. */
const VISIBLE_EVENTS_PER_CELL = 2;

/** Custom MIME type carrying the dragged row id (avoids "text/plain" clashes). */
const DRAG_MIME = 'application/x-folio-calendar-row';

/** Fallback emoji when a row has no icon of its own. */
const FALLBACK_ICON = '\u{1F4C4}'; // 📄

/**
 * First day of the week. MVP: Sunday for everyone (per task brief).
 * TODO i18n: derive from `new Intl.Locale(navigator.language).weekInfo.firstDay`
 *             when we want locale-aware weekends / weekday ordering.
 */
const FIRST_DAY_OF_WEEK = 0; // 0 = Sunday

/** Weekday header labels, ordered from FIRST_DAY_OF_WEEK. */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});

// ----------------------------------------------------------------------------
// Pure date helpers
// ----------------------------------------------------------------------------

/** Format a `Date` as the `YYYY-MM-DD` day key used in the row→day index. */
function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build the 42-day grid (6 weeks × 7 days) covering the given month.
 * First cell = the FIRST_DAY_OF_WEEK containing day 1 of the month.
 */
function computeMonthGrid(cursor: Date): Date[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() - FIRST_DAY_OF_WEEK + 7) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * Extract the `YYYY-MM-DD` day key from a raw date property value.
 * Accepts both `"YYYY-MM-DD"` and the `datetime-local` shape `"YYYY-MM-DDTHH:mm"`
 * (matches DateCell's `<input type="datetime-local">` serialization).
 * Returns `null` for non-strings / malformed values so they're silently skipped.
 */
function dayKeyFromRaw(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/**
 * Build the new raw date value when a row is dropped on a different day.
 * Preserves any existing time portion so a row at 14:30 stays at 14:30 —
 * matches DateCell's `datetime-local` round-trip.
 */
function buildDroppedValue(originalRaw: unknown, dayKey: string): string {
  if (typeof originalRaw === 'string' && originalRaw.length > 10) {
    return dayKey + originalRaw.slice(10);
  }
  return dayKey;
}

// Stable empty array reference for cells with no events, so memo identity is
// preserved across re-renders.
const EMPTY_EVENTS: readonly DatabaseRow[] = [];

// ============================================================================
// Main component
// ============================================================================

export function CalendarView({
  view,
  schema,
  rows,
  onCellChange,
  onOpenRow,
  onAddRow,
}: ViewRendererProps) {
  // Currently-viewed month. Normalised to day-1 so prev/next math is
  // unambiguous across 28/29/30/31-day months.
  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const dateProp = useMemo(
    () => pickFirstPropertyByType(schema, 'date'),
    [schema],
  );

  const visibleRows = useVisibleRows(rows, view);

  const gridDays = useMemo(() => computeMonthGrid(cursor), [cursor]);
  // "Today" snapshot for highlight. Captured at mount; doesn't tick over midnight
  // (acceptable for MVP — re-mounting the view refreshes it).
  const today = useMemo(() => toDayKey(new Date()), []);

  // Row → day-of-month index: Map<YYYY-MM-DD, DatabaseRow[]>.
  // Cheap to rebuild; rows array identity only changes on refetch.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (!dateProp) return map;
    for (const row of visibleRows) {
      const key = dayKeyFromRaw(row.properties[dateProp.id]);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return map;
  }, [visibleRows, dateProp]);

  // --- Navigation handlers -------------------------------------------------
  const goToPrevMonth = useCallback(() => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  }, []);
  const goToNextMonth = useCallback(() => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  }, []);
  const goToToday = useCallback(() => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  // --- Drag-to-change-date handler ----------------------------------------
  const handleDropRow = useCallback(
    (rowId: string, dayKey: string) => {
      if (!dateProp) return;
      const row = visibleRows.find((r) => r.id === rowId);
      if (!row) return;
      const originalRaw = row.properties[dateProp.id];
      const next = buildDroppedValue(originalRaw, dayKey);
      // No-op if the day already matches — avoids spurious backend writes.
      if (typeof originalRaw === 'string' && next === originalRaw) return;
      onCellChange(row, dateProp, next);
    },
    [dateProp, visibleRows, onCellChange],
  );

  // --- No date property on the schema: friendly empty state -----------------
  if (!dateProp) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <p className="text-sm text-text-secondary mb-1">
          {/* TODO i18n: database.calendarAddDatePrompt */}
          Add a Date property to use Calendar view
        </p>
        <p className="text-[12px] text-text-tertiary">
          {/* TODO i18n: database.calendarAddDateHint */}
          Switch to Table view and add a Date column to start scheduling.
        </p>
      </div>
    );
  }

  const monthLabel = MONTH_FORMATTER.format(cursor);

  return (
    <div className="flex flex-col">
      {/* Header bar — ~44px tall. Prev / label / next on the left; Today + New
          on the right (matches the task brief's header spec). */}
      <div className="flex items-center justify-between h-11 px-3 bg-bg-page border-b border-border-hairline">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goToPrevMonth}
            // TODO i18n: database.calendarPrevMonthAria
            aria-label="Previous month"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span aria-hidden className="text-base leading-none">
              {'\u2039'}
            </span>
          </button>
          <span className="text-sm font-medium text-text-primary min-w-[130px] text-center">
            {/* TODO i18n: database.calendarMonthYear ({{label}}) */}
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            // TODO i18n: database.calendarNextMonthAria
            aria-label="Next month"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span aria-hidden className="text-base leading-none">
              {'\u203A'}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goToToday}
            className="px-2.5 py-1 rounded-md text-[12px] text-text-secondary hover:bg-bg-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {/* TODO i18n: database.calendarToday */}
            Today
          </button>
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium bg-accent text-bg-page hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span aria-hidden>+</span>
            {/* TODO i18n: database.newRow (reuse) */}
            <span>New</span>
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 border-b border-border-hairline bg-bg-page">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
          >
            {/* TODO i18n: derive weekday labels from Intl.DateTimeFormat
                (weekday: 'narrow' / 'short') once FIRST_DAY_OF_WEEK is locale-aware */}
            {label}
          </div>
        ))}
      </div>

      {/* Month grid — 6 rows × 7 cols. Fixed 1px grid via wrapper `border-l/t`
          + per-cell `border-r/b`. Body scrolls inside the same 70vh budget as
          the table view so the database shell stays a single scroll region. */}
      <div className="grid grid-cols-7 grid-rows-6 max-h-[70vh] overflow-y-auto border-l border-t border-border-hairline">
        {gridDays.map((day) => {
          const key = toDayKey(day);
          return (
            <DayCell
              key={key}
              dayKey={key}
              dayOfMonth={day.getDate()}
              month={day.getMonth()}
              dayOfWeek={day.getDay()}
              cursorMonth={cursor.getMonth()}
              todayKey={today}
              events={eventsByDay.get(key) ?? EMPTY_EVENTS}
              onOpenRow={onOpenRow}
              onDropRow={handleDropRow}
            />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// DayCell (memoized)
// ============================================================================

interface DayCellProps {
  /** `YYYY-MM-DD` for this cell. Stable identity key + drop target value. */
  dayKey: string;
  /** Calendar day-of-month number to render in the corner. */
  dayOfMonth: number;
  /** Raw month (0-11) of this cell — used to dim out-of-month days. */
  month: number;
  /** Raw day-of-week (0-6 = Sun-Sat) — used to tint weekend cells. */
  dayOfWeek: number;
  /** Month (0-11) of the currently-viewed cursor — `month !== cursorMonth`
   *  means the cell belongs to a neighbouring month and is dimmed. */
  cursorMonth: number;
  /** `YYYY-MM-DD` of today, for the today highlight. */
  todayKey: string;
  /** Rows whose date property falls on `dayKey`, in display order. */
  events: readonly DatabaseRow[];
  onOpenRow: (pageId: string) => void;
  onDropRow: (rowId: string, dayKey: string) => void;
}

const DayCell = memo(function DayCell({
  dayKey,
  dayOfMonth,
  month,
  dayOfWeek,
  cursorMonth,
  todayKey,
  events,
  onOpenRow,
  onDropRow,
}: DayCellProps) {
  const inMonth = month === cursorMonth;
  const isToday = dayKey === todayKey;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const [isDragOver, setIsDragOver] = useState(false);

  // Only accept the drag if our MIME is on the dataTransfer — this prevents
  // the calendar from swallowing text/file drags originating elsewhere.
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsDragOver(false);
      const rowId = e.dataTransfer.getData(DRAG_MIME);
      if (!rowId) return;
      e.preventDefault();
      onDropRow(rowId, dayKey);
    },
    [dayKey, onDropRow],
  );

  // Layered cell background: drop-target tint wins, then weekend tint, then
  // today accent tint. Today also gets an inset accent ring for clarity.
  const cellBg = isDragOver
    ? 'bg-bg-active'
    : isWeekend
      ? 'bg-bg-section/30'
      : isToday
        ? 'bg-accent/10'
        : '';

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative min-h-[88px] border-r border-b border-border-hairline p-1 ${cellBg} ${
        isToday ? 'ring-2 ring-accent ring-inset' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={`text-[11px] font-medium leading-none ${
            inMonth ? 'text-text-secondary' : 'text-text-tertiary'
          }`}
        >
          {dayOfMonth}
        </span>
        {isToday && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent"
            // TODO i18n: database.calendarTodayBadgeAria
            aria-label="Today"
          />
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {events.slice(0, VISIBLE_EVENTS_PER_CELL).map((row) => (
          <EventPill key={row.id} row={row} onOpen={onOpenRow} />
        ))}
        {events.length > MAX_EVENTS_PER_CELL && (
          <span
            className="text-[10px] text-text-tertiary px-1 leading-tight"
            // TODO follow-up: clicking "+N more" should open a day popover
            // listing every event. Left as a label for MVP.
          >
            {/* TODO i18n: database.calendarMoreEvents ({{n}}) */}
            +{events.length - VISIBLE_EVENTS_PER_CELL} more
          </span>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// EventPill (memoized)
// ============================================================================

interface EventPillProps {
  row: DatabaseRow;
  onOpen: (pageId: string) => void;
}

const EventPill = memo(function EventPill({ row, onOpen }: EventPillProps) {
  // Stop click from bubbling into the day cell — the cell is a drop target,
  // not a click target, but we keep the boundaries clean anyway.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onOpen(row.id);
    },
    [onOpen, row.id],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.dataTransfer.setData(DRAG_MIME, row.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    [row.id],
  );

  const displayTitle = row.title || 'Untitled';

  return (
    <button
      type="button"
      draggable
      onClick={handleClick}
      onDragStart={handleDragStart}
      title={displayTitle}
      // TODO i18n: database.calendarOpenEventAria ({{title}})
      aria-label={`Open ${displayTitle}`}
      className="group w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-left text-accent bg-accent/15 hover:bg-accent/25 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span aria-hidden className="flex-shrink-0 text-[11px] leading-none">
        {row.icon ?? FALLBACK_ICON}
      </span>
      <span className="flex-1 min-w-0 truncate">{displayTitle}</span>
    </button>
  );
});
