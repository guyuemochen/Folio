import { memo, useMemo, useState } from 'react';
import type { DatabaseRow, PropertyDef, SelectOption } from '../../../lib/types';
import type { ViewRendererProps } from './types';
import { pickFirstPropertyByType, useVisibleRows } from './shared';

/**
 * Gallery view — Notion-style card grid. Each card shows a cover band (first
 * `files` prop, an image-looking `url` prop, or a token gradient), the row
 * icon + title, and 2-3 prominent non-hidden properties as `label: value`
 * rows. Cards open the row page on click. No inline editing (MVP).
 *
 * Conventions (see `types.ts`):
 *   - Cover source = first `files` property, else first `url` property whose
 *     value looks like an image URL.
 *   - Title = the single `title`-typed property (falls back to `row.title`).
 *   - Property chips = first 2-3 declared properties that are not the title,
 *     not the cover source, and not hidden via `view.hiddenProperties`.
 */
export function GalleryView({ view, schema, rows, onOpenRow, onAddRow }: ViewRendererProps) {
  const visibleRows = useVisibleRows(rows, view);

  // Card width floor (S/M/L). Local state only — not persisted in MVP.
  const [size, setSize] = useState<CardSize>('M');

  const titleProp = useMemo(
    () => schema.properties.find((p) => p.type === 'title') ?? null,
    [schema.properties],
  );
  const coverProp = useMemo(
    () => pickFirstPropertyByType(schema, 'files') ?? pickFirstPropertyByType(schema, 'url'),
    [schema],
  );
  const hiddenSet = useMemo(
    () => new Set(view.hiddenProperties ?? []),
    [view.hiddenProperties],
  );
  const chipProps = useMemo(
    () => pickDisplayProperties(schema.properties, titleProp, coverProp, hiddenSet, 3),
    [schema.properties, titleProp, coverProp, hiddenSet],
  );

  return (
    <div className="flex flex-col min-h-0">
      <GalleryHeader
        count={visibleRows.length}
        size={size}
        onSizeChange={setSize}
        onAddRow={onAddRow}
      />

      {visibleRows.length === 0 ? (
        <GalleryEmptyState onAddRow={onAddRow} />
      ) : (
        <div
          className="grid gap-3 p-3 overflow-y-auto"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH[size]}px, 1fr))` }}
        >
          {visibleRows.map((row) => (
            <GalleryCard
              key={row.id}
              row={row}
              titleProp={titleProp}
              coverProp={coverProp}
              chipProps={chipProps}
              onOpenRow={onOpenRow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header bar
// ---------------------------------------------------------------------------

type CardSize = 'S' | 'M' | 'L';

const CARD_MIN_WIDTH: Record<CardSize, number> = {
  S: 220,
  M: 280,
  L: 360,
};

const SIZE_ORDER: CardSize[] = ['S', 'M', 'L'];

interface GalleryHeaderProps {
  count: number;
  size: CardSize;
  onSizeChange: (size: CardSize) => void;
  onAddRow: () => void;
}

const GalleryHeader = memo(function GalleryHeader({
  count,
  size,
  onSizeChange,
  onAddRow,
}: GalleryHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-3 h-9 border-b border-border-hairline bg-bg-page">
      {/* TODO i18n: database.gallery.cardCount */}
      <span className="text-[11px] text-text-tertiary">
        {count} {count === 1 ? 'card' : 'cards'}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* Size toggle */}
        <div
          className="flex items-center gap-0.5 rounded bg-bg-hover p-0.5"
          role="group"
          aria-label="Card size"
        >
          {SIZE_ORDER.map((s) => {
            const active = s === size;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onSizeChange(s)}
                className={[
                  'px-1.5 py-0.5 text-[11px] rounded transition-colors',
                  active
                    ? 'bg-bg-section text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary',
                ].join(' ')}
                aria-pressed={active}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* + New */}
        <button
          type="button"
          onClick={onAddRow}
          className="px-2.5 py-1 text-[12px] rounded bg-bg-hover text-text-primary hover:bg-bg-active transition-colors"
        >
          {/* TODO i18n: database.gallery.newRow */}
          + New
        </button>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

interface GalleryEmptyStateProps {
  onAddRow: () => void;
}

function GalleryEmptyState({ onAddRow }: GalleryEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-3 opacity-60" aria-hidden>
        🖼️
      </div>
      {/* TODO i18n: database.gallery.emptyTitle */}
      <div className="text-sm font-medium text-text-primary mb-1">No cards yet</div>
      {/* TODO i18n: database.gallery.emptyHint */}
      <div className="text-xs text-text-tertiary mb-3">Click + to add one</div>
      <button
        type="button"
        onClick={onAddRow}
        className="px-2.5 py-1 text-[12px] rounded bg-bg-hover text-text-primary hover:bg-bg-active transition-colors"
      >
        {/* TODO i18n: database.gallery.newRow */}
        + New
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface GalleryCardProps {
  row: DatabaseRow;
  titleProp: PropertyDef | null;
  coverProp: PropertyDef | null;
  chipProps: PropertyDef[];
  onOpenRow: (pageId: string) => void;
}

const GalleryCard = memo(function GalleryCard({
  row,
  titleProp,
  coverProp,
  chipProps,
  onOpenRow,
}: GalleryCardProps) {
  const titleText = useMemo(() => {
    if (titleProp) {
      const v = row.properties[titleProp.id];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return row.title;
  }, [row.properties, row.title, titleProp]);

  const cover = useMemo(
    () => (coverProp ? extractCoverInfo(row.properties[coverProp.id], coverProp) : null),
    [row.properties, coverProp],
  );

  const icon = row.icon ?? '📄';

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenRow(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenRow(row.id);
        }
      }}
      className={[
        'group flex flex-col min-h-[160px] cursor-pointer',
        'bg-bg-section border border-border-hairline rounded-md',
        'transition-all duration-150',
        'hover:border-accent/40 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      ].join(' ')}
    >
      {/* Cover band (~80px) */}
      <CardCover cover={cover} icon={row.icon} />

      {/* Body */}
      <div className="flex flex-col gap-1.5 p-2.5 flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[14px] leading-none flex-shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="text-[13px] font-medium text-text-primary truncate" title={titleText}>
            {titleText}
          </span>
        </div>

        {chipProps.length > 0 && (
          <div className="flex flex-col gap-1 mt-0.5 min-w-0">
            {chipProps.map((prop) => (
              <CardChipRow
                key={prop.id}
                prop={prop}
                value={row.properties[prop.id]}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
});

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

type CoverInfo =
  | { kind: 'image'; src: string }
  | { kind: 'file'; name: string }
  | { kind: 'gradient' };

function extractCoverInfo(value: unknown, prop: PropertyDef): CoverInfo | null {
  if (value == null) return null;

  if (prop.type === 'files') {
    const name = attachmentName(value);
    if (name) return { kind: 'file', name };
    return null;
  }

  if (prop.type === 'url') {
    if (typeof value === 'string' && value.length > 0 && looksLikeImage(value)) {
      return { kind: 'image', src: value };
    }
    return null;
  }

  return null;
}

interface CardCoverProps {
  cover: CoverInfo | null;
  icon: string | null;
}

function CardCover({ cover, icon }: CardCoverProps) {
  // Explicit cover content
  if (cover?.kind === 'image') {
    return (
      <div className="h-20 w-full overflow-hidden rounded-t-md bg-bg-hover">
        <img
          src={cover.src}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }
  if (cover?.kind === 'file') {
    return (
      <div className="h-20 w-full flex items-center justify-center gap-1.5 rounded-t-md bg-gradient-to-br from-bg-hover to-bg-active text-text-tertiary">
        <FileIcon />
        <span className="text-[11px] truncate max-w-[80%]" title={cover.name}>
          {cover.name}
        </span>
      </div>
    );
  }

  // Fallback: subtle gradient with the row icon centered (if any)
  return (
    <div className="h-20 w-full flex items-center justify-center rounded-t-md bg-gradient-to-br from-bg-hover to-bg-section">
      {icon ? (
        <span className="text-2xl opacity-70" aria-hidden>
          {icon}
        </span>
      ) : null}
    </div>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 flex-shrink-0"
      aria-hidden
    >
      <path d="M9.5 2.5 H4 a1 1 0 0 0 -1 1 v9 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1 -1 V6 z" />
      <path d="M9.5 2.5 V6 h3.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Chip row (label + formatted value)
// ---------------------------------------------------------------------------

interface CardChipRowProps {
  prop: PropertyDef;
  value: unknown;
}

const CardChipRow = memo(function CardChipRow({ prop, value }: CardChipRowProps) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0 text-[11px] leading-tight">
      <span className="text-text-tertiary flex-shrink-0">{prop.name}</span>
      <span className="text-text-secondary truncate min-w-0">
        <PropertyValueText prop={prop} value={value} />
      </span>
    </div>
  );
});

/**
 * Read-only value renderer covering every property type. Mirrors the
 * canonical formatting in `PropertyCells.tsx` but emits display-only text /
 * chips (no editors). Duplicating the Notion color map keeps this renderer
 * decoupled from the cell-editing module.
 */
function PropertyValueText({ prop, value }: { prop: PropertyDef; value: unknown }) {
  if (value == null || value === '') {
    return <span className="text-text-placeholder">—</span>;
  }

  switch (prop.type) {
    case 'title':
    case 'rich_text':
    case 'url':
      return <>{String(value)}</>;

    case 'number':
      return <>{formatNumber(value, prop.numberFormat ?? 'integer')}</>;

    case 'checkbox':
      return <>{value === true ? '✓' : '✗'}</>;

    case 'date':
      return <>{formatDate(typeof value === 'string' ? value : '')}</>;

    case 'select':
    case 'status': {
      const opt = findOption(prop.options, value);
      return opt ? <SelectChip option={opt} /> : <>{String(value)}</>;
    }

    case 'multi_select': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      if (ids.length === 0) return <span className="text-text-placeholder">—</span>;
      return (
        <span className="inline-flex flex-wrap gap-1">
          {ids.map((id) => {
            const opt = findOption(prop.options, id);
            return opt ? <SelectChip key={id} option={opt} /> : null;
          })}
        </span>
      );
    }

    case 'person':
      return <>{value === 'Me' ? 'Me' : String(value)}</>;

    case 'files': {
      const name = attachmentName(value);
      return name ? <>{name}</> : <span className="text-text-placeholder">—</span>;
    }

    default:
      return <>{String(value)}</>;
  }
}

interface SelectChipProps {
  option: SelectOption;
}

function SelectChip({ option }: SelectChipProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none ${chipBgClass(option.color)}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${chipDotClass(option.color)}`} />
      {option.value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pick the first `max` properties suitable for card chips, skipping the title
 * (always shown as the card heading), the cover source, and any property the
 * user has hidden via `view.hiddenProperties`.
 */
function pickDisplayProperties(
  properties: PropertyDef[],
  titleProp: PropertyDef | null,
  coverProp: PropertyDef | null,
  hidden: Set<string>,
  max: number,
): PropertyDef[] {
  const out: PropertyDef[] = [];
  for (const p of properties) {
    if (out.length >= max) break;
    if (p.type === 'title') continue;
    if (titleProp && p.id === titleProp.id) continue;
    if (coverProp && p.id === coverProp.id) continue;
    if (hidden.has(p.id)) continue;
    out.push(p);
  }
  return out;
}

function findOption(options: SelectOption[] | undefined, value: unknown): SelectOption | null {
  if (!options || typeof value !== 'string') return null;
  return options.find((o) => o.value === value) ?? null;
}

function attachmentName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { name?: unknown };
  return typeof v.name === 'string' && v.name.length > 0 ? v.name : null;
}

function looksLikeImage(url: string): boolean {
  // Accept explicit image extensions (query-safe) or known image hosts.
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/.test(path);
  } catch {
    return false;
  }
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  // datetime-local stores 'YYYY-MM-DDTHH:mm' — the local date part is the
  // stable, timezone-ambiguous display value. Avoid `new Date(iso)` because a
  // date-only string is parsed as UTC and shifts a day in some zones.
  const datePart = iso.slice(0, 10);
  return datePart || iso;
}

function formatNumber(value: unknown, format: NonNullable<PropertyDef['numberFormat']>): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'percent':
      return `${(value * 100).toFixed(0)}%`;
    case 'currency':
      return `$${value.toFixed(2)}`;
    case 'decimal':
      return String(value);
    case 'integer':
    default:
      return String(Math.round(value));
  }
}

// Notion semantic color → bg/dot classes. Duplicated from PropertyCells.tsx so
// this renderer has zero runtime dependency on the cell-editing module.
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

function chipBgClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).bg;
}

function chipDotClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).dot;
}
