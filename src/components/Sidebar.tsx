import { useCallback, useEffect, useMemo, useRef } from 'react';
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
 *   Recents                (last 10 viewed)
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
  const reorderFavorites = useWorkspaceStore((s) => s.reorderFavorites);

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
        <SidebarSection label={t('sidebar.pages')}>
          {rootPages.length === 0 ? (
            <SidebarEmptyHint>
              {t('sidebar.noPagesHint')}
            </SidebarEmptyHint>
          ) : (
            <div className="pr-1">
              {rootPages.map((p) => (
                <PageTreeNode key={p.id} page={p} level={0} />
              ))}
            </div>
          )}
        </SidebarSection>
      </div>

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
          onClick={() => fireToast(t('sidebar.settingsSoon'))}
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-1.5 pt-2 pb-1">
      <div className="px-2 pb-1 text-[11px] font-medium text-text-tertiary select-none">
        {label}
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
