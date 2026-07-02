import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { SearchModal } from './components/SearchModal';
import { PageView } from './pages/PageView';
import { useWorkspaceStore } from './store/workspaceStore';

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
  const [searchOpen, setSearchOpen] = useState(false);

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
    window.addEventListener('keydown', onKey);
    window.addEventListener('folio:create-database', onCreateDatabase);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('folio:create-database', onCreateDatabase);
    };
  }, [createRootPage, createRootDatabase, setCurrentPage]);

  return (
    <div className="flex h-screen bg-bg-page text-text-primary font-sans overflow-hidden">
      <Sidebar />
      {currentPageId ? (
        <PageView key={currentPageId} pageId={currentPageId} />
      ) : (
        <EmptyState onOpenSearch={() => setSearchOpen(true)} />
      )}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

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
