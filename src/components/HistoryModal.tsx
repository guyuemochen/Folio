import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/invoke';
import { useDialog } from '../lib/dialog';
import type { PageSnapshot } from '../lib/types';

interface HistoryModalProps {
  pageId: string;
  /** Initial title to fall back to in the snapshot preview header. */
  currentTitle: string;
  onClose: () => void;
  /** Called after a successful restore so the parent can refresh the editor. */
  onRestored: () => void;
}

/**
 * Page History (PRD §5.2.4 — simplified snapshot view, no diff).
 *
 * Lists snapshots (timestamp + title), shows a read-only JSON preview of the
 * selected snapshot, and offers a Restore button that overwrites the current
 * page document.
 */
export function HistoryModal({ pageId, currentTitle, onClose, onRestored }: HistoryModalProps) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState<PageSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listSnapshots(pageId)
      .then((list) => {
        if (cancelled) return;
        setSnapshots(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch((err) => console.error('[Folio] list snapshots failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const dialog = useDialog({ onClose, label: t('history.title') });

  const selected = useMemo(
    () => snapshots.find((s) => s.id === selectedId) ?? null,
    [snapshots, selectedId],
  );

  const previewText = useMemo(() => {
    if (!selected) return '';
    try {
      return JSON.stringify(JSON.parse(selected.content), null, 2);
    } catch {
      return selected.content;
    }
  }, [selected]);

  const handleRestore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      await api.restoreSnapshot(selected.id);
      onRestored();
      onClose();
    } catch (err) {
      console.error('[Folio] restore snapshot failed', err);
    } finally {
      setRestoring(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[900] bg-black/20 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div {...dialog.containerProps} className="w-[760px] max-h-[80vh] bg-bg-page rounded-lg shadow-popover border border-border-hairline flex flex-col">
        <header className="px-5 py-3 border-b border-border-hairline flex items-center gap-2">
          <h2 className="text-h3 flex-1">{t('history.title')}</h2>
          <span className="text-[11px] text-text-tertiary">
            “{currentTitle || t('page.untitled')}”
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary px-2"
            aria-label={t('history.close')}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* Snapshot list */}
          <div className="w-64 shrink-0 border-r border-border-hairline overflow-y-auto py-1">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-text-tertiary">{t('history.loading')}</div>
            ) : snapshots.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-text-tertiary">
                {t('history.emptyHint')}
              </div>
            ) : (
              snapshots.map((s) => {
                const active = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={[
                      'w-full text-left px-4 py-2 text-sm border-l-2 transition-colors',
                      active
                        ? 'bg-bg-active border-l-accent'
                        : 'border-l-transparent hover:bg-bg-hover',
                    ].join(' ')}
                  >
                    <div className="font-medium truncate">
                      {new Date(s.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[11px] text-text-tertiary flex items-center gap-1.5">
                      <span className="truncate">{s.title || t('page.untitled')}</span>
                      <span className="text-text-tertiary/70">
                        · {s.source === 'manual' ? t('history.manual') : t('history.auto')}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Preview pane */}
          <div className="flex-1 min-w-0 overflow-auto p-4">
            {selected ? (
              <>
                <div className="text-[12px] text-text-tertiary mb-2">
                  {t('history.snapshotPreview', { date: new Date(selected.createdAt).toLocaleString() })}
                </div>
                <pre className="text-[11px] leading-snug font-mono bg-bg-section rounded p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap break-words">
                  {previewText}
                </pre>
              </>
            ) : (
              <div className="text-sm text-text-tertiary">{t('history.selectPreview')}</div>
            )}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-border-hairline flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm rounded bg-bg-section hover:bg-bg-hover text-text-primary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleRestore}
            disabled={!selected || restoring}
            className="px-3 py-1 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {restoring ? t('history.restoring') : t('history.restore')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
