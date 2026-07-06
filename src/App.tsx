import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { SearchModal } from './components/SearchModal';
import { TrashModal } from './components/TrashModal';
import { HistoryModal } from './components/HistoryModal';
import { PageView } from './pages/PageView';
import { useWorkspaceStore } from './store/workspaceStore';
import type { SnapshotSource } from './lib/types';

/**
 * App shell:
 *   ┌─────────┬──────────────────────┐
 *   │ Sidebar │ PageView (or empty)  │
 *   └─────────┴──────────────────────┘
 *
 * Global keyboard shortcuts live here so they fire regardless of focus.
 */
export default function App() {
  const currentPageId = useWorkspaceStore((s) => s.currentPageId);
  const createRootPage = useWorkspaceStore((s) => s.createRootPage);
  const createRootDatabase = useWorkspaceStore((s) => s.createRootDatabase);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const loadRootPages = useWorkspaceStore((s) => s.loadRootPages);
  const loadFavorites = useWorkspaceStore((s) => s.loadFavorites);
  const removePageLocally = useWorkspaceStore((s) => s.removePageLocally);

  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ pageId: string; title: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+N — new page (desktop)
      if (mod && e.key === 'n' && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        createRootPage('Untitled').then((p) => setCurrentPage(p.id));
      }

      // Cmd/Ctrl+K — global search (don't trigger when typing in inputs outside the app)
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }

      // Cmd/Ctrl+\ — toggle sidebar (deferred — no state for this yet)
    };
    const onCreateDatabase = () => {
      createRootDatabase('Untitled database').then((db) => setCurrentPage(db.id));
    };
    const onOpenSearch = () => setSearchOpen(true);
    const onOpenTrash = () => setTrashOpen(true);
    const onOpenHistory = (e: Event) => {
      const detail = (e as CustomEvent<{ pageId: string; title: string }>).detail;
      if (detail) setHistoryTarget(detail);
    };
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setToast(typeof detail === 'string' ? detail : '');
      window.setTimeout(() => setToast(null), 2200);
    };
    const onPageTrashed = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string') removePageLocally(id);
      // Refresh sidebar lists so caches are consistent.
      void loadRootPages();
      void loadFavorites();
    };
    // Cross-milestone integration: clicking a sub-page reference inside the
    // editor (M2 SubPageView) emits `folio:navigate-page` with the target id.
    const onNavigatePage = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string') setCurrentPage(id);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('folio:create-database', onCreateDatabase);
    window.addEventListener('folio:open-search', onOpenSearch);
    window.addEventListener('folio:open-trash', onOpenTrash);
    window.addEventListener('folio:open-history', onOpenHistory);
    window.addEventListener('folio:toast', onToast);
    window.addEventListener('folio:page-trashed', onPageTrashed);
    window.addEventListener('folio:navigate-page', onNavigatePage);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('folio:create-database', onCreateDatabase);
      window.removeEventListener('folio:open-search', onOpenSearch);
      window.removeEventListener('folio:open-trash', onOpenTrash);
      window.removeEventListener('folio:open-history', onOpenHistory);
      window.removeEventListener('folio:toast', onToast);
      window.removeEventListener('folio:page-trashed', onPageTrashed);
      window.removeEventListener('folio:navigate-page', onNavigatePage);
    };
  }, [createRootPage, createRootDatabase, setCurrentPage, loadRootPages, loadFavorites, removePageLocally]);

  return (
    <div className="flex h-screen bg-bg-page text-text-primary font-sans overflow-hidden">
      <Sidebar />
      {currentPageId ? (
        <PageView key={currentPageId} pageId={currentPageId} />
      ) : (
        <EmptyState onOpenSearch={() => setSearchOpen(true)} />
      )}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
      {historyTarget && (
        <HistoryModal
          pageId={historyTarget.pageId}
          currentTitle={historyTarget.title}
          onClose={() => setHistoryTarget(null)}
          onRestored={() => {
            // Force the open PageView to reload the doc + title from disk.
            window.dispatchEvent(new CustomEvent('folio:snapshot-restored'));
          }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1200] px-4 py-2 rounded-md bg-bg-section border border-border-hairline shadow-popover text-[13px] text-text-primary">
          {toast}
        </div>
      )}
    </div>
  );
}

// Inline import to avoid pulling SnapshotSource value when only used as a type
// (kept for symmetry; referenced by callers that pass source to api.createSnapshot).
export type { SnapshotSource };

function EmptyState({ onOpenSearch }: { onOpenSearch: () => void }) {
  const createRootPage = useWorkspaceStore((s) => s.createRootPage);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);

  return (
    <main className="flex-1 overflow-y-auto flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="text-4xl mb-5 opacity-70">📝</div>
        <h1 className="text-h2 mb-2">Welcome to Folio</h1>
        <p className="text-[14px] text-text-secondary mb-7 leading-relaxed">
          A local-first, Notion-style notebook. Everything you write stays on this machine.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const p = await createRootPage('Untitled');
              setCurrentPage(p.id);
            }}
            className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-[13px] rounded-md transition-colors"
          >
            + New page
          </button>
          <button
            type="button"
            onClick={onOpenSearch}
            className="px-4 py-1.5 bg-bg-hover hover:bg-bg-active text-text-primary text-[13px] rounded-md transition-colors"
          >
            🔍 Search
          </button>
        </div>
        <p className="mt-5 text-[11px] text-text-tertiary">
          <kbd className="px-1 py-0.5 bg-bg-section rounded text-text-secondary text-[10px]">Ctrl+N</kbd> new page
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-bg-section rounded text-text-secondary text-[10px]">Ctrl+K</kbd> search
        </p>
      </div>
    </main>
  );
}
