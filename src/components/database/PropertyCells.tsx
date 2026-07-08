import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../../lib/invoke';
import type { AttachmentInfo, PropertyDef, SelectOption } from '../../lib/types';
import { Popover } from '../ui/Popover';

// ============================================================================
// Cell editors — one per PropertyType. All cells receive:
//   - `value`: current value (raw JSON from backend)
//   - `property`: schema (type + options + numberFormat)
//   - `onChange(newVal)`: commit (immediately calls backend)
// FilesCell additionally uses `pageId` + `databaseId` to copy the picked file.
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
    default:
      return <PlaceholderCell label={property.type} />;
  }
});

// ---------------------------------------------------------------------------

const TitleCell = memo(function TitleCell({ value, property, onChange }: SimpleCellProps) {
  const { t } = useTranslation();
  return (
    <input
      type="text"
      aria-label={property?.name ?? t('editor.text')}
      value={typeof value === 'string' ? value : ''}
      placeholder={t('common.untitled')}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent outline-none text-sm text-text-primary placeholder:text-text-tertiary"
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
    <input
      type="checkbox"
      aria-label={property?.name ?? t('database.typeCheckbox')}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-accent"
    />
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
  const iso = typeof value === 'string' ? value : '';
  return (
    <input
      type="datetime-local"
      aria-label={property?.name ?? t('database.typeDate')}
      value={iso}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-transparent outline-none text-sm text-text-primary"
    />
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
