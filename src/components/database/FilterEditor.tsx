import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type {
  FilterGroup,
  FilterLeaf,
  FilterNode,
  PropertyDef,
  PropertyType,
  SelectOption,
} from '../../lib/types';
import { makeGroup, makeLeaf, operatorNeedsValue, operatorsFor } from './filterEngine';

interface FilterEditorProps {
  filter: FilterNode | null;
  properties: PropertyDef[];
  onClose: () => void;
  onChange: (next: FilterNode | null) => void;
}

/**
 * Filter editor modal (PRD §5.3.4). 600px wide.
 *
 * Renders a recursive AND/OR tree. The root is always a group; nested groups
 * are allowed at arbitrary depth to support complex strategies such as
 * ((A AND B) OR (C AND D)) AND (E OR F).
 */
export function FilterEditor({ filter, properties, onClose, onChange }: FilterEditorProps) {
  const { t } = useTranslation();
  const [root, setRoot] = useState<FilterGroup>(() =>
    filter && filter.kind === 'group' ? filter : { kind: 'group', op: 'and', children: filter && filter.kind === 'leaf' ? [filter] : [] },
  );

  const update = (next: FilterGroup) => {
    setRoot(next);
  };

  const save = () => {
    onChange(root.children.length === 0 ? null : root);
    onClose();
  };

  const clearAll = () => {
    onChange(null);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        data-popover-root
        className="relative w-[600px] max-h-[76vh] overflow-y-auto rounded-lg border border-border-hairline bg-bg-page shadow-popover"
      >
        <div className="px-5 py-4 border-b border-border-hairline flex items-center justify-between">
          <span className="text-sm font-semibold">{t('database.filter')}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4">
          <GroupEditor
            group={root}
            depth={0}
            properties={properties}
            onChange={(g) => update(g)}
          />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border-hairline bg-bg-section/50">
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-status-red hover:underline"
          >
            Clear all
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-md hover:bg-bg-hover text-text-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              {t('common.done')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface GroupEditorProps {
  group: FilterGroup;
  depth: number;
  properties: PropertyDef[];
  onChange: (next: FilterGroup) => void;
}

/** Reasonable guard against runaway nesting. 10 levels is far beyond any
 * realistic filter — each level adds visual indentation + a border, so deep
 * trees are self-discouraging in the UI. */
const MAX_DEPTH = 10;

function GroupEditor({ group, depth, properties, onChange }: GroupEditorProps) {
  const { t } = useTranslation();
  const setOp = (op: 'and' | 'or') => onChange({ ...group, op });

  const addLeaf = () => {
    const firstProp = properties[0];
    if (!firstProp) return;
    onChange({ ...group, children: [...group.children, makeLeaf(firstProp)] });
  };

  const addSubgroup = () => {
    onChange({ ...group, children: [...group.children, makeGroup('and')] });
  };

  const replaceChild = (idx: number, node: FilterNode) => {
    const next = [...group.children];
    next[idx] = node;
    onChange({ ...group, children: next });
  };

  const removeChild = (idx: number) => {
    onChange({ ...group, children: group.children.filter((_, i) => i !== idx) });
  };

  return (
    <div className={depth > 0 ? 'ml-3 pl-3 border-l-2 border-border-strong/40' : ''}>
      <div className="flex items-center gap-1 mb-2">
        <span className="text-xs text-text-tertiary mr-1">{t('database.match')}</span>
        <Toggle active={group.op === 'and'} onClick={() => setOp('and')}>
          {t('database.and')}
        </Toggle>
        <Toggle active={group.op === 'or'} onClick={() => setOp('or')}>
          {t('database.or')}
        </Toggle>
      </div>

      <div className="space-y-1.5">
        {group.children.map((child, idx) => (
          <div key={idx}>
            {child.kind === 'group' ? (
              <div className="flex items-start gap-1">
                <div className="flex-1">
                  <GroupEditor
                    group={child}
                    depth={depth + 1}
                    properties={properties}
                    onChange={(g) => replaceChild(idx, g)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeChild(idx)}
                  className="mt-1 text-text-tertiary hover:text-status-red px-1"
                  title={t('database.removeGroup')}
                >
                  ×
                </button>
              </div>
            ) : (
              <LeafRow
                leaf={child}
                properties={properties}
                onChange={(l) => replaceChild(idx, l)}
                onRemove={() => removeChild(idx)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={addLeaf}
          className="text-xs text-accent hover:underline"
        >
          {t('database.addFilter')}
        </button>
        {depth < MAX_DEPTH && (
          <button
            type="button"
            onClick={addSubgroup}
            className="text-xs text-text-tertiary hover:text-text-primary"
          >
            {t('database.addGroup')}
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2 py-0.5 text-[11px] font-medium rounded transition-colors',
        active ? 'bg-accent text-white' : 'bg-bg-hover text-text-secondary hover:bg-bg-active',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

interface LeafRowProps {
  leaf: FilterLeaf;
  properties: PropertyDef[];
  onChange: (next: FilterLeaf) => void;
  onRemove: () => void;
}

function LeafRow({ leaf, properties, onChange, onRemove }: LeafRowProps) {
  const { t } = useTranslation();
  const prop = properties.find((p) => p.id === leaf.propertyId) ?? properties[0];
  const type: PropertyType = prop?.type ?? 'rich_text';
  const ops = operatorsFor(type);
  const needsValue = operatorNeedsValue(leaf.operator);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        value={leaf.propertyId}
        onChange={(e) => {
          const next = properties.find((p) => p.id === e.target.value);
          if (next) onChange(makeLeaf(next));
        }}
        className="px-2 py-1 text-xs border border-border-hairline rounded bg-bg-page outline-none focus:border-accent"
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={leaf.operator}
        onChange={(e) => onChange({ ...leaf, operator: e.target.value })}
        className="px-2 py-1 text-xs border border-border-hairline rounded bg-bg-page outline-none focus:border-accent"
      >
        {ops.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>

      {needsValue && (
        <ValueInput leaf={leaf} type={type} options={prop?.options ?? []} onChange={onChange} />
      )}

      <button
        type="button"
        onClick={onRemove}
        className="text-text-tertiary hover:text-status-red px-1"
        title={t('common.remove')}
      >
        ×
      </button>
    </div>
  );
}

/** Person is MVP-simplified to a single "Me" option (mirrors PersonCell). */
const PERSON_OPTIONS: SelectOption[] = [{ value: 'Me', color: 'blue' }];

function ValueInput({
  leaf,
  type,
  options,
  onChange,
}: {
  leaf: FilterLeaf;
  type: PropertyType;
  options: SelectOption[];
  onChange: (next: FilterLeaf) => void;
}) {
  const { t } = useTranslation();
  const setText = (v: string) => onChange({ ...leaf, value: v });
  const setNum = (v: string) => onChange({ ...leaf, value: v === '' ? null : Number(v) });

  const inputCls =
    'px-2 py-1 text-xs border border-border-hairline rounded bg-bg-page outline-none focus:border-accent min-w-[120px]';

  if (type === 'checkbox') {
    return (
      <select
        value={leaf.value === true ? 'true' : 'false'}
        onChange={(e) => onChange({ ...leaf, value: e.target.value === 'true' })}
        className={inputCls}
      >
        <option value="true">{t('database.checked')}</option>
        <option value="false">{t('database.unchecked')}</option>
      </select>
    );
  }

  if (type === 'number') {
    return (
      <input
        type="number"
        value={typeof leaf.value === 'number' ? leaf.value : ''}
        onChange={(e) => setNum(e.target.value)}
        className={inputCls}
      />
    );
  }

  if (type === 'date') {
    return (
      <input
        type="date"
        value={typeof leaf.value === 'string' ? leaf.value.slice(0, 10) : ''}
        onChange={(e) => setText(e.target.value)}
        className={inputCls}
      />
    );
  }

  // select / status / multi_select / person — dropdown with predefined options
  // instead of a plain text input that requires the user to type the exact
  // option value blind.
  if (type === 'select' || type === 'status' || type === 'multi_select' || type === 'person') {
    const opts = type === 'person' ? PERSON_OPTIONS : options;
    // No options defined on the property — fall back to text input.
    if (opts.length === 0) {
      return (
        <input
          type="text"
          value={typeof leaf.value === 'string' ? leaf.value : ''}
          placeholder={t('database.value')}
          onChange={(e) => setText(e.target.value)}
          className={inputCls}
        />
      );
    }
    const currentVal = typeof leaf.value === 'string' ? leaf.value : '';
    const valueInOptions = opts.some((o) => o.value === currentVal);
    return (
      <select
        value={currentVal}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        className={inputCls}
      >
        {currentVal === '' && (
          <option value="" disabled>
            {t('database.selectOption')}
          </option>
        )}
        {/* Orphan value: the option was deleted after the filter was saved.
            Show it so the user sees the stale value and can fix it. */}
        {!valueInOptions && currentVal !== '' && (
          <option value={currentVal}>{currentVal}</option>
        )}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value}
          </option>
        ))}
      </select>
    );
  }

  // text / rich_text / title / url
  return (
    <input
      type="text"
      value={typeof leaf.value === 'string' ? leaf.value : ''}
      placeholder={t('database.value')}
      onChange={(e) => setText(e.target.value)}
      className={inputCls}
    />
  );
}
