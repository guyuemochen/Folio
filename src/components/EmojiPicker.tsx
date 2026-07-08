import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from './ui/Popover';

/**
 * Minimal emoji picker — no npm dep.
 *
 * Renders a curated subset of the native emoji set, grouped by category.
 * Used for both page *icon* (40px display) and inline pickers.
 */

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮', '😴', '🤤',
    ],
  },
  {
    label: 'Gestures & People',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤙', '👈', '👉', '👆',
      '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '💪',
      '👋', '✍️', '👨‍💻', '👩‍💻', '🧑‍🎓', '👷', '🕵️', '🦸', '🦹', '🧙',
    ],
  },
  {
    label: 'Objects',
    emojis: [
      '📄', '📝', '📋', '📁', '📂', '📊', '📈', '🗒️', '🗓️', '📇',
      '📔', '📕', '📗', '📘', '📙', '📚', '✏️', '✒️', '🖊️', '🖌️',
      '💡', '🔍', '🔎', '🔗', '📎', '📌', '🏷️', '📦', '🗂️', '🔖',
      '⚙️', '🧰', '🔨', '🛠️', '🔧', '🧷', '💼', '💰', '💳', '🔑',
    ],
  },
  {
    label: 'Symbols',
    emojis: [
      '✅', '❌', '❗', '❓', '⭐', '🌟', '💫', '🔥', '💥', '💯',
      '⚠️', '🚫', '✔️', '➕', '➖', '❎', '🆕', '🆗', '🆒', '🏁',
      '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🎯',
    ],
  },
  {
    label: 'Nature',
    emojis: [
      '🌱', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁',
      '🍂', '🍃', '🌷', '🌹', '🌺', '🌸', '🌼', '🌻', '🌞', '🌙',
      '⭐', '🌟', '💫', '⚡', '🌈', '☁️', '⛅', '🌤️', '⛰️', '🏔️',
    ],
  },
];

interface EmojiPickerProps {
  anchorRect: DOMRect;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ anchorRect, onSelect, onClose }: EmojiPickerProps) {
  const { t } = useTranslation();
  const [activeCat, setActiveCat] = useState(0);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return CATEGORIES;
    return [
      {
        label: 'Results',
        emojis: CATEGORIES.flatMap((c) => c.emojis).filter(() => true),
      },
    ];
  }, [query]);

  return (
    <Popover anchorRect={anchorRect} placement="bottom-start" width={320} onClose={onClose}>
      <div className="p-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="w-full px-2 py-1 text-sm bg-bg-section rounded border border-border-hairline outline-none focus:border-accent"
          autoFocus
        />
      </div>
      {!query && (
        <div className="flex gap-1 px-2 pb-2 text-[11px]">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setActiveCat(i)}
              className={[
                'px-1.5 py-0.5 rounded',
                i === activeCat ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover',
              ].join(' ')}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="grid gap-0.5 px-2 pb-2"
        style={{
          gridTemplateColumns: 'repeat(10, 1fr)',
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
        {(filtered[activeCat]?.emojis ?? filtered[0].emojis).map((e, idx) => (
          <button
            key={`${e}-${idx}`}
            type="button"
            onClick={() => onSelect(e)}
            className="w-7 h-7 leading-none text-lg rounded hover:bg-bg-hover transition-colors"
            aria-label={`emoji ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="px-2 pb-2 pt-1 border-t border-border-hairline">
        <button
          type="button"
          onClick={() => onSelect('')}
          className="text-[11px] text-text-tertiary hover:text-text-primary"
        >
          {t('common.remove')}
        </button>
      </div>
    </Popover>
  );
}
