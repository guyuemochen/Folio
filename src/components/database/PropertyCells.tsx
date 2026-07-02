import { useEffect, useRef, useState } from 'react';
import type { PropertyDef, SelectOption } from '../../lib/types';
import { Popover } from '../ui/Popover';

// ============================================================================
// Cell editors — one per PropertyType. All cells receive:
//   - `value`: current value (raw JSON from backend)
//   - `property`: schema (type + options + numberFormat)
//   - `onChange(newVal)`: commit (immediately calls backend)
// ============================================================================

interface CellProps {
  value: unknown;
  property: PropertyDef;
  onChange: (next: unknown) => void;
}

/** Cell types that don't need the property schema. */
type SimpleCellProps = Pick<CellProps, 'value' | 'onChange'>;

/** Dispatch to the right editor by property.type. */
export function PropertyCell({ value, property, onChange }: CellProps) {
  switch (property.type) {
    case 'title':
      return <TitleCell value={value} onChange={onChange} />;
    case 'rich_text':
      return <TextCell value={value} onChange={onChange} />;
    case 'number':
      return <NumberCell value={value} property={property} onChange={onChange} />;
    case 'checkbox':
      return <CheckboxCell value={value} onChange={onChange} />;
    case 'url':
      return <UrlCell value={value} onChange={onChange} />;
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
      return <DateCell value={value} onChange={onChange} />;
    case 'person':
      return <PlaceholderCell label="person (M3.5)" />;
    case 'files':
      return <PlaceholderCell label="files (M3.5)" />;
    default:
      return <PlaceholderCell label={property.type} />;
  }
}

// ---------------------------------------------------------------------------

function TitleCell({ value, onChange }: SimpleCellProps) {
  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : ''}
      placeholder="Untitled"
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent outline-none text-sm text-text-primary placeholder:text-text-tertiary"
    />
  );
}

function TextCell({ value, onChange }: SimpleCellProps) {
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
        onClick={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}
        className="w-full text-left text-sm text-text-primary truncate"
      >
        {draft || <span className="text-text-tertiary">Empty</span>}
      </button>
      {anchorRect && (
        <Popover anchorRect={anchorRect} placement="bottom-start" width={256} onClose={() => setAnchorRect(null)}>
          <textarea
            ref={taRef}
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
}

function NumberCell({ value, property, onChange }: CellProps) {
  const fmt = property.numberFormat ?? 'integer';
  const step = fmt === 'integer' ? 1 : fmt === 'percent' ? 0.01 : 0.001;
  return (
    <input
      type="number"
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
}

function CheckboxCell({ value, onChange }: SimpleCellProps) {
  const checked = value === true;
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-accent"
    />
  );
}

function UrlCell({ value, onChange }: SimpleCellProps) {
  const href = typeof value === 'string' ? value : '';
  return (
    <input
      type="url"
      value={href}
      placeholder="https://"
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent outline-none text-sm text-accent underline placeholder:text-text-tertiary"
    />
  );
}

function SelectCell({
  value,
  property,
  onChange,
  multi,
}: CellProps & { multi: boolean }) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const options: SelectOption[] = property.options ?? [];
  const EMPTY = <span className="text-text-tertiary">Empty</span>;

  if (options.length === 0) {
    return <PlaceholderCell label="no options" />;
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
}

function DateCell({ value, onChange }: SimpleCellProps) {
  const iso = typeof value === 'string' ? value : '';
  return (
    <input
      type="datetime-local"
      value={iso}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-transparent outline-none text-sm text-text-primary"
    />
  );
}

function PlaceholderCell({ label }: { label: string }) {
  return <span className="text-xs text-text-tertiary italic">{label}</span>;
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
