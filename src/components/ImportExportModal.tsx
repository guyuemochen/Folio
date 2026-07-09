import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { open, save } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/invoke';
import { useDialog } from '../lib/dialog';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { ExportFormat } from '../lib/types';

/**
 * Import / Export modal (PRD §5.5, M5).
 *
 * Two tabs covering all 8 M5 formats:
 *   - **Export** — page MD/HTML, workspace zip, Folio backup create/restore
 *   - **Import** — Markdown, HTML, CSV, Notion zip
 *
 * Opened from PageView's MoreMenu ("Export…").
 */
interface ImportExportModalProps {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}

type Tab = 'export' | 'import';

export function ImportExportModal({ pageId, pageTitle, onClose }: ImportExportModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('export');
  const dialog = useDialog({ onClose, label: t('importExport.dialogLabel') });

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      <div
        {...dialog.containerProps}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[520px] max-h-[80vh] flex flex-col rounded-lg border border-border-hairline bg-bg-page shadow-popover overflow-hidden"
      >
        {/* Header + tabs */}
        <div className="flex items-center border-b border-border-hairline">
          <TabButton active={tab === 'export'} onClick={() => setTab('export')}>
            {t('importExport.exportTab')}
          </TabButton>
          <TabButton active={tab === 'import'} onClick={() => setTab('import')}>
            {t('importExport.importTab')}
          </TabButton>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-2 text-text-tertiary hover:text-text-primary text-[14px]"
            title={t('importExport.close')}
          >
            ✕
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="p-5 overflow-y-auto">
          {tab === 'export' ? (
            <ExportTab pageId={pageId} pageTitle={pageTitle} onClose={onClose} />
          ) : (
            <ImportTab pageId={pageId} pageTitle={pageTitle} onClose={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// =============================================================================
// Export tab
// =============================================================================

function ExportTab({
  pageId,
  pageTitle,
  onClose,
}: {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      console.error('[Folio] export failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const exportPage = (format: ExportFormat) =>
    runAction(`page-${format}`, async () => {
      const ext = format === 'markdown' ? 'md' : 'html';
      const path = await save({
        defaultPath: `${sanitize(pageTitle) || 'untitled'}.${ext}`,
        filters: [
          { name: format === 'markdown' ? t('importExport.markdown') : t('importExport.html'), extensions: [ext] },
        ],
      });
      if (!path || typeof path !== 'string') return;
      const content = await api.exportPage(pageId, format);
      await api.saveTextFile(path, content);
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: t('importExport.exported') }));
      onClose();
    });

  const exportWorkspace = (format: ExportFormat) =>
    runAction(`workspace-${format}`, async () => {
      const path = await save({
        defaultPath: 'folio-workspace.zip',
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      if (!path || typeof path !== 'string') return;
      const b64 = await api.exportWorkspace(format);
      await api.saveBinaryFile(path, b64);
      window.dispatchEvent(
        new CustomEvent('folio:toast', { detail: t('importExport.workspaceExported') }),
      );
      onClose();
    });

  const createBackup = () =>
    runAction('backup', async () => {
      const path = await save({
        defaultPath: `folio-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'Folio Backup', extensions: ['zip'] }],
      });
      if (!path || typeof path !== 'string') return;
      const b64 = await api.createBackup();
      await api.saveBinaryFile(path, b64);
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: t('importExport.backupCreated') }));
      onClose();
    });

  const restoreBackup = () =>
    runAction('restore', async () => {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Folio Backup', extensions: ['zip'] }],
      });
      if (!path || typeof path !== 'string') return;
      const needsRestart = await api.restoreBackup(path);
      if (needsRestart) {
        window.dispatchEvent(
          new CustomEvent('folio:toast', {
            detail: t('importExport.backupRestored'),
          }),
        );
      }
      onClose();
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Page-level export */}
      <div>
        <SectionLabel>{t('importExport.thisPage')}</SectionLabel>
        <div className="flex flex-col gap-2">
          <ActionCard
            icon="📝"
            label={t('importExport.markdown')}
            hint={t('importExport.markdownHint', { pageTitle: pageTitle || t('importExport.thisPage') })}
            loading={busy === 'page-markdown'}
            disabled={busy !== null}
            onClick={() => exportPage('markdown')}
          />
          <ActionCard
            icon="🌐"
            label={t('importExport.html')}
            hint={t('importExport.htmlHint')}
            loading={busy === 'page-html'}
            disabled={busy !== null}
            onClick={() => exportPage('html')}
          />
        </div>
      </div>

      {/* Workspace-level export */}
      <div>
        <SectionLabel>{t('importExport.entireWorkspace')}</SectionLabel>
        <div className="flex flex-col gap-2">
          <ActionCard
            icon="📦"
            label={t('importExport.workspaceZip')}
            hint={t('importExport.workspaceZipHint')}
            loading={busy === 'workspace-markdown'}
            disabled={busy !== null}
            onClick={() => exportWorkspace('markdown')}
          />
          <ActionCard
            icon="🗂️"
            label={t('importExport.workspaceHtmlZip')}
            hint={t('importExport.workspaceHtmlZipHint')}
            loading={busy === 'workspace-html'}
            disabled={busy !== null}
            onClick={() => exportWorkspace('html')}
          />
        </div>
      </div>

      {/* Backup */}
      <div>
        <SectionLabel>{t('importExport.backupRestore')}</SectionLabel>
        <div className="flex flex-col gap-2">
          <ActionCard
            icon="💾"
            label={t('importExport.createBackup')}
            hint={t('importExport.createBackupHint')}
            loading={busy === 'backup'}
            disabled={busy !== null}
            onClick={createBackup}
          />
          <ActionCard
            icon="♻️"
            label={t('importExport.restoreBackup')}
            hint={t('importExport.restoreBackupHint')}
            loading={busy === 'restore'}
            disabled={busy !== null}
            onClick={restoreBackup}
            danger
          />
        </div>
      </div>

      {error && (
        <p className="text-[12px] text-status-red bg-status-red/10 rounded px-2 py-1.5">{error}</p>
      )}
    </div>
  );
}

// =============================================================================
// Import tab
// =============================================================================

function ImportTab({
  pageId,
  pageTitle,
  onClose,
}: {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'overwrite'>('new');

  const importFile = async (
    label: string,
    extensions: string[],
    importer: (path: string, targetPageId?: string) => Promise<{ id: string; title: string }>,
    opts?: { supportsOverwrite?: boolean },
  ) => {
    // Formats that create databases / multi-page trees (CSV, Notion zip) only
    // support "new page" mode — silently fall back rather than blocking.
    const targetPageId = opts?.supportsOverwrite === false ? undefined : mode === 'overwrite' ? pageId : undefined;
    setBusy(label);
    setError(null);
    try {
      const path = await open({ multiple: false, filters: [{ name: label, extensions }] });
      if (!path || typeof path !== 'string') {
        setBusy(null);
        return;
      }
      const page = await importer(path, targetPageId);
      await queryClient.invalidateQueries({ queryKey: ['pages'] });
      // Overwrite mode: the page id is unchanged, so we must bust the page-doc
      // cache so PageView re-fetches the freshly replaced content.
      if (targetPageId) {
        await queryClient.invalidateQueries({ queryKey: ['page', targetPageId] });
        // Reuse the snapshot-restored event: PageView listens to it and bumps
        // restoreEpoch, which forces <Editor key={pageId:restoreEpoch}> to
        // remount with the freshly-overwritten doc.
        window.dispatchEvent(new CustomEvent('folio:snapshot-restored'));
        window.dispatchEvent(
          new CustomEvent('folio:toast', { detail: t('importExport.overwritten') }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent('folio:toast', {
            detail: t('importExport.imported', { title: page.title || t('common.untitled') }),
          }),
        );
        setCurrentPage(page.id);
      }
      onClose();
    } catch (err) {
      console.error('[Folio] import failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const importNotionZip = async () => {
    setBusy('Notion export');
    setError(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Notion export', extensions: ['zip'] }],
      });
      if (!path || typeof path !== 'string') {
        setBusy(null);
        return;
      }
      const result = await api.importNotionZip(path);
      await queryClient.invalidateQueries({ queryKey: ['pages'] });
      const msg = t('importExport.notionImported', {
        count: result.pagesCreated,
        warnings: result.warnings.length,
      });
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: msg }));
      onClose();
    } catch (err) {
      console.error('[Folio] notion import failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-text-secondary">{t('importExport.importHint')}</p>

      {/* Mode picker — only Markdown / HTML support overwrite. */}
      <div className="flex gap-1 p-0.5 bg-bg-section rounded-md">
        <ModeButton active={mode === 'new'} onClick={() => setMode('new')}>
          {t('importExport.importModeNewPage')}
        </ModeButton>
        <ModeButton active={mode === 'overwrite'} onClick={() => setMode('overwrite')}>
          {t('importExport.importModeOverwrite')}
        </ModeButton>
      </div>
      {mode === 'overwrite' && (
        <p className="text-[11px] text-status-amber bg-status-amber/10 rounded px-2 py-1.5">
          {t('importExport.overwriteWarning', { title: pageTitle || t('common.untitled') })}
        </p>
      )}

      {error && (
        <p className="text-[12px] text-status-red bg-status-red/10 rounded px-2 py-1.5">{error}</p>
      )}
      <div className="flex flex-col gap-2">
        <ActionCard
          icon="📝"
          label={t('importExport.markdown')}
          hint={t('importExport.markdownFileHint')}
          loading={busy === 'Markdown'}
          disabled={busy !== null}
          onClick={() =>
            importFile('Markdown', ['md', 'markdown'], (p, tid) => api.importMarkdown(p, undefined, tid), {
              supportsOverwrite: true,
            })
          }
        />
        <ActionCard
          icon="🌐"
          label={t('importExport.html')}
          hint={t('importExport.htmlFileHint')}
          loading={busy === 'HTML'}
          disabled={busy !== null}
          onClick={() =>
            importFile('HTML', ['html', 'htm'], (p, tid) => api.importHtml(p, undefined, tid), {
              supportsOverwrite: true,
            })
          }
        />
        <ActionCard
          icon="📊"
          label="CSV"
          hint={t('importExport.csvHint')}
          loading={busy === 'CSV'}
          disabled={busy !== null || mode === 'overwrite'}
          onClick={() => importFile('CSV', ['csv'], (p) => api.importCsv(p))}
        />
        <ActionCard
          icon="🗃️"
          label="Notion export"
          hint={t('importExport.notionHint')}
          loading={busy === 'Notion export'}
          disabled={busy !== null || mode === 'overwrite'}
          onClick={importNotionZip}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Shared UI helpers
// =============================================================================

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-tertiary hover:text-text-secondary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">
      {children}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 px-3 py-1.5 text-[12px] font-medium rounded transition-colors',
        active
          ? 'bg-bg-page text-text-primary shadow-sm'
          : 'text-text-tertiary hover:text-text-secondary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ActionCard({
  icon,
  label,
  hint,
  onClick,
  disabled,
  loading,
  danger,
}: {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors',
        danger
          ? 'border-border-hairline hover:bg-status-red/5 disabled:opacity-50'
          : 'border-border-hairline hover:bg-bg-hover disabled:opacity-50',
      ].join(' ')}
    >
      <span className="text-[18px]">{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-medium text-text-primary">{label}</span>
        <span className="block text-[11px] text-text-tertiary">{hint}</span>
      </span>
      {loading && (
        <span className="text-[11px] text-text-tertiary animate-pulse">{t('importExport.working')}</span>
      )}
    </button>
  );
}

/** Strip characters that are unsafe in filenames. */
function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}
