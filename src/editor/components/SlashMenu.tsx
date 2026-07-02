import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { filterCommands, type SlashCommandDef } from '../slashCommands';

interface SlashMenuProps {
  editor: Editor;
  query: string;
  /** Screen coordinates where the popover should anchor (caret position). */
  anchor: { top: number; left: number };
  onClose: () => void;
}

/**
 * Renders the slash command palette as a React portal-less popover.
 *
 * Behavior (PRD §5.1.2 + 02-notion-design-spec.md §5.3):
 *   - 280px wide, max-height 320px, 12px radius, multi-layer shadow
 *   - fuzzy filter across key/label/aliases
 *   - keyboard navigation (↑↓ + Enter)
 *   - click outside closes
 *   - Esc closes
 */
export function SlashMenu({ editor, query, anchor, onClose }: SlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = filterCommands(query);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-slash-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard handling
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(commands.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + commands.length) % Math.max(commands.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = commands[selectedIndex];
        if (cmd) {
          cmd.apply(editor);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [commands, selectedIndex, editor, onClose]);

  // Click outside closes
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (listRef.current && !listRef.current.contains(target)) {
        onClose();
      }
    };
    // Defer attaching so the click that opened the menu doesn't immediately close it
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  if (commands.length === 0) {
    return (
      <div
        className="fixed z-[1000] w-[280px] rounded-md border border-border-hairline bg-bg-page shadow-popover py-3 px-3 text-[13px] text-text-tertiary"
        style={{ top: anchor.top, left: anchor.left }}
      >
        No matching blocks
      </div>
    );
  }

  // Group by category preserving order
  const grouped: Record<string, SlashCommandDef[]> = {};
  for (const cmd of commands) {
    (grouped[cmd.category] ??= []).push(cmd);
  }
  let runningIndex = 0;

  return (
    <div
      ref={listRef}
      className="fixed z-[1000] w-[280px] max-h-[320px] overflow-y-auto rounded-md border border-border-hairline bg-bg-page shadow-popover py-1.5 text-[13px]"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {(['basic', 'list', 'advanced'] as const).map((cat) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="mb-1">
            <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
              {cat === 'basic' ? 'Basic' : cat === 'list' ? 'List' : 'Advanced'}
            </div>
            {items.map((cmd) => {
              const idx = runningIndex++;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.key}
                  data-slash-index={idx}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    cmd.apply(editor);
                    onClose();
                  }}
                  className={[
                    'w-full flex items-center gap-2.5 px-2 py-1 text-left',
                    'transition-colors',
                    isSelected ? 'bg-bg-active' : 'hover:bg-bg-hover',
                  ].join(' ')}
                >
                  <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded bg-bg-section text-[12px] font-mono text-text-secondary">
                    {cmd.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-text-primary truncate">
                      {cmd.label}
                    </span>
                    <span className="block text-[11px] text-text-tertiary truncate">
                      {cmd.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
