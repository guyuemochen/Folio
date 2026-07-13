import { createElement, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/invoke';
import { queryClient } from '../../lib/queryClient';
import type { DatabaseWithSchema, PageSummary } from '../../lib/types';

interface LinkedDatabasePickerProps {
  onClose: () => void;
  onPick: (databaseId: string) => void;
}

/**
 * Picker modal for the `/linked-database` slash command (PRD §5.3.8).
 *
 * Lists every database in the workspace (root + nested) and lets the user
 * choose one to embed inline. Since `PageSummary` doesn't carry `type`, we
 * resolve candidates by calling `getDatabase` on each page in parallel —
 * pages that aren't databases 404 and are filtered out.
 */
export function LinkedDatabasePicker({ onClose, onPick }: LinkedDatabasePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // Root-level pages (databases typically live here, but may be nested).
  const { data: rootPages } = useQuery({
    queryKey: ['linked-db-picker-root'],
    queryFn: () => api.listPages(null),
  });

  // Resolve which of those pages are actually databases.
  const { data: databases, isLoading } = useQuery({
    queryKey: ['linked-db-picker-resolved', rootPages ?? []],
    queryFn: async () => {
      const pages = rootPages ?? [];
      const settled = await Promise.all(
        pages.map((p) =>
          api
            .getDatabase(p.id)
            .then((db: DatabaseWithSchema) => ({ page: p, db }))
            .catch(() => null),
        ),
      );
      return settled.filter((x): x is { page: PageSummary; db: DatabaseWithSchema } => x !== null);
    },
    enabled: !!rootPages,
  });

  const filtered = useMemo(() => {
    const list = databases ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(({ page }) => (page.title ?? '').toLowerCase().includes(q));
  }, [databases, query]);

  // Esc closes; ↑↓ + Enter navigate.
  const [selectedIdx, setSelectedIdx] = useState(0);
  useEffect(() => setSelectedIdx(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept keys during IME composition (e.g. Chinese input):
      // otherwise Enter used to confirm a candidate would pick the selected
      // database instead of letting the IME commit the character.
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % Math.max(filtered.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = filtered[selectedIdx];
        if (pick) onPick(pick.page.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, selectedIdx, onPick, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] bg-black/30 flex items-start justify-center pt-[14vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-popover-root
        className="relative w-[480px] max-h-[60vh] flex flex-col rounded-lg border border-border-hairline bg-bg-page shadow-popover"
      >
        <header className="px-4 py-3 border-b border-border-hairline flex items-center gap-2">
          <span className="text-sm font-semibold flex-1">{t('database.linkToDatabase')}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="px-3 py-2 border-b border-border-hairline">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('database.searchDatabases')}
            autoFocus
            className="w-full px-2.5 py-1.5 text-sm bg-bg-hover rounded outline-none placeholder:text-text-tertiary"
          />
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {isLoading && (
            <div className="px-4 py-6 text-center text-xs text-text-tertiary">{t('common.loading')}</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-tertiary">
              {t('database.noDatabases')}
            </div>
          )}
          {filtered.map(({ page, db }, idx) => {
            const isSelected = idx === selectedIdx;
            const rowCount = Math.max(0, (db.properties.length));
            return (
              <button
                key={page.id}
                type="button"
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => onPick(page.id)}
                className={[
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-bg-active' : 'hover:bg-bg-hover',
                ].join(' ')}
              >
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded bg-bg-section text-[13px]">
                  {page.icon ?? '📊'}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-text-primary truncate">
                    {page.title || t('common.untitledDatabase')}
                  </span>
                  <span className="block text-[11px] text-text-tertiary">
                    {t('database.propertyCount', { count: rowCount })}
                  </span>
                </span>
                {isSelected && <span className="text-[11px] text-accent">↵</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// Self-mounting helper — lets the slash command open the picker without
// needing a parent component to render it.
// ============================================================================

/**
 * Imperatively open the picker (used by the `/linked-database` slash command).
 * Resolves with the picked database id, or null if the user cancelled.
 */
export function openLinkedDatabasePicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.dataset.linkedDbPicker = 'true';
    document.body.appendChild(host);

    let settled = false;
    let root: ReturnType<typeof createRoot> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      // Defer unmount so React finishes its current commit first.
      requestAnimationFrame(() => {
        try {
          root?.unmount();
        } catch (err) {
          console.error('[Folio] picker unmount failed', err);
        }
        host.remove();
      });
    };

    root = createRoot(host);
    const handlePick = (id: string) => {
      cleanup();
      resolve(id);
    };
    const handleClose = () => {
      cleanup();
      resolve(null);
    };

    // The picker mounts its own React root on document.body (detached from the
    // <App/> tree), so it has no access to the app's <QueryClientProvider>.
    // Wrap it explicitly with the shared client — otherwise the `useQuery`
    // calls inside LinkedDatabasePicker throw "No QueryClient set" and the
    // picker crashes silently the moment it mounts.
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(LinkedDatabasePicker, { onPick: handlePick, onClose: handleClose }),
      ),
    );
  });
}
