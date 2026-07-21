import { memo, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type {
  DatabaseRow,
  DatabaseWithSchema,
  PropertyDef,
  SelectOption,
  ViewConfig,
} from '../../../lib/types';
import { COL_GROUPABLE, GroupMenu } from '../GroupMenu';
import { pickFirstPropertyByType, useVisibleRows } from './shared';
import type { ViewRendererProps } from './types';

// ============================================================================
// Board (kanban) view
// ----------------------------------------------------------------------------
// Groups rows into columns by a select / status / multi_select property
// (defaults to `view.group.propertyId`, falling back to the first status then
// first select property on the schema). Cards are HTML5-draggable across
// columns to change the property value. A trailing "Uncategorized" column
// holds rows whose group value is empty / null / unknown.
//
// MVP scope (see Phase 2 plan): no inline property editing on the card (click
// opens the row page), no drag-to-reorder within a column, no collapse-all
// toggle even though `view.group.collapsedGroups` is persisted. Those land in
// a later pass.
// ============================================================================

// Custom MIME for the drag payload. Using a vendor type avoids the payload
// being misrouted into other drop surfaces (e.g. the editor) and lets us sniff
// `dataTransfer.types` in `dragenter` / `dragover` without reading the data
// (which the spec only allows inside `drop`).
const BOARD_CARD_MIME = 'application/x-folio-board-card';

// Sentinel key for the trailing Uncategorized column. Empty string is a valid
// (cleared) option value in storage, so we use a private sentinel here and
// translate it back to `null` on drop.
const UNCAT_KEY = '__folio_uncategorized__';

// Canonical Notion-semantic color → bg/dot class table. Duplicated locally to
// match the existing pattern in PropertyCells.tsx and DatabaseView.tsx — those
// modules intentionally keep their copies unexported. Keep in sync if the
// palette changes.
const COLOR_MAP: Record<string, { bg: string; dot: string }> = {
  gray: { bg: 'bg-bg-hover text-text-secondary', dot: 'bg-text-tertiary' },
  brown: { bg: 'bg-[#fcf8f5] text-[#9c7054]', dot: 'bg-[#c9b5a8]' },
  orange: { bg: 'bg-[#fff5ed] text-[#ff6d00]', dot: 'bg-[#ffaf80]' },
  yellow: { bg: 'bg-[#fef7d6] text-[#ffb110]', dot: 'bg-[#ffcc00]' },
  green: { bg: 'bg-[#d9f3e1] text-[#1aae39]', dot: 'bg-[#66d66b]' },
  blue: { bg: 'bg-bg-active text-accent', dot: 'bg-accent' },
  purple: { bg: 'bg-[#e6e0f5] text-[#391c57]', dot: 'bg-[#9b7fdb]' },
  pink: { bg: 'bg-[#f4dfeb] text-[#ff64c8]', dot: 'bg-[#ff9bd6]' },
  red: { bg: 'bg-[#fbe4e4] text-status-red', dot: 'bg-status-red' },
};

function dotClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).dot;
}

function chipClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).bg;
}

// ---------------------------------------------------------------------------
// Group-property resolution + row partitioning
// ---------------------------------------------------------------------------

/**
 * Resolve the property a board view groups by. Priority:
 *   1. `view.group?.propertyId` when it points at an existing select / status
 *      / multi_select property on the schema.
 *   2. First `status` property on the schema.
 *   3. First `select` property on the schema.
 * Returns `null` when none of those yield a groupable property — the caller
 * renders a friendly empty state asking for one to be added.
 */
function resolveGroupProperty(
  view: ViewConfig,
  schema: DatabaseWithSchema,
): PropertyDef | null {
  const explicitId = view.group?.propertyId;
  if (explicitId) {
    const p = schema.properties.find((prop) => prop.id === explicitId);
    if (p && (p.type === 'select' || p.type === 'status' || p.type === 'multi_select')) {
      return p;
    }
  }
  return (
    pickFirstPropertyByType(schema, 'status') ??
    pickFirstPropertyByType(schema, 'select')
  );
}

interface OptionColumn {
  option: SelectOption;
  rows: DatabaseRow[];
}

interface BoardPartition {
  optionColumns: OptionColumn[];
  uncategorizedRows: DatabaseRow[];
}

/** Split filtered+sorted rows into one bucket per declared option (preserving
 *  option order) plus an Uncategorized bucket. For multi_select groupings a
 *  row appears in every column whose value it carries. */
function partitionRows(
  rows: DatabaseRow[],
  groupProp: PropertyDef,
): BoardPartition {
  const options: SelectOption[] = groupProp.options ?? [];
  const byOption = new Map<string, DatabaseRow[]>();
  for (const opt of options) byOption.set(opt.value, []);
  const uncategorized: DatabaseRow[] = [];

  for (const row of rows) {
    const raw = row.properties[groupProp.id];
    if (groupProp.type === 'multi_select') {
      const vals: string[] = Array.isArray(raw) ? (raw as string[]) : [];
      if (vals.length === 0) {
        uncategorized.push(row);
        continue;
      }
      // A row may belong to several columns; place it in each known one.
      let placed = false;
      for (const v of vals) {
        const list = byOption.get(v);
        if (list) {
          list.push(row);
          placed = true;
        }
      }
      // Every value points at an unknown option → treat as uncategorized.
      if (!placed) uncategorized.push(row);
    } else {
      const v = typeof raw === 'string' ? raw : '';
      const list = byOption.get(v);
      if (v && list) list.push(row);
      else uncategorized.push(row);
    }
  }

  return {
    optionColumns: options.map((opt) => ({
      option: opt,
      rows: byOption.get(opt.value) ?? [],
    })),
    uncategorizedRows: uncategorized,
  };
}

// ---------------------------------------------------------------------------
// Value formatting for chips
// ---------------------------------------------------------------------------

/**
 * Reduce an arbitrary cell value to a short chip string. Returns `null` when
 * the value is empty / uninteresting so the caller can skip the chip slot.
 */
function formatChipValue(prop: PropertyDef, value: unknown): string | null {
  if (value == null) return null;
  if (prop.type === 'multi_select') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    if (arr.length === 0) return null;
    return arr.join(', ');
  }
  if (prop.type === 'files') {
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    return arr.length === 0 ? null : `${arr.length}`; // TODO i18n: database.nFiles
  }
  if (prop.type === 'checkbox') {
    return value === true ? '✓' : null; // TODO i18n: database.checkboxTrue
  }
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length === 0 ? null : value;
  return null;
}

/** Whether this (prop, value) should occupy a chip slot on a card. */
function hasChipValue(prop: PropertyDef, value: unknown): boolean {
  if (prop.type === 'select' || prop.type === 'status') {
    const v = typeof value === 'string' ? value : '';
    return (prop.options ?? []).some((o) => o.value === v);
  }
  return formatChipValue(prop, value) != null;
}

// ---------------------------------------------------------------------------
// Chip — small pill under the card title
// ---------------------------------------------------------------------------

interface ChipProps {
  prop: PropertyDef;
  value: unknown;
}

const Chip = memo(function Chip({ prop, value }: ChipProps) {
  // Colored pill for select / status so the dot matches the column color.
  if (prop.type === 'select' || prop.type === 'status') {
    const v = typeof value === 'string' ? value : '';
    const opt = (prop.options ?? []).find((o) => o.value === v);
    if (!opt) return null;
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-tight ${chipClass(opt.color)}`}
      >
        {opt.value}
      </span>
    );
  }
  const text = formatChipValue(prop, value);
  if (text == null) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-tight bg-bg-hover max-w-[200px]">
      <span className="text-text-tertiary shrink-0">{prop.name}:</span>
      <span className="text-text-secondary truncate">{text}</span>
    </span>
  );
});

// ---------------------------------------------------------------------------
// BoardCard — draggable, clickable
// ---------------------------------------------------------------------------

interface BoardCardProps {
  row: DatabaseRow;
  chips: Array<{ prop: PropertyDef; value: unknown }>;
  isDragging: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, row: DatabaseRow) => void;
  onDragEnd: () => void;
  onOpenRow: (pageId: string) => void;
}

const BoardCard = memo(function BoardCard({
  row,
  chips,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpenRow,
}: BoardCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStart(e, row)}
      onDragEnd={onDragEnd}
      onClick={() => onOpenRow(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenRow(row.id);
        }
      }}
      aria-label={row.title || 'Untitled card'} // TODO i18n: database.boardCardAria
      className={[
        'w-[260px] min-h-[64px] p-2.5 rounded-md cursor-pointer select-none',
        'bg-bg-page border border-border-hairline',
        'hover:border-accent/40 hover:shadow-sm',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'transition-colors duration-150',
        isDragging ? 'opacity-50' : 'opacity-100',
      ].join(' ')}
    >
      <div className="text-sm font-medium text-text-primary truncate">
        {row.title || 'Untitled' /* TODO i18n: common.untitled */}
      </div>
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map(({ prop, value }) => (
            <Chip key={prop.id} prop={prop} value={value} />
          ))}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Column header
// ---------------------------------------------------------------------------

interface ColumnHeaderProps {
  dotClassStr: string;
  label: string;
  count: number;
  onAddClick: () => void;
}

function ColumnHeader({ dotClassStr, label, count, onAddClick }: ColumnHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClassStr}`} aria-hidden />
      <span className="text-xs font-semibold text-text-secondary truncate flex-1">
        {label}
      </span>
      <span className="text-[11px] text-text-tertiary tabular-nums">{count}</span>
      <button
        type="button"
        onClick={onAddClick}
        aria-label={`Add card to ${label}`} // TODO i18n: database.boardAddCardToColumn
        className="w-5 h-5 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column body — vertical stack of cards with independent vertical scroll
// ---------------------------------------------------------------------------

interface ColumnBodyProps {
  rows: DatabaseRow[];
  chipsByRow: Map<string, Array<{ prop: PropertyDef; value: unknown }>>;
  draggingId: string | null;
  onDragStart: (e: DragEvent<HTMLDivElement>, row: DatabaseRow) => void;
  onDragEnd: () => void;
  onOpenRow: (pageId: string) => void;
  onAddRow: () => void;
}

function ColumnBody({
  rows,
  chipsByRow,
  draggingId,
  onDragStart,
  onDragEnd,
  onOpenRow,
  onAddRow,
}: ColumnBodyProps) {
  return (
    <div className="flex flex-col gap-2 px-2 pb-2 max-h-[70vh] overflow-y-auto">
      {rows.map((row) => (
        <BoardCard
          key={row.id}
          row={row}
          chips={chipsByRow.get(row.id) ?? []}
          isDragging={draggingId === row.id}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onOpenRow={onOpenRow}
        />
      ))}
      {rows.length === 0 && (
        <button
          type="button"
          onClick={onAddRow}
          className="w-[260px] mx-auto text-left px-2.5 py-2 rounded-md text-[11px] text-text-tertiary/70 hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          + Add a card{/* TODO i18n: database.boardAddCard */}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BoardHeader — top bar with the inline "Group by" picker, count, and + New
// ---------------------------------------------------------------------------

interface BoardHeaderProps {
  count: number;
  /** Current group property (may be null when grouping is cleared AND no
   *  status/select fallback exists on the schema). */
  groupProp: PropertyDef | null;
  /** All schema properties — the picker filters to groupable types. */
  properties: PropertyDef[];
  /** Persist a new group-property choice. When undefined the picker is
   *  hidden (e.g. in tests without a parent DatabaseView). */
  onChangeGroupProperty?: (id: string | null) => void;
  onAddRow: () => void;
}

function BoardHeader({
  count,
  groupProp,
  properties,
  onChangeGroupProperty,
  onAddRow,
}: BoardHeaderProps) {
  // Anchor rect for the portaled GroupMenu. Captured on click so the menu
  // positions itself relative to the actual trigger button, regardless of
  // the trigger's place in the layout (and regardless of any
  // `overflow-hidden` ancestor that would clip an inline-positioned menu).
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);

  // Only show the inline picker when (a) the parent wired the callback AND
  // (b) the schema has at least one groupable property to choose from.
  // Without either, the button would be dead UI, so we hide it.
  const groupableExists = properties.some((p) => COL_GROUPABLE.includes(p.type));
  const canPick = !!onChangeGroupProperty && groupableExists;

  return (
    <div className="h-9 flex-shrink-0 flex items-center justify-between px-3 border-b border-border-hairline">
      <div className="flex items-center gap-2 min-w-0">
        {canPick && (
          <button
            type="button"
            onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
            title="Change grouping property" /* TODO i18n: database.boardChangeGroup */
            aria-haspopup="menu"
            aria-expanded={pickerAnchor !== null}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <span className="text-text-tertiary">
              Group by{/* TODO i18n: database.boardGroupBy */}
            </span>
            <span className="font-medium text-text-primary truncate max-w-[160px]">
              {groupProp?.name ?? '—'}
            </span>
            <span className="text-text-tertiary text-[10px]" aria-hidden>▾</span>
          </button>
        )}
        {pickerAnchor && onChangeGroupProperty && (
          <GroupMenu
            anchorRect={pickerAnchor}
            properties={properties}
            currentId={groupProp?.id ?? null}
            placement="bottom-start"
            onPick={(id) => {
              onChangeGroupProperty(id);
              setPickerAnchor(null);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        )}
        <span className="text-xs text-text-secondary">
          {count} {count === 1 ? 'card' : 'cards'}
          {/* TODO i18n: database.boardCardCount_one / _other */}
        </span>
      </div>
      <button
        type="button"
        onClick={onAddRow}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-bg-page border border-border-hairline hover:border-accent/40 hover:bg-bg-hover text-text-primary transition-colors"
      >
        + <span>New</span>{/* TODO i18n: common.new */}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BoardView — main renderer
// ---------------------------------------------------------------------------

export function BoardView({
  view,
  schema,
  rows,
  onCellChange,
  onOpenRow,
  onAddRow,
  onChangeGroupProperty,
}: ViewRendererProps) {
  const visibleRows = useVisibleRows(rows, view);

  const groupProp = useMemo(
    () => resolveGroupProperty(view, schema),
    [view, schema],
  );

  const partition = useMemo(
    () => (groupProp ? partitionRows(visibleRows, groupProp) : null),
    [visibleRows, groupProp],
  );

  // Properties eligible for chip slots (everything except title + group prop).
  const chipProps = useMemo(() => {
    if (!groupProp) return [] as PropertyDef[];
    return schema.properties.filter(
      (p) => p.id !== groupProp.id && p.type !== 'title',
    );
  }, [schema, groupProp]);

  // Pre-compute up to 2 chips per visible row.
  const chipsByRow = useMemo(() => {
    const map = new Map<string, Array<{ prop: PropertyDef; value: unknown }>>();
    for (const row of visibleRows) {
      const out: Array<{ prop: PropertyDef; value: unknown }> = [];
      for (const prop of chipProps) {
        if (out.length >= 2) break;
        const value = row.properties[prop.id];
        if (hasChipValue(prop, value)) out.push({ prop, value });
      }
      map.set(row.id, out);
    }
    return map;
  }, [visibleRows, chipProps]);

  // ---- Drag state ---------------------------------------------------------
  // `dragRowRef` survives renders without triggering them; the `draggingId`
  // and `dragOverColumn` state values are only the visual mirrors.
  const dragRowRef = useRef<DatabaseRow | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const handleDragStart = (e: DragEvent<HTMLDivElement>, row: DatabaseRow) => {
    dragRowRef.current = row;
    setDraggingId(row.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(BOARD_CARD_MIME, row.id);
  };

  const handleDragEnd = () => {
    dragRowRef.current = null;
    setDraggingId(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (
    e: DragEvent<HTMLDivElement>,
    columnKey: string,
  ) => {
    // The MIME check is what permits the drop — without preventDefault on a
    // dragover the browser vetoes the subsequent drop event.
    if (!e.dataTransfer.types.includes(BOARD_CARD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== columnKey) setDragOverColumn(columnKey);
  };

  const handleColumnDragLeave = (columnKey: string) => {
    if (dragOverColumn === columnKey) setDragOverColumn(null);
  };

  // `targetValue` is `null` for the Uncategorized column, which matches what
  // SelectCell emits when clearing a select (see PropertyCells.tsx).
  const handleColumnDrop = (
    e: DragEvent<HTMLDivElement>,
    columnKey: string,
    targetValue: string | null,
  ) => {
    if (!e.dataTransfer.types.includes(BOARD_CARD_MIME)) return;
    e.preventDefault();
    const rowId = e.dataTransfer.getData(BOARD_CARD_MIME);
    const row = dragRowRef.current ?? rows.find((r) => r.id === rowId);
    if (row && groupProp) {
      onCellChange(row, groupProp, targetValue);
    }
    dragRowRef.current = null;
    setDraggingId(null);
    setDragOverColumn((current) => (current === columnKey ? null : current));
  };

  // ---- Empty state: no groupable property --------------------------------
  if (!groupProp || !partition) {
    // Distinguish "no groupable property on the schema yet" from "groupable
    // properties exist but grouping is cleared / not chosen". The latter can
    // be fixed in-place via the header picker; the former asks the user to
    // add a Select/Status property first (best done from the table view).
    const groupableExists = schema.properties.some((p) =>
      COL_GROUPABLE.includes(p.type),
    );
    return (
      <>
        <BoardHeader
          count={0}
          groupProp={null}
          properties={schema.properties}
          onChangeGroupProperty={onChangeGroupProperty}
          onAddRow={onAddRow}
        />
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          {groupableExists ? (
            <>
              <div className="text-sm font-medium text-text-primary mb-1">
                {/* TODO i18n: database.boardPickGroupProperty */}
                Pick a property to group by
              </div>
              <div className="text-xs text-text-tertiary max-w-sm">
                {/* TODO i18n: database.boardPickGroupPropertyHint */}
                Use “Group by” in the toolbar above to choose which Select,
                Status, or Multi-select column drives this board.
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-text-primary mb-1">
                {/* TODO i18n: database.boardNeedsGroupProperty */}
                Board view needs a Select or Status property
              </div>
              <div className="text-xs text-text-tertiary max-w-sm">
                {/* TODO i18n: database.boardNeedsGroupPropertyHint */}
                Add a Select or Status property to this database to group cards into columns.
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  // ---- Empty state: no visible rows --------------------------------------
  if (visibleRows.length === 0) {
    return (
      <>
        <BoardHeader
          count={0}
          groupProp={groupProp}
          properties={schema.properties}
          onChangeGroupProperty={onChangeGroupProperty}
          onAddRow={onAddRow}
        />
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="text-sm text-text-secondary mb-3">
            {/* TODO i18n: database.boardNoCards */}
            No cards match. Adjust filters or click + to add.
          </div>
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-bg-page border border-border-hairline hover:border-accent/40 hover:bg-bg-hover text-text-primary transition-colors"
          >
            + <span>New</span>{/* TODO i18n: common.new */}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <BoardHeader
        count={visibleRows.length}
        groupProp={groupProp}
        properties={schema.properties}
        onChangeGroupProperty={onChangeGroupProperty}
        onAddRow={onAddRow}
      />

      <div className="flex gap-3 p-3 overflow-x-auto">
        {partition.optionColumns.map(({ option, rows: columnRows }) => {
          const columnKey = option.value;
          const isOver = dragOverColumn === columnKey;
          return (
            <div
              key={option.value}
              onDragOver={(e) => handleColumnDragOver(e, columnKey)}
              onDragLeave={() => handleColumnDragLeave(columnKey)}
              onDrop={(e) => handleColumnDrop(e, columnKey, option.value)}
              className={[
                'flex-shrink-0 w-[280px] flex flex-col rounded-lg',
                'bg-bg-section/40 transition-colors duration-150',
                isOver ? 'ring-2 ring-accent/40 bg-bg-hover/40' : '',
              ].join(' ')}
            >
              <ColumnHeader
                dotClassStr={dotClass(option.color)}
                label={option.value}
                count={columnRows.length}
                onAddClick={onAddRow}
              />
              <ColumnBody
                rows={columnRows}
                chipsByRow={chipsByRow}
                draggingId={draggingId}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onOpenRow={onOpenRow}
                onAddRow={onAddRow}
              />
            </div>
          );
        })}

        {/* Uncategorized column — always last. */}
        <div
          onDragOver={(e) => handleColumnDragOver(e, UNCAT_KEY)}
          onDragLeave={() => handleColumnDragLeave(UNCAT_KEY)}
          onDrop={(e) => handleColumnDrop(e, UNCAT_KEY, null)}
          className={[
            'flex-shrink-0 w-[280px] flex flex-col rounded-lg',
            'bg-bg-section/40 transition-colors duration-150',
            dragOverColumn === UNCAT_KEY
              ? 'ring-2 ring-accent/40 bg-bg-hover/40'
              : '',
          ].join(' ')}
        >
          <ColumnHeader
            dotClassStr={dotClass('gray')}
            label="Uncategorized" /* TODO i18n: database.boardUncategorized */
            count={partition.uncategorizedRows.length}
            onAddClick={onAddRow}
          />
          <ColumnBody
            rows={partition.uncategorizedRows}
            chipsByRow={chipsByRow}
            draggingId={draggingId}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onOpenRow={onOpenRow}
            onAddRow={onAddRow}
          />
        </div>
      </div>
    </>
  );
}
