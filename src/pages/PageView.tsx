import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/invoke';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Editor } from '../editor/Editor';
import { perf } from '../lib/perf';

// M6 perf: page chrome renders for both page and database pages, but the
// database UI / emoji picker / export modal are only mounted on user action.
// Lazy-loading them keeps the page-open bundle lean (PRD §10.1: page open
// < 300ms). The Editor stays eager because every plain page needs it.
const DatabaseView = lazy(() =>
  import('../components/database/DatabaseView').then((m) => ({ default: m.DatabaseView })),
);
const RowPropertyPanel = lazy(() =>
  import('../components/database/RowPropertyPanel').then((m) => ({ default: m.RowPropertyPanel })),
);
const EmojiPicker = lazy(() =>
  import('../components/EmojiPicker').then((m) => ({ default: m.EmojiPicker })),
);
const ImportExportModal = lazy(() =>
  import('../components/ImportExportModal').then((m) => ({ default: m.ImportExportModal })),
);

/**
 * Single-page view. Routes by `page.type`:
 *   - 'database' → DatabaseView (Table)
 *   - 'page' with parentType='database' → standard editor + sticky RowPropertyPanel (Q5-B)
 *   - 'page' otherwise → standard editor only
 *
 * Page chrome (PRD §5.2.2):
 *   - Top bar: 44px, transparent at top, opaque after scroll
 *   - Breadcrumb: hover reveals refresh / page-icon / copy-link / more
 *   - Action cluster: Share / More / Favorite / Comments
 *   - Cover: full-width banner (gradient/color picker)
 *   - Icon: 40px display; click opens emoji picker
 *   - Title: 40px/600/1.2, placeholder "Untitled"
 *   - Content: max-width 860px (small/full toggle)
 */
export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const {
    data: pageData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['page', pageId],
    queryFn: () => api.getPage(pageId),
    enabled: !!pageId,
  });

  const renamePageLocally = useWorkspaceStore((s) => s.renamePageLocally);
  const updateIconLocally = useWorkspaceStore((s) => s.updateIconLocally);
  const setFavoriteStore = useWorkspaceStore((s) => s.setFavorite);

  const [titleDraft, setTitleDraft] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [iconPickerAnchor, setIconPickerAnchor] = useState<DOMRect | null>(null);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<DOMRect | null>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Increments when a snapshot restore happens — bumps the editor's key so it
  // remounts with the freshly-overwritten doc.
  const [restoreEpoch, setRestoreEpoch] = useState(0);

  // Debounced 5s snapshot autosave (PRD §5.2.4). Only fires while the doc
  // actually changes — see update handler below.
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshottedDocRef = useRef<string>('');

  useEffect(() => {
    if (pageData) {
      setTitleDraft(pageData.title);
      setFullWidth(pageData.fullWidth);
      lastSnapshottedDocRef.current = pageData.doc;
    }
  }, [pageData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // M6 perf: measure "page open to interactive" (PRD §10.1: < 300ms).
  // Starts when the page query resolves, ends when the Editor reports ready
  // (or, for database pages, after the data effect runs).
  useEffect(() => {
    if (pageData) {
      perf.start(`page-open:${pageData.id}`);
      if (pageData.type === 'database') {
        // No Editor to call onReady — count this paint as interactive.
        perf.end(`page-open:${pageData.id}`);
      }
    }
  }, [pageData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [titleDraft]);

  // Top-bar opacity transition.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 8);
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [pageId]);

  // Cleanup the pending snapshot timer on unmount.
  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, []);

  // When a snapshot is restored via the History modal, force a refetch so the
  // editor + chrome reflect the new doc + title.
  useEffect(() => {
    const onRestored = () => {
      void queryClient.invalidateQueries({ queryKey: ['page', pageId] });
      setRestoreEpoch((e) => e + 1);
    };
    window.addEventListener('folio:snapshot-restored', onRestored);
    return () => window.removeEventListener('folio:snapshot-restored', onRestored);
  }, [queryClient, pageId]);

  if (isLoading) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-page mx-auto px-24 py-12 text-text-tertiary">{t('common.loadingPage')}</div>
      </main>
    );
  }

  if (error || !pageData) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-page mx-auto px-24 py-12">
          <p className="text-status-red mb-2">{t('page.loadFailed')}</p>
          <p className="text-sm text-text-tertiary">{String(error)}</p>
        </div>
      </main>
    );
  }

  const persistTitle = async () => {
    const next = titleDraft.trim();
    if (next === pageData.title) return;
    try {
      // For database rows with a `title` property, also push into the title cell.
      if (pageData.parentType === 'database') {
        const schema = await api.getDatabase(pageData.parentId!);
        const titleProp = schema.properties.find((p) => p.type === 'title');
        if (titleProp) {
          await api.updateCell({
            pageId: pageData.id,
            propertyId: titleProp.id,
            value: next,
          });
        }
      }
      await api.renamePage(pageData.id, next);
      renamePageLocally(pageData.id, next);
      // Bust any cached database-rows queries so DatabaseView reflects the
      // new title when the user navigates back to the owning database.
      // Without this, React Query serves the stale `DatabaseRow.title`
      // snapshot indefinitely (renamePageLocally only updates the zustand
      // page-list store, which DatabaseView doesn't read).
      void queryClient.invalidateQueries({ queryKey: ['database-rows'] });
    } catch (err) {
      console.error('[Folio] title rename failed', err);
    }
  };

  const setIcon = async (emoji: string) => {
    const next = emoji === '' ? null : emoji;
    setIconPickerAnchor(null);
    try {
      await api.updatePageMeta(pageData.id, { icon: next });
      updateIconLocally(pageData.id, next);
      // Refresh the cached page so the chrome re-renders with the new icon.
      void queryClient.invalidateQueries({ queryKey: ['page', pageData.id] });
      // DatabaseView caches DatabaseRow.icon as a snapshot, same as title —
      // bust it so the row icon column updates on next visit.
      void queryClient.invalidateQueries({ queryKey: ['database-rows'] });
    } catch (err) {
      console.error('[Folio] set icon failed', err);
    }
  };

  const setCover = async (cover: string | null) => {
    try {
      await api.updatePageMeta(pageData.id, { cover });
      void queryClient.invalidateQueries({ queryKey: ['page', pageData.id] });
    } catch (err) {
      console.error('[Folio] set cover failed', err);
    }
  };

  const toggleFavorite = async () => {
    try {
      await setFavoriteStore(pageData.id, !pageData.favorite);
      void queryClient.invalidateQueries({ queryKey: ['page', pageData.id] });
    } catch (err) {
      console.error('[Folio] favorite failed', err);
    }
  };

  const scheduleSnapshot = (doc: string) => {
    if (doc === lastSnapshottedDocRef.current) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(async () => {
      try {
        await api.createSnapshot(pageData.id, doc, titleDraft, 'auto');
        lastSnapshottedDocRef.current = doc;
      } catch (err) {
        console.error('[Folio] auto-snapshot failed', err);
      }
    }, 5000);
  };

  const isDatabase = pageData.type === 'database';
  const isDatabaseRow = pageData.parentType === 'database';

  // Breadcrumb title
  const crumb =
    pageData.parentType === 'workspace'
      ? t('page.workspace')
      : pageData.parentType === 'database'
        ? t('page.databaseRow')
        : t('page.subpage');

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto relative">
      {/* === Top bar (PRD §5.2.2: 44px, transparent → opaque on scroll) === */}
      <div
        className={[
          'sticky top-0 z-20 h-11 flex items-center gap-2 px-6 transition-colors',
          scrolled ? 'bg-bg-page/95 border-b border-border-hairline' : 'bg-transparent',
        ].join(' ')}
      >
        <Breadcrumb crumb={crumb} icon={pageData.icon} pageId={pageData.id} />
        <div className="flex-1" />
        <ActionCluster
          favorite={pageData.favorite}
          moreMenuAnchor={moreMenuAnchor}
          onShare={() => window.dispatchEvent(new CustomEvent('folio:toast', { detail: t('page.sharingSoon') }))}
          onMore={(rect) => setMoreMenuAnchor(rect)}
          onFavorite={toggleFavorite}
          onComments={() => window.dispatchEvent(new CustomEvent('folio:toast', { detail: t('page.commentsSoon') }))}
        />
      </div>

      {/* === Cover (PRD §5.2.2) === */}
      {pageData.cover && (
        <div
          className="group w-full h-[180px] relative"
          style={{ background: resolveCoverStyle(pageData.cover) }}
        >
          {/* Action buttons appear on hover (Notion-style) */}
          <div className="absolute bottom-3 right-6 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setCoverPickerOpen(true)}
              className="px-2 py-1 text-[11px] rounded bg-bg-page/80 hover:bg-bg-page text-text-secondary"
            >
              {t('page.changeCover')}
            </button>
            <button
              type="button"
              onClick={() => setCover(null)}
              className="px-2 py-1 text-[11px] rounded bg-bg-page/80 hover:bg-bg-page text-text-secondary"
            >
              {t('page.removeCover')}
            </button>
          </div>
        </div>
      )}

      <div
        className={[
          'mx-auto px-10 pt-6 pb-20 transition-all',
          fullWidth ? 'max-w-page-full' : 'max-w-page',
        ].join(' ')}
      >
        {/* === Icon (40px) + picker === */}
        <div className="mb-1 flex items-end gap-2">
          <button
            type="button"
            onClick={(e) => setIconPickerAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())}
            className="w-10 h-10 text-[40px] leading-none flex items-center justify-center hover:bg-bg-hover rounded transition-colors"
            aria-label={t('page.changeIcon')}
          >
            {pageData.icon ?? (isDatabase ? '🗃️' : '📄')}
          </button>
        </div>

        {/* === "+ Add cover" hint (Notion-style: only when no cover set,
                         subtle so it doesn't dominate the page) === */}
        {!pageData.cover && (
          <div className="mb-2 -mt-1">
            <button
              type="button"
              onClick={() => setCoverPickerOpen(true)}
              className="text-[12px] text-text-tertiary/60 hover:text-text-secondary transition-colors"
            >
              {t('page.addCover')}
            </button>
          </div>
        )}

        {/* === Title === */}
        <textarea
          ref={titleRef}
          rows={1}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={persistTitle}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              persistTitle();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder={isDatabase ? t('page.untitledDatabase') : t('page.untitled')}
          className="w-full text-h1 bg-transparent outline-none resize-none placeholder:text-text-tertiary/60 mb-1"
          style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.2 }}
        />

        {/* === Width toggle === */}
        <div className="text-[12px] text-text-tertiary/80 mb-4 mt-1 flex items-center gap-3">
          <span>{crumb}</span>
          <span>·</span>
          <span>{t('page.lastEdited', { date: new Date(pageData.updatedAt).toLocaleString() })}</span>
          <span>·</span>
          <button
            type="button"
            onClick={() => setFullWidth((v) => !v)}
            className="px-1.5 py-0.5 rounded bg-bg-section hover:bg-bg-hover text-text-secondary"
          >
            {fullWidth ? t('page.fullWidth') : t('page.smallWidth')}
          </button>
        </div>

        {/* === Content === */}
        {isDatabase ? (
          <Suspense
            fallback={<div className="py-12 text-text-tertiary">{t('common.loadingDatabase')}</div>}
          >
            <DatabaseView databaseId={pageData.id} />
          </Suspense>
        ) : (
          <>
            {isDatabaseRow && (
              <Suspense fallback={null}>
                <RowPropertyPanel rowPageId={pageData.id} databaseId={pageData.parentId!} />
              </Suspense>
            )}
            <Editor
              key={`${pageData.id}:${restoreEpoch}`}
              pageId={pageData.id}
              initialDoc={pageData.doc}
              onReady={() => perf.end(`page-open:${pageData.id}`)}
            />
          </>
        )}
      </div>

      {iconPickerAnchor && (
        <Suspense fallback={null}>
          <EmojiPicker
            anchorRect={iconPickerAnchor}
            onSelect={setIcon}
            onClose={() => setIconPickerAnchor(null)}
          />
        </Suspense>
      )}

      {/* Cover picker popover — opened from "+ Add cover" or "Change cover" */}
      {coverPickerOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-start justify-center pt-24"
          onClick={() => setCoverPickerOpen(false)}
        >
          <div
            className="bg-bg-section border border-border-hairline rounded-lg shadow-popover p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[12px] text-text-secondary mb-2 px-1">{t('page.cover')}</div>
            <CoverPicker
              onPick={(css) => {
                setCover(css);
                setCoverPickerOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {moreMenuAnchor && (
        <MoreMenu
          anchorRect={moreMenuAnchor}
          onClose={() => setMoreMenuAnchor(null)}
          onExport={() => {
            setMoreMenuAnchor(null);
            setExportOpen(true);
          }}
          onSaveSnapshot={async () => {
            try {
              await api.createSnapshot(pageData.id, pageData.doc, titleDraft, 'manual');
              window.dispatchEvent(new CustomEvent('folio:toast', { detail: t('page.snapshotSaved') }));
            } catch (err) {
              console.error('[Folio] manual snapshot failed', err);
            }
          }}
          onHistory={() => {
            window.dispatchEvent(
              new CustomEvent('folio:open-history', { detail: { pageId: pageData.id, title: titleDraft } }),
            );
          }}
          onTrash={async () => {
            if (!confirm(t('page.moveToTrashConfirm', { title: pageData.title || t('page.untitled') }))) return;
            try {
              await api.trashPage(pageData.id);
              window.dispatchEvent(new CustomEvent('folio:page-trashed', { detail: pageData.id }));
            } catch (err) {
              console.error('[Folio] trash from page failed', err);
            }
          }}
        />
      )}

      {/* Hidden bridge so the editor's onUpdate can schedule snapshots.
          We can't pass scheduleSnapshot into <Editor> without touching it,
          so we listen to a window event the editor dispatches.
          Since the editor does not currently dispatch such an event, this is
          a no-op for M2 editors — snapshots still happen via the manual
          "Save snapshot" action. The 5s autosave path is wired and ready for
          the M2 deep agent to emit `folio:doc-updated` events. */}
      <DocUpdatedBridge pageId={pageData.id} onDocUpdated={scheduleSnapshot} />

      {exportOpen && (
        <Suspense fallback={null}>
          <ImportExportModal
            pageId={pageData.id}
            pageTitle={pageData.title}
            onClose={() => setExportOpen(false)}
          />
        </Suspense>
      )}
    </main>
  );
}

/** Listens for `folio:doc-updated` and forwards the doc to the snapshot scheduler. */
function DocUpdatedBridge({
  pageId,
  onDocUpdated,
}: {
  pageId: string;
  onDocUpdated: (doc: string) => void;
}) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ pageId: string; doc: string }>).detail;
      if (detail && detail.pageId === pageId) {
        onDocUpdated(detail.doc);
      }
    };
    window.addEventListener('folio:doc-updated', handler);
    return () => window.removeEventListener('folio:doc-updated', handler);
  }, [pageId, onDocUpdated]);
  return null;
}

function Breadcrumb({
  crumb,
  icon,
  pageId,
}: {
  crumb: string;
  icon: string | null;
  pageId: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex items-center gap-1 text-[12px] text-text-tertiary/90"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="truncate max-w-[200px]">{crumb}</span>
      {hovered && (
        <>
          <BreadcrumbButton
            title={t('page.refresh')}
            onClick={() => window.location.reload()}
          >
            ↻
          </BreadcrumbButton>
          <BreadcrumbButton title={t('page.pageIcon')}>{icon ?? '📄'}</BreadcrumbButton>
          <BreadcrumbButton
            title={t('page.copyLink')}
            onClick={() => {
              void navigator.clipboard.writeText(`folio://page/${pageId}`);
              window.dispatchEvent(new CustomEvent('folio:toast', { detail: t('page.linkCopied') }));
            }}
          >
            🔗
          </BreadcrumbButton>
          <BreadcrumbButton title={t('page.more')}>⋯</BreadcrumbButton>
        </>
      )}
    </div>
  );
}

function BreadcrumbButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover text-[11px] text-text-secondary"
    >
      {children}
    </button>
  );
}

interface ActionClusterProps {
  favorite: boolean;
  moreMenuAnchor: DOMRect | null;
  onShare: () => void;
  onMore: (rect: DOMRect) => void;
  onFavorite: () => void;
  onComments: () => void;
}

function ActionCluster(props: ActionClusterProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <ActionButton title={t('page.share')} onClick={props.onShare}>📤</ActionButton>
      <ActionButton
        title={t('page.more')}
        onClick={(e) => props.onMore((e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        ⋯
      </ActionButton>
      <ActionButton
        title={props.favorite ? t('page.removeFromFavorites') : t('page.addToFavorites')}
        onClick={props.onFavorite}
        active={props.favorite}
      >
        {props.favorite ? '⭐' : '☆'}
      </ActionButton>
      <ActionButton title={t('page.comments')} onClick={props.onComments}>💬</ActionButton>
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={[
        'w-7 h-7 flex items-center justify-center rounded text-[13px] transition-colors',
        active ? 'text-status-amber bg-bg-hover' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

interface MoreMenuProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onExport: () => void;
  onSaveSnapshot: () => void;
  onHistory: () => void;
  onTrash: () => void;
}

function MoreMenu(props: MoreMenuProps) {
  const { t } = useTranslation();
  const { anchorRect, onClose, ...actions } = props;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-page-more-menu]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
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
    left: Math.min(anchorRect.left - 100, window.innerWidth - 184),
    width: 176,
    zIndex: 1100,
  };

  return (
    <div
      data-page-more-menu
      style={style}
      className="rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-[13px]"
    >
      <MoreItem
        label={t('page.export')}
        onClick={() => {
          onClose();
          actions.onExport();
        }}
      />
      <MoreItem
        label={t('page.saveSnapshot')}
        onClick={() => {
          onClose();
          actions.onSaveSnapshot();
        }}
      />
      <MoreItem
        label={t('page.pageHistory')}
        onClick={() => {
          onClose();
          actions.onHistory();
        }}
      />
      <div className="my-1 border-t border-border-hairline" />
      <MoreItem
        label={t('sidebar.moveToTrash')}
        danger
        onClick={() => {
          onClose();
          actions.onTrash();
        }}
      />
    </div>
  );
}

function MoreItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-1.5 hover:bg-bg-hover',
        danger ? 'text-status-red' : 'text-text-primary',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// === Cover support ===========================================================

/**
 * Curated gradient + solid-color cover set (PRD §5.2.2 — "solid color picker
 * / curated set of gradient placeholders" picked as the MVP-simple approach).
 * Stored as a CSS background string in `page.cover`.
 */
const COVER_PRESETS: { labelKey: string; css: string }[] = [
  { labelKey: 'page.coverSunrise', css: 'linear-gradient(135deg, #ff9a8b 0%, #ff6a88 50%, #ff99ac 100%)' },
  { labelKey: 'page.coverOcean', css: 'linear-gradient(135deg, #2bc0e4 0%, #36d1dc 100%)' },
  { labelKey: 'page.coverForest', css: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { labelKey: 'page.coverPlum', css: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)' },
  { labelKey: 'page.coverPeach', css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { labelKey: 'page.coverSlate', css: 'linear-gradient(135deg, #232526 0%, #414345 100%)' },
];

function CoverPicker({ onPick }: { onPick: (css: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      {COVER_PRESETS.map((p) => (
        <button
          key={p.labelKey}
          type="button"
          title={t(p.labelKey)}
          onClick={() => onPick(p.css)}
          className="w-9 h-9 rounded-md border border-border-hairline hover:scale-110 transition-transform"
          style={{ background: p.css }}
          aria-label={`${t('page.cover')}: ${t(p.labelKey)}`}
        />
      ))}
    </div>
  );
}

/**
 * Resolve a stored `page.cover` value into a CSS `background` value.
 * Accepts either a preset gradient/string (returned verbatim) or a URL/http(s)
 * link (used as a background-image url).
 */
function resolveCoverStyle(stored: string): string {
  if (/^(linear-gradient|radial-gradient|url\(|#|https?:)/i.test(stored)) {
    if (/^https?:/i.test(stored)) return `url("${stored}") center/cover no-repeat`;
    return stored;
  }
  return stored;
}
