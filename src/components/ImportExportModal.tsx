import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { open, save } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/invoke';
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
  const [tab, setTab] = useState<Tab>('export');

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[520px] max-h-[80vh] flex flex-col rounded-lg border border-border-hairline bg-bg-page shadow-popover overflow-hidden"
      >
        {/* Header + tabs */}
        <div className="flex items-center border-b border-border-hairline">
          <TabButton active={tab === 'export'} onClick={() => setTab('export')}>
            ↥ Export
          </TabButton>
          <TabButton active={tab === 'import'} onClick={() => setTab('import')}>
            ↧ Import
          </TabButton>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-2 text-text-tertiary hover:text-text-primary text-[14px]"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="p-5 overflow-y-auto">
          {tab === 'export' ? (
            <ExportTab pageId={pageId} pageTitle={pageTitle} onClose={onClose} />
          ) : (
            <ImportTab onClose={onClose} />
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
        filters: [{ name: format === 'markdown' ? 'Markdown' : 'HTML', extensions: [ext] }],
      });
      if (!path || typeof path !== 'string') return;
      const content = await api.exportPage(pageId, format);
      await api.saveTextFile(path, content);
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Exported' }));
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
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Workspace exported' }));
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
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Backup created' }));
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
            detail: 'Backup restored. Restart Folio to apply.',
          }),
        );
      }
      onClose();
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Page-level export */}
      <div>
        <SectionLabel>This page</SectionLabel>
        <div className="flex flex-col gap-2">
          <ActionCard
            icon="📝"
            label="Markdown"
            hint={`${pageTitle || 'This page'} → .md file`}
            loading={busy === 'page-markdown'}
            disabled={busy !== null}
            onClick={() => exportPage('markdown')}
          />
          <ActionCard
            icon="🌐"
            label="HTML"
            hint="Standalone .html, opens in any browser"
            loading={busy === 'page-html'}
            disabled={busy !== null}
            onClick={() => exportPage('html')}
          />
        </div>
      </div>

      {/* Workspace-level export */}
      <div>
        <SectionLabel>Entire workspace</SectionLabel>
        <div className="flex flex-col gap-2">
          <ActionCard
            icon="📦"
            label="Workspace (.zip)"
            hint="All pages as Markdown + sitemap"
            loading={busy === 'workspace-markdown'}
            disabled={busy !== null}
            onClick={() => exportWorkspace('markdown')}
          />
          <ActionCard
            icon="🗂️"
            label="Workspace HTML (.zip)"
            hint="All pages as HTML + sitemap"
            loading={busy === 'workspace-html'}
            disabled={busy !== null}
            onClick={() => exportWorkspace('html')}
          />
        </div>
      </div>

      {/* Backup */}
      <div>
        <SectionLabel>Backup & Restore</SectionLabel>
        <div className="flex flex-col gap-2">
          <ActionCard
            icon="💾"
            label="Create backup"
            hint="Full workspace + database + attachments"
            loading={busy === 'backup'}
            disabled={busy !== null}
            onClick={createBackup}
          />
          <ActionCard
            icon="♻️"
            label="Restore backup"
            hint="Replace all data from a .zip backup"
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

function ImportTab({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importFile = async (
    label: string,
    extensions: string[],
    importer: (path: string) => Promise<{ id: string; title: string }>,
  ) => {
    setBusy(label);
    setError(null);
    try {
      const path = await open({ multiple: false, filters: [{ name: label, extensions }] });
      if (!path || typeof path !== 'string') {
        setBusy(null);
        return;
      }
      const page = await importer(path);
      await queryClient.invalidateQueries({ queryKey: ['pages'] });
      window.dispatchEvent(
        new CustomEvent('folio:toast', { detail: `Imported "${page.title || 'Untitled'}"` }),
      );
      setCurrentPage(page.id);
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
      const msg = `Imported ${result.pagesCreated} page${result.pagesCreated === 1 ? '' : 's'}${
        result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ''
      }`;
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
      <p className="text-[13px] text-text-secondary">
        Import content from an external file. New pages are created at the workspace root.
      </p>
      {error && (
        <p className="text-[12px] text-status-red bg-status-red/10 rounded px-2 py-1.5">{error}</p>
      )}
      <div className="flex flex-col gap-2">
        <ActionCard
          icon="📝"
          label="Markdown"
          hint=".md or .markdown file"
          loading={busy === 'Markdown'}
          disabled={busy !== null}
          onClick={() => importFile('Markdown', ['md', 'markdown'], (p) => api.importMarkdown(p))}
        />
        <ActionCard
          icon="🌐"
          label="HTML"
          hint=".html or .htm file"
          loading={busy === 'HTML'}
          disabled={busy !== null}
          onClick={() => importFile('HTML', ['html', 'htm'], (p) => api.importHtml(p))}
        />
        <ActionCard
          icon="📊"
          label="CSV"
          hint="Spreadsheet → database with auto-typed columns"
          loading={busy === 'CSV'}
          disabled={busy !== null}
          onClick={() => importFile('CSV', ['csv'], (p) => api.importCsv(p))}
        />
        <ActionCard
          icon="🗃️"
          label="Notion export"
          hint=".zip from Notion → page tree with images"
          loading={busy === 'Notion export'}
          disabled={busy !== null}
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
      {loading && <span className="text-[11px] text-text-tertiary animate-pulse">working…</span>}
    </button>
  );
}

/** Strip characters that are unsafe in filenames. */
function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}
