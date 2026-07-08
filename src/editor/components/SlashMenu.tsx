import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/core';
import {
  filterCommands,
  fuzzyMatch,
  loadSlashRecent,
  recordSlashRecent,
  recentCommands,
  SLASH_COMMANDS,
  type SlashCommandDef,
  type SlashTab,
} from '../slashCommands';

interface SlashMenuProps {
  editor: Editor;
  query: string;
  /** Screen coordinates where the popover should anchor (caret position). */
  anchor: { top: number; left: number };
  onClose: () => void;
}

const TABS: { id: SlashTab; tabKey: string }[] = [
  { id: 'all', tabKey: 'editor.tabAll' },
  { id: 'basic', tabKey: 'editor.tabBasic' },
  { id: 'database', tabKey: 'editor.tabDatabase' },
  { id: 'media', tabKey: 'editor.tabMedia' },
  { id: 'advanced', tabKey: 'editor.tabAdvanced' },
];

/**
 * Renders the slash command palette as a React portal-less popover.
 *
 * Behavior (PRD §5.1.2 + 02-notion-design-spec.md §5.3):
 *   - 280px wide, max-height 320px, 12px radius, multi-layer shadow
 *   - Tab bar: All / Basic / Database / Media / Advanced (default All)
 *   - Recent section showing last 5 used block types
 *   - fuzzy filter across key/label/aliases
 *   - keyboard navigation (↑↓ + Enter)
 *   - click outside closes
 *   - Esc closes
 *   - selecting a command records it in localStorage and persists recent.
 */
export function SlashMenu({ editor, query, anchor, onClose }: SlashMenuProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SlashTab>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const recentKeys = useMemo(() => loadSlashRecent(), []);
  const recent = useMemo(() => recentCommands(recentKeys), [recentKeys]);

  // Filtered commands for the active tab + query.
  const commands = useMemo(() => filterCommands(query, tab), [query, tab]);

  // Build the visible list, prepending Recent when applicable.
  // - Show "Recent" only on the All tab, with no query, and when there's at least one recent.
  const showRecent = tab === 'all' && query.length === 0 && recent.length > 0;
  const recentSet = useMemo(() => new Set(recent.map((r) => r.key)), [recent]);

  // Reset selection when query/tab/recent changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, tab, recent.length]);

  // Scroll selected item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-slash-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Flattened indexed list (matches the order rendered) for keyboard nav.
  const flat: SlashCommandDef[] = useMemo(() => {
    if (showRecent) {
      // Recent items first, then all commands excluding those already in recent.
      return [...recent, ...commands.filter((c) => !recentSet.has(c.key))];
    }
    return commands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecent, recent, commands, recentSet, query, tab]);

  // Keyboard handling.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(flat.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + flat.length) % Math.max(flat.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = flat[selectedIndex];
        if (cmd) {
          recordSlashRecent(cmd.key);
          cmd.apply(editor);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        // Cycle tabs on Tab/Shift+Tab.
        e.preventDefault();
        const idx = TABS.findIndex((t) => t.id === tab);
        const next = e.shiftKey ? (idx - 1 + TABS.length) % TABS.length : (idx + 1) % TABS.length;
        setTab(TABS[next].id);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [flat, selectedIndex, editor, onClose, tab]);

  // Click outside closes.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (listRef.current && !listRef.current.contains(target)) {
        onClose();
      }
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Group remaining (non-recent) commands by category preserving order.
  const grouped: Record<string, SlashCommandDef[]> = {};
  for (const cmd of commands) {
    if (showRecent && recentSet.has(cmd.key)) continue;
    (grouped[cmd.category] ??= []).push(cmd);
  }

  let runningIndex = 0;
  const categoryOrder: SlashTab[] = ['basic', 'database', 'media', 'advanced'];

  const isEmpty = flat.length === 0;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('editor.slashMenuLabel')}
      className="fixed z-[1000] w-[280px] max-h-[320px] overflow-hidden rounded-md border border-border-hairline bg-bg-page shadow-popover text-[13px]"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border-hairline px-1 pt-1">
        {TABS.map((tabDef) => {
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setTab(tabDef.id);
              }}
              className={[
                'px-2 py-1 text-[11px] rounded-t transition-colors',
                active
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-tertiary hover:text-text-primary',
              ].join(' ')}
            >
              {t(tabDef.tabKey)}
            </button>
          );
        })}
      </div>

      <div className="max-h-[280px] overflow-y-auto py-1">
        {isEmpty ? (
          <div className="px-3 py-4 text-text-tertiary">{t('editor.noMatchingBlocks')}</div>
        ) : (
          <>
            {showRecent && recent.length > 0 && (
              <div className="mb-1">
                <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                  {t('editor.recent')}
                </div>
                {recent.map((cmd) => {
                  const idx = runningIndex++;
                  return renderCommand(cmd, idx, selectedIndex, setSelectedIndex, editor, () => {
                    recordSlashRecent(cmd.key);
                    cmd.apply(editor);
                    onClose();
                  });
                })}
              </div>
            )}

            {categoryOrder
              .filter((c) => (grouped[c]?.length ?? 0) > 0)
              .map((cat) => (
                <div key={cat} className="mb-1">
                  <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                    {tabLabel(cat, t)}
                  </div>
                  {(grouped[cat] ?? []).map((cmd) => {
                    const idx = runningIndex++;
                    return renderCommand(cmd, idx, selectedIndex, setSelectedIndex, editor, () => {
                      recordSlashRecent(cmd.key);
                      cmd.apply(editor);
                      onClose();
                    });
                  })}
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function renderCommand(
  cmd: SlashCommandDef,
  idx: number,
  selectedIndex: number,
  setSelectedIndex: (i: number) => void,
  _editor: Editor,
  onPick: () => void,
) {
  const isSelected = idx === selectedIndex;
  return (
    <button
      key={cmd.key}
      type="button"
      data-slash-index={idx}
      role="option"
      aria-selected={isSelected}
      onMouseEnter={() => setSelectedIndex(idx)}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={[
        'w-full flex items-center gap-2.5 px-2 py-1 text-left transition-colors',
        isSelected ? 'bg-bg-active' : 'hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded bg-bg-section text-[12px] font-mono text-text-secondary">
        {cmd.icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-text-primary truncate">{cmd.label}</span>
        <span className="block text-[11px] text-text-tertiary truncate">{cmd.description}</span>
      </span>
    </button>
  );
}

function tabLabel(cat: SlashTab, t: (key: string) => string): string {
  switch (cat) {
    case 'basic':
      return t('editor.categoryBasic');
    case 'database':
      return t('editor.categoryDatabase');
    case 'media':
      return t('editor.categoryMedia');
    case 'advanced':
      return t('editor.categoryAdvanced');
    default:
      return cat;
  }
}

// Re-export for tests / external use.
export { SLASH_COMMANDS, fuzzyMatch };
