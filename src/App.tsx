import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './components/Sidebar';
import { useWorkspaceStore } from './store/workspaceStore';
import { useTheme } from './lib/theme';
import { perf } from './lib/perf';
import type { SnapshotSource } from './lib/types';

// M6 perf: every component below is rendered conditionally, so we lazy-load
// them to keep the cold-start JS bundle small (PRD §10.1: cold start < 1.5s).
// Sidebar stays eager — it is the always-visible shell.
const PageView = lazy(() =>
  import('./pages/PageView').then((m) => ({ default: m.PageView })),
);
const SearchModal = lazy(() =>
  import('./components/SearchModal').then((m) => ({ default: m.SearchModal })),
);
const TrashModal = lazy(() =>
  import('./components/TrashModal').then((m) => ({ default: m.TrashModal })),
);
const HistoryModal = lazy(() =>
  import('./components/HistoryModal').then((m) => ({ default: m.HistoryModal })),
);
const AboutModal = lazy(() =>
  import('./components/AboutModal').then((m) => ({ default: m.AboutModal })),
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);

/**
 * App shell:
 *   ┌─────────┬──────────────────────┐
 *   │ Sidebar │ PageView (or empty)  │
 *   └─────────┴──────────────────────┘
 *
 * Global keyboard shortcuts live here so they fire regardless of focus.
 */
export default function App() {
  const { t } = useTranslation();
  // M7 a11y: subscribe to OS color-scheme changes (PRD §10.4). The initial
  // value is applied pre-paint in main.tsx; this keeps it in sync at runtime.
  useTheme();
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // M6 perf: end the cold-start timer once the shell has mounted.
  useEffect(() => {
    perf.end('cold-start-shell');
  }, []);

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
    const onOpenAbout = () => setAboutOpen(true);
    const onOpenSettings = () => setSettingsOpen(true);
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
    window.addEventListener('folio:open-about', onOpenAbout);
    window.addEventListener('folio:open-settings', onOpenSettings);
    window.addEventListener('folio:open-history', onOpenHistory);
    window.addEventListener('folio:toast', onToast);
    window.addEventListener('folio:page-trashed', onPageTrashed);
    window.addEventListener('folio:navigate-page', onNavigatePage);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('folio:create-database', onCreateDatabase);
      window.removeEventListener('folio:open-search', onOpenSearch);
      window.removeEventListener('folio:open-trash', onOpenTrash);
      window.removeEventListener('folio:open-about', onOpenAbout);
      window.removeEventListener('folio:open-settings', onOpenSettings);
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
        <Suspense
          fallback={
            <main className="flex-1 overflow-y-auto">
              <div className="max-w-page mx-auto px-24 py-12 text-text-tertiary">
                {t('common.loadingPage')}
              </div>
            </main>
          }
        >
          <PageView key={currentPageId} pageId={currentPageId} />
        </Suspense>
      ) : (
        <EmptyState onOpenSearch={() => setSearchOpen(true)} />
      )}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchModal onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
      {trashOpen && (
        <Suspense fallback={null}>
          <TrashModal onClose={() => setTrashOpen(false)} />
        </Suspense>
      )}
      {historyTarget && (
        <Suspense fallback={null}>
          <HistoryModal
            pageId={historyTarget.pageId}
            currentTitle={historyTarget.title}
            onClose={() => setHistoryTarget(null)}
            onRestored={() => {
              // Force the open PageView to reload the doc + title from disk.
              window.dispatchEvent(new CustomEvent('folio:snapshot-restored'));
            }}
          />
        </Suspense>
      )}
      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutModal onClose={() => setAboutOpen(false)} />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
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
  const { t } = useTranslation();
  const createRootPage = useWorkspaceStore((s) => s.createRootPage);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);

  return (
    <main className="flex-1 overflow-y-auto flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="text-4xl mb-5 opacity-70">📝</div>
        <h1 className="text-h2 mb-2">{t('page.welcome')}</h1>
        <p className="text-[14px] text-text-secondary mb-7 leading-relaxed">
          {t('page.welcomeSubtitle')}
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
            {t('page.newPage')}
          </button>
          <button
            type="button"
            onClick={onOpenSearch}
            className="px-4 py-1.5 bg-bg-hover hover:bg-bg-active text-text-primary text-[13px] rounded-md transition-colors"
          >
            {t('page.searchAction')}
          </button>
        </div>
        <p className="mt-5 text-[11px] text-text-tertiary">
          {t('page.shortcutNewPage')}
          <span className="mx-2">·</span>
          {t('page.shortcutSearch')}
        </p>
      </div>
    </main>
  );
}
