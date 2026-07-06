import { useState } from 'react';
import type { PropertyDef, PropertyType, SelectOption } from '../../lib/types';
import { Popover } from '../ui/Popover';

const COLOR_CHOICES = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

const TYPE_LABELS: { value: PropertyType; label: string; icon: string }[] = [
  { value: 'rich_text', label: 'Text', icon: 'Aa' },
  { value: 'number', label: 'Number', icon: '#' },
  { value: 'select', label: 'Select', icon: '◉' },
  { value: 'multi_select', label: 'Multi-select', icon: ' ◐' },
  { value: 'status', label: 'Status', icon: '◐' },
  { value: 'date', label: 'Date', icon: '🗓' },
  { value: 'checkbox', label: 'Checkbox', icon: '☑' },
  { value: 'url', label: 'URL', icon: '🔗' },
];

interface PropertyMenuProps {
  /** Anchor rectangle used by Popover for fixed positioning (escapes table overflow). */
  anchorRect: DOMRect;
  /** Existing property when editing; `undefined` when creating new. */
  property?: PropertyDef;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    type: PropertyType;
    options?: SelectOption[];
    numberFormat?: string;
  }) => void;
  onDelete?: () => void;
  /** Column-level quick actions (only shown when editing an existing column). */
  onSort?: () => void;
  onFilter?: () => void;
  onHide?: () => void;
  onDuplicate?: () => void;
}

/**
 * Property add/edit menu — opened from a database column header.
 *
 * Renders via Popover (React Portal) so it isn't clipped by the table's
 * `overflow-x-auto` container. Anchor rect is computed by the caller and
 * passed in.
 *
 * When editing an existing column, a quick-actions row (Sort / Filter / Hide /
 * Duplicate) is shown at the top per PRD §5.3.3.
 */
export function PropertyMenu({
  anchorRect,
  property,
  onClose,
  onSubmit,
  onDelete,
  onSort,
  onFilter,
  onHide,
  onDuplicate,
}: PropertyMenuProps) {
  const [name, setName] = useState(property?.name ?? '');
  const [type, setType] = useState<PropertyType>(property?.type ?? 'rich_text');
  const [options, setOptions] = useState<SelectOption[]>(property?.options ?? []);
  const [numberFormat, setNumberFormat] = useState<string>(
    property?.numberFormat ?? 'integer',
  );

  const isEditing = !!property;
  const canChangeType = !property || property.type !== 'title';

  const submit = () => {
    onSubmit({
      name: name.trim() || 'Untitled',
      type,
      options: ['select', 'multi_select', 'status'].includes(type) ? options : undefined,
      numberFormat: type === 'number' ? numberFormat : undefined,
    });
  };

  const needsOptions = ['select', 'multi_select', 'status'].includes(type);

  return (
    <Popover
      anchorRect={anchorRect}
      placement="bottom-start"
      width={320}
      onClose={onClose}
    >
      <div className="p-4">
        {/* Header */}
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          {isEditing ? 'Edit property' : 'New property'}
        </div>

        {/* Quick actions — column-level (Sort / Filter / Hide / Duplicate) */}
        {isEditing && (onSort || onFilter || onHide || onDuplicate) && (
          <div className="mb-3 grid grid-cols-2 gap-1">
            {onSort && (
              <QuickAction icon="↕" label="Sort" onClick={() => run(onSort)} />
            )}
            {onFilter && (
              <QuickAction icon="▽" label="Filter" onClick={() => run(onFilter)} />
            )}
            {onHide && (
              <QuickAction icon="◐" label="Hide" onClick={() => run(onHide)} />
            )}
            {onDuplicate && (
              <QuickAction icon="⧉" label="Duplicate" onClick={() => run(onDuplicate)} />
            )}
          </div>
        )}

        {/* Name */}
        <label className="block text-xs text-text-secondary mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full px-2.5 py-1.5 mb-3 text-sm border border-border-hairline rounded-md outline-none focus:border-accent transition-colors"
        />

        {/* Type */}
        {canChangeType && (
          <>
            <label className="block text-xs text-text-secondary mb-1">Type</label>
            <div className="grid grid-cols-2 gap-1 mb-3">
              {TYPE_LABELS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={[
                    'flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-colors',
                    type === t.value
                      ? 'bg-bg-active text-accent font-medium'
                      : 'hover:bg-bg-hover text-text-secondary',
                  ].join(' ')}
                >
                  <span className="w-4 text-center text-[11px]">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Number format */}
        {type === 'number' && (
          <div className="mb-3">
            <label className="block text-xs text-text-secondary mb-1">Number format</label>
            <select
              value={numberFormat}
              onChange={(e) => setNumberFormat(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border-hairline rounded-md bg-bg-page outline-none focus:border-accent"
            >
              <option value="integer">1,234</option>
              <option value="decimal">1,234.56</option>
              <option value="percent">12%</option>
              <option value="currency">$1,234</option>
            </select>
          </div>
        )}

        {/* Options editor */}
        {needsOptions && (
          <div className="mb-3">
            <label className="block text-xs text-text-secondary mb-1.5">Options</label>
            <div className="space-y-1 mb-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${dotClass(opt.color)}`}
                    title={opt.color}
                  />
                  <input
                    type="text"
                    value={opt.value}
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...opt, value: e.target.value };
                      setOptions(next);
                    }}
                    className="flex-1 px-2 py-1 text-xs border border-border-hairline rounded outline-none focus:border-accent"
                  />
                  <select
                    value={opt.color}
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...opt, color: e.target.value };
                      setOptions(next);
                    }}
                    className="px-1 py-1 text-[11px] border border-border-hairline rounded bg-bg-page outline-none"
                  >
                    {COLOR_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                    className="px-1 text-text-tertiary hover:text-status-red"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setOptions([
                  ...options,
                  {
                    value: `Option ${options.length + 1}`,
                    color: COLOR_CHOICES[options.length % COLOR_CHOICES.length]!,
                  },
                ])
              }
              className="text-xs text-accent hover:underline"
            >
              + Add option
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border-hairline bg-bg-section/50">
        <div>
          {isEditing && canChangeType && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-status-red hover:underline"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md hover:bg-bg-hover text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isEditing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </Popover>
  );
}

// === Color helpers (same as PropertyCells — duplicated to avoid circular import) ===

const COLOR_MAP: Record<string, { dot: string }> = {
  gray: { dot: 'bg-text-tertiary' },
  brown: { dot: 'bg-[#c9b5a8]' },
  orange: { dot: 'bg-[#ffaf80]' },
  yellow: { dot: 'bg-[#ffcc00]' },
  green: { dot: 'bg-[#66d66b]' },
  blue: { dot: 'bg-accent' },
  purple: { dot: 'bg-[#9b7fdb]' },
  pink: { dot: 'bg-[#ff9bd6]' },
  red: { dot: 'bg-status-red' },
};

function dotClass(color: string): string {
  return (COLOR_MAP[color] ?? COLOR_MAP.gray).dot;
}

// === Quick-action button for the column menu (Sort/Filter/Hide/Duplicate) ===

function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-bg-hover text-text-secondary transition-colors"
    >
      <span className="w-4 text-center text-[11px]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Invoke a quick action then close the menu. */
function run(fn: () => void) {
  fn();
}
