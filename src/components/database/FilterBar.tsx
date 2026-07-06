import type { FilterNode, PropertyDef } from '../../lib/types';
import { flattenChips } from './filterEngine';

interface FilterBarProps {
  filter: FilterNode | null;
  properties: PropertyDef[];
  onOpenEditor: () => void;
  onRemoveLeaf: (leaf: FilterLeaf) => void;
}

import type { FilterLeaf } from '../../lib/types';

/**
 * Filter bar (PRD §5.3.4): 36px tall, white bg + border-bottom, sits below the
 * table header. Shows one pill chip per leaf filter with a × to remove.
 */
export function FilterBar({ filter, properties, onOpenEditor, onRemoveLeaf }: FilterBarProps) {
  const chips = flattenChips(filter, properties);
  if (chips.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-hairline bg-bg-page">
        <button
          type="button"
          onClick={onOpenEditor}
          className="text-xs text-accent hover:underline"
        >
          + Add filter
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 h-9 border-b border-border-hairline bg-bg-page overflow-x-auto">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-bg-hover text-text-secondary text-[11px] whitespace-nowrap"
        >
          <span className="text-text-tertiary">{chip.propertyName}</span>
          <span>{chip.operatorLabel}</span>
          {chip.valueLabel && <span className="font-medium text-text-primary">{chip.valueLabel}</span>}
          <button
            type="button"
            onClick={() => onRemoveLeaf(chip.leaf)}
            className="text-text-tertiary hover:text-status-red leading-none"
            title="Remove filter"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onOpenEditor}
        className="text-xs text-accent hover:underline ml-1"
      >
        + Add filter
      </button>
    </div>
  );
}
