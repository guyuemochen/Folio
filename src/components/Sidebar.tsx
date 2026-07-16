import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { PageSummary } from '../lib/types';
import { PageTreeNode } from './PageTreeNode';

/**
 * Sidebar (PRD §5.2.3) — page-tree navigation.
 *
 *   [Workspace Switcher]   (single workspace MVP)
 *   Search (Cmd+K)
 *   ─────────
 *   Favorites              (drag to rearrange)
 *   ─────────
 *   Recents                (last 5 viewed)
 *   ─────────
 *   Teamspaces             (label-only MVP)
 *   └─ Page Tree           (recursive, lazy load)
 *   ─────────
 *   Trash
 *   ─────────
 *   Settings / About
 */
export function Sidebar() {
  const { t } = useTranslation();
  const workspace = useWorkspaceStore((s) => s.workspace);
  const rootPages = useWorkspaceStore((s) => s.rootPages);
  const currentPageId = useWorkspaceStore((s) => s.currentPageId);
  const recents = useWorkspaceStore((s) => s.recents);
  const favorites = useWorkspaceStore((s) => s.favorites);
  const loadWorkspace = useWorkspaceStore((s) => s.loadWorkspace);
  const loadRootPages = useWorkspaceStore((s) => s.loadRootPages);
  const loadFavorites = useWorkspaceStore((s) => s.loadFavorites);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const createRootPage = useWorkspaceStore((s) => s.createRootPage);
  const createRootDatabase = useWorkspaceStore((s) => s.createRootDatabase);
  const reorderFavorites = useWorkspaceStore((s) => s.reorderFavorites);
  const movePage = useWorkspaceStore((s) => s.movePage);

  useEffect(() => {
    Promise.all([loadWorkspace(), loadRootPages(), loadFavorites()]).catch((err) =>
      console.error('[Folio] sidebar init failed', err),
    );
  }, [loadWorkspace, loadRootPages, loadFavorites]);

  // Look up recent page metadata. Recents may include ids that were trashed
  // since they were last opened — filter those out by best-known summary.
  const rootAndChildren = useWorkspaceStore((s) => s.childrenCache);
  const allKnownPages: Record<string, PageSummary> = useMemo(() => {
    const map: Record<string, PageSummary> = {};
    for (const list of Object.values(rootAndChildren)) {
      for (const p of list) map[p.id] = p;
    }
    for (const p of rootPages) map[p.id] = p;
    return map;
  }, [rootAndChildren, rootPages]);

  const recentPages = useMemo(
    () =>
      recents
        .map((id) => allKnownPages[id])
        .filter((p): p is PageSummary => !!p && !p.isTrashed),
    [recents, allKnownPages],
  );

  // Drag-rearrange for favorites.
  const dragFavId = useRef<string | null>(null);
  const handleFavDragStart = useCallback((id: string) => {
    dragFavId.current = id;
  }, []);
  const handleFavDragOver = useCallback((e: React.DragEvent, overId: string) => {
    if (!dragFavId.current || dragFavId.current === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const handleFavDrop = useCallback(
    (overId: string) => {
      const src = dragFavId.current;
      dragFavId.current = null;
      if (!src || src === overId) return;
      const ordered = favorites.map((f) => f.id);
      const from = ordered.indexOf(src);
      const to = ordered.indexOf(overId);
      if (from < 0 || to < 0) return;
      ordered.splice(from, 1);
      ordered.splice(to, 0, src);
      reorderFavorites(ordered).catch((err) =>
        console.error('[Folio] reorder favorites failed', err),
      );
    },
    [favorites, reorderFavorites],
  );

  const fireToast = useCallback(
    (msg: string) =>
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: msg })),
    [],
  );

  // Create menu (New page / New database) anchored to the "+" button in the
  // Pages section header.
  const [createMenuRect, setCreateMenuRect] = useState<DOMRect | null>(null);
  const handleNewRootPage = useCallback(async () => {
    setCreateMenuRect(null);
    try {
      const p = await createRootPage('Untitled');
      setCurrentPage(p.id);
    } catch (err) {
      console.error('[Folio] new page failed', err);
    }
  }, [createRootPage, setCurrentPage]);
  const handleNewRootDatabase = useCallback(async () => {
    setCreateMenuRect(null);
    try {
      const db = await createRootDatabase('Untitled database');
      setCurrentPage(db.id);
    } catch (err) {
      console.error('[Folio] new database failed', err);
    }
  }, [createRootDatabase, setCurrentPage]);

  return (
    <aside className="w-sidebar bg-bg-sidebar border-r border-border-hairline flex flex-col select-none text-[13px]">
      {/* === Workspace switcher === */}
      <button
        type="button"
        className="h-11 px-3 flex items-center gap-2 hover:bg-bg-hover transition-colors"
        onClick={() => fireToast(t('sidebar.moreWorkspacesSoon'))}
        title={t('sidebar.workspaceSwitcher')}
      >
        <span className="text-[15px]">📝</span>
        <span className="font-medium flex-1 text-left truncate text-text-primary">
          {workspace?.name ?? 'Folio'}
        </span>
        <span className="text-[10px] text-text-tertiary">▾</span>
      </button>

      {/* === Search pill === */}
      <div className="px-2 pt-1 pb-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('folio:open-search'))}
          className="w-full px-2 py-1 text-left rounded-md flex items-center gap-2 text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <span className="w-4 text-center text-[13px] leading-none">🔍</span>
          <span className="flex-1">{t('sidebar.search')}</span>
          <span className="text-[10px] text-text-tertiary/70">
            <kbd className="px-1 py-0.5 bg-bg-section rounded text-text-secondary text-[10px]">Ctrl K</kbd>
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* === Favorites === */}
        <SidebarSection label={t('sidebar.favorites')}>
          {favorites.length === 0 ? (
            <SidebarEmptyHint>{t('sidebar.favoritesEmpty')}</SidebarEmptyHint>
          ) : (
            favorites.map((p) => (
              <div
                key={p.id}
                draggable
                onDragStart={() => handleFavDragStart(p.id)}
                onDragOver={(e) => handleFavDragOver(e, p.id)}
                onDrop={() => handleFavDrop(p.id)}
                onClick={() => setCurrentPage(p.id)}
                className={[
                  'group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer',
                  'transition-colors',
                  p.id === currentPageId ? 'bg-bg-active font-semibold' : 'hover:bg-bg-hover',
                ].join(' ')}
              >
                <span className="text-sm flex-shrink-0">{p.icon ?? '📄'}</span>
                <span className="flex-1 min-w-0 truncate">{p.title || t('common.untitled')}</span>
                <span className="text-[10px] opacity-0 group-hover:opacity-100 text-text-tertiary">
                  ⋮⋮
                </span>
              </div>
            ))
          )}
        </SidebarSection>

        {/* === Recents === */}
        <SidebarSection label={t('sidebar.recents')}>
          {recentPages.length === 0 ? (
            <SidebarEmptyHint>{t('sidebar.noRecents')}</SidebarEmptyHint>
          ) : (
            recentPages.map((p) => (
              <div
                key={p.id}
                onClick={() => setCurrentPage(p.id)}
                className={[
                  'flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors',
                  p.id === currentPageId ? 'bg-bg-active font-semibold' : 'hover:bg-bg-hover',
                ].join(' ')}
              >
                <span className="text-sm flex-shrink-0">{p.icon ?? '📄'}</span>
                <span className="flex-1 min-w-0 truncate">{p.title || t('common.untitled')}</span>
              </div>
            ))
          )}
        </SidebarSection>

        {/* === Teamspaces === */}
        <SidebarSection label={t('sidebar.teamspaces')}>
          <div className="px-2 py-1 text-text-secondary">🏢 {t('sidebar.defaultTeam')}</div>
        </SidebarSection>

        {/* === Page tree === */}
        <SidebarSection
          label={t('sidebar.pages')}
          action={
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCreateMenuRect(
                  (e.currentTarget as HTMLElement).getBoundingClientRect(),
                );
              }}
              className="text-text-tertiary hover:text-text-primary -mr-1 px-0.5 leading-none text-[14px]"
              aria-label={t('sidebar.create')}
              title={t('sidebar.create')}
            >
              +
            </button>
          }
        >
          {rootPages.length === 0 ? (
            <SidebarEmptyHint>
              {t('sidebar.noPagesHint')}
            </SidebarEmptyHint>
          ) : (
            <div
              className="pr-1"
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/folio-page')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                // Drop on the section background (not on a specific node) →
                // move the dragged page to the workspace root.
                const dragId = e.dataTransfer.getData('text/folio-page');
                if (!dragId) return;
                movePage(dragId, null, 'workspace').catch((err) => {
                  console.error('[Folio] move page to root failed', err);
                  fireToast(t('sidebar.moveFailed'));
                });
              }}
            >
              {rootPages.map((p) => (
                <PageTreeNode key={p.id} page={p} level={0} />
              ))}
            </div>
          )}
        </SidebarSection>
      </div>

      {/* === Create menu (New page / New database) === */}
      {createMenuRect && (
        <CreateMenu
          anchorRect={createMenuRect}
          onClose={() => setCreateMenuRect(null)}
          onNewPage={() => void handleNewRootPage()}
          onNewDatabase={() => void handleNewRootDatabase()}
        />
      )}

      {/* === Footer === */}
      <div className="px-2 py-1.5 border-t border-border-hairline text-text-secondary">
        <SidebarFooterLink
          icon="🗑"
          label={t('sidebar.trash')}
          onClick={() => window.dispatchEvent(new CustomEvent('folio:open-trash'))}
        />
        <SidebarFooterLink
          icon="⚙"
          label={t('sidebar.settings')}
          onClick={() => window.dispatchEvent(new CustomEvent('folio:open-settings'))}
        />
        <SidebarFooterLink
          icon="ℹ"
          label={t('sidebar.about')}
          onClick={() => window.dispatchEvent(new CustomEvent('folio:open-about'))}
        />
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-1.5 pt-2 pb-1">
      <div className="px-2 pb-1 flex items-center text-[11px] font-medium text-text-tertiary select-none">
        <span className="flex-1">{label}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function SidebarEmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-text-tertiary/80 italic text-[12px]">{children}</div>;
}

function SidebarFooterLink({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-2 py-1 text-left rounded flex items-center gap-2 hover:bg-bg-hover transition-colors"
    >
      <span className="w-4 text-center text-[13px] leading-none">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

interface CreateMenuProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onNewPage: () => void;
  onNewDatabase: () => void;
}

/**
 * Popover anchored to the "+" button in the Pages section header.
 * Offers New page / New database at the workspace root.
 */
function CreateMenu({ anchorRect, onClose, onNewPage, onNewDatabase }: CreateMenuProps) {
  const { t } = useTranslation();

  // Close on outside click (deferred binding so the opening click won't close it).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-create-menu]')) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 2,
    left: Math.min(anchorRect.left, window.innerWidth - 184),
    width: 176,
    zIndex: 1100,
  };

  return (
    <div
      data-create-menu
      style={style}
      className="rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-[13px]"
    >
      <CreateMenuItem icon="📄" label={t('sidebar.newPage')} onClick={onNewPage} />
      <CreateMenuItem icon="🗄" label={t('sidebar.newDatabase')} onClick={onNewDatabase} />
    </div>
  );
}

function CreateMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-bg-hover flex items-center gap-2 text-text-primary"
    >
      <span className="w-4 text-center text-[13px] leading-none flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
