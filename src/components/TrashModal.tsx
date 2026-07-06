import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaceStore } from '../store/workspaceStore';

interface TrashModalProps {
  onClose: () => void;
}

/**
 * Trash view (PRD §5.2.4).
 *
 * Lists all trashed pages with their original parent (for breadcrumb context),
 * and provides Restore + Delete-forever actions. Restore uses the backend's
 * safe-restore logic (parent fallback to workspace root).
 */
export function TrashModal({ onClose }: TrashModalProps) {
  const trashedPages = useWorkspaceStore((s) => s.trashedPages);
  const loadTrashedPages = useWorkspaceStore((s) => s.loadTrashedPages);
  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const deletePermanently = useWorkspaceStore((s) => s.deletePermanently);

  useEffect(() => {
    loadTrashedPages().catch((err) => console.error('[Folio] load trash failed', err));
  }, [loadTrashedPages]);

  const onCloseKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  useEffect(() => {
    window.addEventListener('keydown', onCloseKey);
    return () => window.removeEventListener('keydown', onCloseKey);
  });

  const rows = useMemo(() => trashedPages, [trashedPages]);

  return createPortal(
    <div
      className="fixed inset-0 z-[900] bg-black/20 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[560px] max-h-[70vh] bg-bg-page rounded-lg shadow-popover border border-border-hairline flex flex-col">
        <header className="px-5 py-3 border-b border-border-hairline flex items-center">
          <h2 className="text-h3 flex-1">Trash</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary px-2"
            aria-label="Close trash"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {rows.length === 0 ? (
            <div className="px-3 py-10 text-center text-text-tertiary text-sm">
              Trash is empty.
            </div>
          ) : (
            rows.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-hover"
              >
                <span className="text-base">{p.icon ?? '📄'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {p.title || 'Untitled'}
                  </div>
                  <div className="text-[11px] text-text-tertiary truncate">
                    {p.parentType === 'workspace' || !p.parentId
                      ? 'Workspace'
                      : p.parentTitle
                        ? `in ${p.parentTitle}`
                        : 'Original parent removed'}
                    {p.trashedAt && (
                      <>
                        <span className="mx-1.5">·</span>
                        Trashed {new Date(p.trashedAt).toLocaleDateString()}
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    restorePage(p.id).catch((err) =>
                      console.error('[Folio] restore failed', err),
                    );
                  }}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[12px] rounded bg-bg-section hover:bg-bg-active text-text-primary"
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Permanently delete "${p.title || 'Untitled'}"? This cannot be undone.`)) {
                      deletePermanently(p.id).catch((err) =>
                        console.error('[Folio] delete forever failed', err),
                      );
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[12px] rounded bg-bg-section hover:bg-bg-active text-status-red"
                >
                  Delete forever
                </button>
              </div>
            ))
          )}
        </div>
        <footer className="px-5 py-2 border-t border-border-hairline text-[11px] text-text-tertiary">
          Trashed pages are auto-purged after 30 days.
        </footer>
      </div>
    </div>,
    document.body,
  );
}
