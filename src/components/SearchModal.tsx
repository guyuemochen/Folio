import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/invoke';
import { useWorkspaceStore } from '../store/workspaceStore';

interface SearchModalProps {
  onClose: () => void;
}

/**
 * Cmd+K global search modal.
 *
 * Behavior:
 *   - 480×640px modal, centered
 *   - Top: input with placeholder "Search pages and content..."
 *   - Body: grouped results
 *     - When query empty: show Recents (last 10 viewed pages)
 *     - When query non-empty: show search hits with snippet + <mark> highlight
 *   - Keyboard: ↑↓ navigate, Enter open, Escape close, Cmd+Enter open in place
 *   - Click item: open + close
 */
export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const recents = useWorkspaceStore((s) => s.recents);
  const rootPages = useWorkspaceStore((s) => s.rootPages);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);

  // Resolve recent page metadata from rootPages (cheap client-side lookup)
  const recentPages = useMemo(() => {
    return recents
      .map((id) => rootPages.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p);
  }, [recents, rootPages]);

  // Debounced search
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebounced(trimmedQuery, 120);

  const { data: hits, isFetching } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => api.search(debouncedQuery, 30),
    enabled: debouncedQuery.length > 0,
  });

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery, hits]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Body scroll lock while modal open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const openPage = (pageId: string) => {
    setCurrentPage(pageId);
    onClose();
  };

  // Build a flat list of items (for keyboard nav)
  const flatItems: Array<
    | { kind: 'recent'; id: string; title: string; icon: string | null; sub: string }
    | { kind: 'hit'; id: string; title: string; icon: string | null; sub: string; snippet: string }
  > = useMemo(() => {
    if (trimmedQuery) {
      return (hits ?? []).map((h) => ({
        kind: 'hit' as const,
        id: h.pageId,
        title: h.title || 'Untitled',
        icon: h.icon,
        sub: h.parentType === 'workspace' ? 'Workspace' : h.parentType,
        snippet: h.snippet,
      }));
    }
    return recentPages.map((p) => ({
      kind: 'recent' as const,
      id: p.id,
      title: p.title || 'Untitled',
      icon: p.icon,
      sub: 'Recent',
    }));
  }, [trimmedQuery, hits, recentPages]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[selectedIndex];
        if (item) openPage(item.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatItems, selectedIndex, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[560px] max-h-[70vh] flex flex-col rounded-lg border border-border-hairline bg-bg-page shadow-popover overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-border-hairline">
          <span className="text-text-tertiary text-[15px]">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and content..."
            className="flex-1 py-3.5 text-[15px] bg-transparent outline-none placeholder:text-text-tertiary"
          />
          {isFetching && (
            <span className="text-[11px] text-text-tertiary animate-pulse">searching…</span>
          )}
          <kbd className="px-1.5 py-0.5 text-[10px] text-text-tertiary bg-bg-section rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {flatItems.length === 0 ? (
            <div className="px-4 py-12 text-center text-[13px] text-text-tertiary">
              {trimmedQuery
                ? `No results for "${trimmedQuery}"`
                : 'Type to search across all your pages'}
            </div>
          ) : (
            <>
              {!trimmedQuery && (
                <SectionLabel>Recent</SectionLabel>
              )}
              {trimmedQuery && hits && hits.length > 0 && (
                <SectionLabel>Results ({hits.length})</SectionLabel>
              )}
              {flatItems.map((item, idx) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  data-search-index={idx}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => openPage(item.id)}
                  className={[
                    'w-full text-left px-3 py-2 flex items-start gap-3 transition-colors',
                    idx === selectedIndex ? 'bg-bg-active' : 'hover:bg-bg-hover',
                  ].join(' ')}
                >
                  <span className="flex-shrink-0 text-[15px] mt-0.5">{item.icon ?? '📄'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] text-text-primary truncate">
                      {item.title}
                    </span>
                    {item.kind === 'hit' && item.snippet && (
                      <span
                        className="block text-[12px] text-text-tertiary line-clamp-2 mt-0.5"
                        // snippet is FTS5-generated and contains our <mark> tags — safe.
                        dangerouslySetInnerHTML={{ __html: item.snippet }}
                      />
                    )}
                    <span className="block text-[11px] text-text-tertiary/80 mt-0.5">
                      {item.sub}
                    </span>
                  </span>
                  {idx === selectedIndex && (
                    <span className="text-[10px] text-text-tertiary mt-1 px-1">
                      <kbd>↵</kbd>
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border-hairline text-[11px] text-text-tertiary flex items-center gap-3 bg-bg-section/40">
          <span>
            <kbd className="px-1 py-0.5 bg-bg-section rounded">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-bg-section rounded">↵</kbd> open
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-bg-section rounded">ESC</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
      {children}
    </div>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
