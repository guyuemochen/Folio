import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../../lib/invoke';
import type { AttachmentInfo, DatabaseRow, PropertyDef, SelectOption } from '../../lib/types';
import { buildRowResolver } from '../../lib/formula/context';
import { evalFormula, FormulaError } from '../../lib/formula/evaluator';
import { Popover } from '../ui/Popover';

// ============================================================================
// Cell editors — one per PropertyType. All cells receive:
//   - `value`: current value (raw JSON from backend)
//   - `property`: schema (type + options + numberFormat)
//   - `onChange(newVal)`: commit (immediately calls backend)
// FilesCell additionally uses `pageId` + `databaseId` to copy the picked file.
// FormulaCell additionally uses `row` + `schemaProperties` to compute its value.
// ============================================================================

interface CellProps {
  value: unknown;
  property: PropertyDef;
  onChange: (next: unknown) => void;
  /** Row page id — needed by FilesCell to scope attachment writes. */
  pageId?: string;
  /** Owning database id — needed by FilesCell for the attachments subdir. */
  databaseId?: string;
  /** Called after FilesCell persists so the parent can refetch. */
  onAfterCommit?: () => void;
  /** Full row — needed by FormulaCell to resolve prop() references. */
  row?: DatabaseRow;
  /** All database properties — needed by FormulaCell to build its resolver. */
  schemaProperties?: PropertyDef[];
}

/** Cell types that don't need the property schema (property is optional, used only for aria-label). */
type SimpleCellProps = Pick<CellProps, 'value' | 'onChange'> & { property?: PropertyDef };

/** Dispatch to the right editor by property.type. */
export const PropertyCell = memo(function PropertyCell({
  value,
  property,
  onChange,
  pageId,
  databaseId,
  onAfterCommit,
  row,
  schemaProperties,
}: CellProps) {
  switch (property.type) {
    case 'title':
      return <TitleCell value={value} property={property} onChange={onChange} />;
    case 'rich_text':
      return <TextCell value={value} property={property} onChange={onChange} />;
    case 'number':
      return <NumberCell value={value} property={property} onChange={onChange} />;
    case 'checkbox':
      return <CheckboxCell value={value} property={property} onChange={onChange} />;
    case 'url':
      return <UrlCell value={value} property={property} onChange={onChange} />;
    case 'select':
    case 'status':
      return (
        <SelectCell value={value} property={property} onChange={onChange} multi={false} />
      );
    case 'multi_select':
      return (
        <SelectCell value={value} property={property} onChange={onChange} multi={true} />
      );
    case 'date':
      return <DateCell value={value} property={property} onChange={onChange} />;
    case 'created_time':
    case 'last_edited_time':
      return <TimestampCell value={value} property={property} />;
    case 'person':
      return <PersonCell value={value} property={property} onChange={onChange} />;
    case 'files':
      return (
        <FilesCell
          value={value}
          property={property}
          onChange={onChange}
          pageId={pageId}
          databaseId={databaseId}
          onAfterCommit={onAfterCommit}
        />
      );
    case 'formula':
      return (
        <FormulaCell property={property} row={row} schemaProperties={schemaProperties} />
      );
    default:
      return <PlaceholderCell label={property.type} />;
  }
});

// ---------------------------------------------------------------------------

const TitleCell = memo(function TitleCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  // Drive the DOM from a local draft, not directly from the backend value.
  // The old per-keystroke `onChange(e.target.value)` round-tripped every IME
  // intermediate state ("n" → "ni" → "nihao") through updateCell + refetchRows,
  // which re-rendered this controlled input mid-composition and broke Chinese
  // input (stray Latin letters, broken backspace). With a local draft the
  // input is never reset while focused; the backend is updated via a debounce
  // and on blur, so IME composition proceeds undisturbed.
  const strValue = typeof value === 'string' ? value : '';
  const [draft, setDraft] = useState(strValue);
  const focusedRef = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the draft from the backend value, but only while the input is NOT
  // focused — otherwise a stale refetch landing mid-typing would clobber the
  // user's current edit.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(typeof value === 'string' ? value : '');
    }
  }, [value]);

  // Flush any pending debounced commit if the cell unmounts.
  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, []);

  const scheduleCommit = (val: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      onChange(val);
    }, 400);
  };

  const flushCommit = (val: string) => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (val !== strValue) onChange(val);
  };

  return (
    <input
      type="text"
      aria-label={property?.name ?? t('editor.text')}
      value={draft}
      placeholder={t('common.untitled')}
      onChange={(e) => {
        setDraft(e.target.value);
        scheduleCommit(e.target.value);
      }}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        flushCommit(draft);
      }}
      className="w-full min-w-0 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-tertiary"
    />
  );
});

const TextCell = memo(function TextCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '');
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (anchorRect) {
      taRef.current?.focus();
    }
  }, [anchorRect]);

  return (
    <>
      <button
        type="button"
        aria-label={property?.name ?? t('editor.text')}
        onClick={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}
        className="w-full text-left text-sm text-text-primary truncate"
      >
        {draft || <span className="text-text-tertiary">{t('common.empty')}</span>}
      </button>
      {anchorRect && (
        <Popover anchorRect={anchorRect} placement="bottom-start" width={256} onClose={() => setAnchorRect(null)}>
          <textarea
            ref={taRef}
            aria-label={property?.name ?? t('editor.text')}
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onChange(draft);
              setAnchorRect(null);
            }}
            className="w-full px-2.5 py-2 text-sm outline-none resize-none bg-transparent"
          />
        </Popover>
      )}
    </>
  );
});

const NumberCell = memo(function NumberCell({ value, property, onChange }: CellProps) {
  const fmt = property.numberFormat ?? 'integer';
  const step = fmt === 'integer' ? 1 : fmt === 'percent' ? 0.01 : 0.001;
  return (
    <input
      type="number"
      aria-label={property.name}
      step={step}
      value={typeof value === 'number' ? value : ((value as string | undefined) ?? '')}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') return onChange(null);
        const n = Number(v);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="w-full bg-transparent outline-none text-sm text-text-primary"
    />
  );
});

const CheckboxCell = memo(function CheckboxCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  const checked = value === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={property?.name ?? t('database.typeCheckbox')}
      // stopPropagation so toggling the box doesn't also trigger row selection
      // (the parent <tr> has an onClick for click/shift/ctrl multi-select).
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={[
        'inline-flex items-center justify-center flex-shrink-0',
        'w-4 h-4 rounded-[4px] border transition-colors duration-150',
        checked
          ? 'bg-accent border-accent'
          : 'bg-bg-page border-border-control hover:border-accent hover:bg-bg-hover',
      ].join(' ')}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        // stroke-bg-page adapts to the theme: white check on the blue box in
        // light mode, dark-navy check on the light-blue box in dark mode — both
        // clear WCAG AA contrast against the accent fill.
        className={[
          'w-[10px] h-[10px] stroke-bg-page origin-center',
          'transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        ].join(' ')}
        aria-hidden="true"
      >
        <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" />
      </svg>
    </button>
  );
});

const UrlCell = memo(function UrlCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  const href = typeof value === 'string' ? value : '';
  return (
    <input
      type="url"
      aria-label={property?.name ?? t('database.typeUrl')}
      value={href}
      placeholder={t('database.urlPlaceholder')}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent outline-none text-sm text-accent underline placeholder:text-text-tertiary"
    />
  );
});

const SelectCell = memo(function SelectCell({
  value,
  property,
  onChange,
  multi,
}: CellProps & { multi: boolean }) {
  const { t } = useTranslation();
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const options: SelectOption[] = property.options ?? [];
  const EMPTY = <span className="text-text-tertiary">{t('common.empty')}</span>;

  if (options.length === 0) {
    return <PlaceholderCell label={t('database.noOptions')} />;
  }

  const selectedValues: string[] = multi
    ? Array.isArray(value)
      ? (value as string[])
      : []
    : typeof value === 'string'
      ? [value]
      : [];

  const renderChip = (v: string) => {
    const opt = options.find((o) => o.value === v);
    if (!opt) return null;
    return (
      <span
        key={v}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${chipClass(opt.color)}`}
      >
        {opt.value}
      </span>
    );
  };

  const toggle = (val: string) => {
    if (multi) {
      const next = selectedValues.includes(val)
        ? selectedValues.filter((v) => v !== val)
        : [...selectedValues, val];
      onChange(next);
    } else {
      onChange(val === value ? null : val);
      setAnchorRect(null);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={property.name}
        onClick={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}
        className="w-full text-left text-sm flex flex-wrap gap-1 min-h-[20px]"
      >
        {selectedValues.length === 0 ? EMPTY : selectedValues.map(renderChip)}
      </button>
      {anchorRect && (
        <Popover anchorRect={anchorRect} placement="bottom-start" width={200} onClose={() => setAnchorRect(null)}>
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map((opt) => {
              const isSelected = selectedValues.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover text-left"
                >
                  <span className={`w-2 h-2 rounded-full ${dotClass(opt.color)}`} />
                  <span className="flex-1 truncate">{opt.value}</span>
                  {isSelected && <span className="text-accent font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
});

const DateCell = memo(function DateCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  const includeTime = !!property?.dateIncludeTime;
  const raw = typeof value === 'string' ? value : '';
  // `date` inputs take 'YYYY-MM-DD'; `datetime-local` take 'YYYY-MM-DDTHH:mm'.
  // Truncate legacy datetime values for date-only pickers so the browser
  // doesn't reject them. The stored value is never mutated here — only on edit.
  const iso = includeTime ? raw : raw.slice(0, 10);
  return (
    <input
      type={includeTime ? 'datetime-local' : 'date'}
      aria-label={property?.name ?? t('database.typeDate')}
      value={iso}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-transparent outline-none text-sm text-text-primary"
    />
  );
});

/**
 * Read-only cell for computed timestamp columns (created_time / last_edited_time).
 * The value is injected by the backend from the page's created_at / updated_at as
 * a local-naive 'YYYY-MM-DDTHH:mm' string — never editable, so no onChange.
 */
const TimestampCell = memo(function TimestampCell({
  value,
  property,
}: {
  value: unknown;
  property?: PropertyDef;
}) {
  const iso = typeof value === 'string' ? value : '';
  if (!iso) {
    return <span className="text-sm text-text-placeholder">—</span>;
  }
  // datetime-local shape parses as local time; format locale-aware, no seconds.
  const d = new Date(iso);
  const text = Number.isNaN(d.getTime())
    ? iso.replace('T', ' ')
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  return (
    <span
      className="text-sm text-text-secondary tabular-nums cursor-default select-none"
      aria-label={property?.name}
      title={text}
    >
      {text}
    </span>
  );
});

/**
 * Person cell — MVP simplification (PRD §5.3.2): single fixed option "Me".
 * Behaves like a single-select with one option. Click toggles between set/clear.
 */
const PersonCell = memo(function PersonCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  const isMe = value === 'Me';
  return (
    <button
      type="button"
      aria-label={property?.name ?? t('common.me')}
      onClick={() => onChange(isMe ? null : 'Me')}
      className="w-full text-left flex items-center gap-1.5 min-h-[20px]"
    >
      {isMe ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-bg-active text-accent">
          <span className="w-2 h-2 rounded-full bg-accent" />
          {t('common.me')}
        </span>
      ) : (
        <span className="text-text-tertiary">{t('common.empty')}</span>
      )}
    </button>
  );
});

/**
 * Files cell — picks a file via the Tauri dialog, copies it into the per-db
 * attachments dir (Rust side), and stores {name, path, size} as the cell value.
 * Renders a filename chip with a download icon.
 */
const FilesCell = memo(function FilesCell({
  value,
  property,
  onChange,
  pageId,
  databaseId,
  onAfterCommit,
}: CellProps) {
  const { t } = useTranslation();
  const info = toAttachment(value);
  const [busy, setBusy] = useState(false);

  const handlePick = async () => {
    if (!pageId || !databaseId || busy) return;
    try {
      setBusy(true);
      const selected = await open({ multiple: false });
      if (typeof selected !== 'string' || selected.length === 0) return;
      const result: AttachmentInfo = await api.attachFile(
        selected,
        databaseId,
        pageId,
        property.id,
      );
      onChange({ name: result.name, path: result.path, size: result.size });
      onAfterCommit?.();
    } catch (err) {
      console.error('[Folio] attach file failed', err);
    } finally {
      setBusy(false);
    }
  };

  if (info) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-bg-hover text-text-primary max-w-full">
        <span className="truncate max-w-[160px]" title={info.name}>
          {info.name}
        </span>
        <button
          type="button"
          aria-label={t('common.remove')}
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
          className="text-text-tertiary hover:text-status-red"
          title={t('common.remove')}
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={pageId ? t('database.attachFile') : t('database.saveRowFirst')}
      onClick={handlePick}
      disabled={!pageId || !databaseId || busy}
      className="text-text-tertiary hover:text-text-primary text-xs disabled:opacity-40"
      title={pageId ? t('database.attachFile') : t('database.saveRowFirst')}
    >
      {busy ? '…' : t('database.addFile')}
    </button>
  );
});

interface AttachmentShape {
  name: string;
  path: string;
  size?: number;
}

function toAttachment(value: unknown): AttachmentShape | null {
  if (value && typeof value === 'object') {
    const v = value as { name?: unknown; path?: unknown; size?: unknown };
    if (typeof v.name === 'string' && typeof v.path === 'string') {
      return {
        name: v.name,
        path: v.path,
        size: typeof v.size === 'number' ? v.size : undefined,
      };
    }
  }
  return null;
}

const PlaceholderCell = memo(function PlaceholderCell({ label }: { label: string }) {
  return <span className="text-xs text-text-tertiary italic">{label}</span>;
});

// ---------------------------------------------------------------------------
// FormulaCell — read-only, computes its value from other columns at render.
// ---------------------------------------------------------------------------

interface FormulaCellProps {
  property: PropertyDef;
  row?: DatabaseRow;
  schemaProperties?: PropertyDef[];
}

const FormulaCell = memo(function FormulaCell({
  property,
  row,
  schemaProperties,
}: FormulaCellProps) {
  const { t } = useTranslation();
  const formula = property.formula ?? '';
  const display = property.formulaDisplay ?? 'number';

  // Compute (and memoize) the value. Recomputes only when the inputs that
  // affect the result change — `row.properties` is a stable reference per
  // fetch, so editing an unrelated column won't recompute every formula cell.
  const { value, error } = useMemo(() => {
    if (!formula.trim() || !row || !schemaProperties) {
      return { value: null as ReturnType<typeof evalFormula>, error: null as string | null };
    }
    try {
      return { value: evalFormula(formula, buildRowResolver(schemaProperties, row)), error: null };
    } catch (e) {
      return { value: null, error: e instanceof FormulaError ? e.message : String(e) };
    }
  }, [formula, row, schemaProperties]);

  if (error) {
    return (
      <span
        className="text-xs text-status-red italic"
        title={error}
      >
        ⚠ {t('database.formulaError')}
      </span>
    );
  }

  return <FormulaValue value={value} display={display} />;
});

/** Render a computed formula value according to its display format. */
const FormulaValue = memo(function FormulaValue({
  value,
  display,
}: {
  value: ReturnType<typeof evalFormula>;
  display: NonNullable<PropertyDef['formulaDisplay']>;
}) {
  if (value === null || value === '') {
    return <span className="text-text-tertiary" />;
  }
  switch (display) {
    case 'text':
      return <span className="text-sm text-text-primary truncate">{String(value)}</span>;
    case 'checkbox':
      // truthy → checkmark, falsy → empty box (read-only, no toggle)
      return (
        <span className="text-sm text-text-primary" aria-label={value ? 'checked' : 'unchecked'}>
          {value === true || value === 1 || value === 'true' ? '✓' : '·'}
        </span>
      );
    case 'percent': {
      const n = toFinite(value);
      if (n === null) return <span className="text-text-tertiary" />;
      const pct = Math.round(n * 1000) / 10; // 1 decimal
      return <span className="text-sm text-text-primary tabular-nums">{pct}%</span>;
    }
    case 'currency': {
      const n = toFinite(value);
      if (n === null) return <span className="text-text-tertiary" />;
      return (
        <span className="text-sm text-text-primary tabular-nums">
          ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    }
    case 'progress': {
      const n = toFinite(value);
      if (n === null) return <span className="text-text-tertiary" />;
      const ratio = Math.max(0, Math.min(1, n)); // clamp 0–1
      return (
        <div className="flex items-center gap-2" title={`${Math.round(ratio * 100)}%`}>
          <div className="flex-1 h-1.5 rounded-full bg-border-control overflow-hidden min-w-[40px]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-text-tertiary tabular-nums">
            {Math.round(ratio * 100)}%
          </span>
        </div>
      );
    }
    case 'number':
    default: {
      const n = toFinite(value);
      if (n === null) return <span className="text-sm text-text-primary truncate">{String(value)}</span>;
      // Trim to a sane precision without trailing-zero noise.
      const shown = Math.round(n * 1e6) / 1e6;
      return <span className="text-sm text-text-primary tabular-nums">{shown}</span>;
    }
  }
});

/** Coerce a formula value to a finite number, or null if not numeric. */
function toFinite(v: ReturnType<typeof evalFormula>): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ============================================================================
// Helpers — Notion semantic color → bg/dot classes
// ============================================================================

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

function chipClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).bg;
}
function dotClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).dot;
}
