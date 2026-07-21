import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyDef } from '../../lib/types';
import { Popover, type PopoverPlacement } from '../ui/Popover';

/**
 * Property types eligible to drive a grouped layout (board columns or the
 * table view's row-grouping). Shared so the board header picker and the
 * table toolbar picker agree on what counts as "groupable".
 */
export const COL_GROUPABLE: PropertyDef['type'][] = ['select', 'multi_select', 'status'];

interface GroupMenuProps {
  /** Anchor rectangle from the trigger button's getBoundingClientRect().
   *  Required now that the menu is portaled via Popover — the previous
   *  inline `absolute right-0` positioning broke when the trigger lived
   *  inside an `overflow-hidden` ancestor (e.g. the board header), pushing
   *  the menu off-screen to the left and clipping its text. */
  anchorRect: DOMRect;
  /** All schema properties; the menu filters to groupable types. */
  properties: PropertyDef[];
  /** Currently selected property id, or null when grouping is off. */
  currentId: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  /** Popover placement relative to the anchor. Defaults to 'bottom-end'
   *  (right-aligned, matching the original toolbar trigger on the right
   *  side of the actions bar). Pass 'bottom-start' for triggers on the
   *  left side, e.g. the board header picker. */
  placement?: PopoverPlacement;
}

/**
 * Property picker for choosing which property drives a grouped layout.
 *
 * Lists only properties whose type is in {@link COL_GROUPABLE}. Selecting the
 * "no grouping" entry calls `onPick(null)`.
 *
 * Rendered through the shared {@link Popover} component so the menu is
 * portaled to `document.body`, escaping any `overflow-hidden` ancestor and
 * auto-flipping/clamping to stay inside the viewport.
 */
export function GroupMenu({
  anchorRect,
  properties,
  currentId,
  onPick,
  onClose,
  placement = 'bottom-end',
}: GroupMenuProps) {
  const { t } = useTranslation();
  const groupable = useMemo(
    () => properties.filter((p) => COL_GROUPABLE.includes(p.type)),
    [properties],
  );
  return (
    <Popover
      anchorRect={anchorRect}
      placement={placement}
      width={224}
      onClose={onClose}
      ariaLabel={t('database.group')}
    >
      <div className="max-h-72 overflow-y-auto py-1 text-sm text-text-primary">
        <button
          type="button"
          onClick={() => onPick(null)}
          className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover"
        >
          {t('database.noGrouping')}
        </button>
        {groupable.length > 0 && <div className="my-1 border-t border-border-hairline" />}
        {groupable.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="w-full text-left px-3 py-1.5 text-text-primary hover:bg-bg-hover flex items-center justify-between gap-2"
          >
            <span className="truncate">{p.name}</span>
            {currentId === p.id && <span className="text-accent shrink-0">✓</span>}
          </button>
        ))}
      </div>
    </Popover>
  );
}
