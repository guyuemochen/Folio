import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/invoke';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { ExportFormat } from '../lib/types';

/**
 * Import / Export modal (PRD §5.5, M5).
 *
 * Reuses the SearchModal portal+backdrop pattern. Two tabs:
 *   - **Export** — format picker (Markdown / HTML) → Blob download. Phase 1.
 *   - **Import** — file-picker entry points for MD/HTML/CSV/Notion zip.
 *     Phase 2+ adds the handlers; the tab is shown now as a coming-soon stub
 *     so the UX shape is visible.
 *
 * Opened from PageView's MoreMenu ("Export…") and, in later phases, from a
 * sidebar button.
 */
interface ImportExportModalProps {
  /** The page to export (Export tab is page-scoped in Phase 1). */
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}

type Tab = 'export' | 'import';

export function ImportExportModal({ pageId, pageTitle, onClose }: ImportExportModalProps) {
  const [tab, setTab] = useState<Tab>('export');
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const content = await api.exportPage(pageId, format);
      const mime = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8';
      const ext = format === 'markdown' ? 'md' : 'html';
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(pageTitle) || 'untitled'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error('[Folio] export failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[480px] flex flex-col rounded-lg border border-border-hairline bg-bg-page shadow-popover overflow-hidden"
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

        {/* Body */}
        <div className="p-5">
          {tab === 'export' ? (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-text-secondary">
                Export <strong className="text-text-primary">{pageTitle || 'this page'}</strong> as a
                portable file.
              </p>

              <div className="flex flex-col gap-2">
                <FormatOption
                  selected={format === 'markdown'}
                  onClick={() => setFormat('markdown')}
                  icon="📝"
                  label="Markdown"
                  hint=".md — plain text, editable anywhere"
                />
                <FormatOption
                  selected={format === 'html'}
                  onClick={() => setFormat('html')}
                  icon="🌐"
                  label="HTML"
                  hint=".html — standalone, opens in any browser"
                />
              </div>

              {error && (
                <p className="text-[12px] text-status-red bg-status-red/10 rounded px-2 py-1.5">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-[13px] rounded text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={busy}
                  className="px-3.5 py-1.5 text-[13px] rounded bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Exporting…' : 'Download'}
                </button>
              </div>
            </div>
          ) : (
            <ImportTab onClose={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

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

function FormatOption({
  selected,
  onClick,
  icon,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors',
        selected
          ? 'border-accent bg-accent/5'
          : 'border-border-hairline hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className="text-[18px]">{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-medium text-text-primary">{label}</span>
        <span className="block text-[11px] text-text-tertiary">{hint}</span>
      </span>
      {selected && <span className="text-accent text-[14px]">✓</span>}
    </button>
  );
}

/**
 * Import tab: file pickers for Markdown / HTML (Phase 2), with CSV and Notion
 * zip shown as coming-soon (Phase 3). After a successful import, invalidates
 * the page list, navigates to the new page, and closes the modal.
 */
function ImportTab({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async (
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-text-secondary">
        Import content from an external file. New pages are created at the workspace root.
      </p>
      {error && (
        <p className="text-[12px] text-status-red bg-status-red/10 rounded px-2 py-1.5">{error}</p>
      )}
      <div className="flex flex-col gap-2">
        <ImportOption
          icon="📝"
          label="Markdown"
          hint=".md or .markdown file"
          disabled={busy !== null}
          loading={busy === 'Markdown'}
          onClick={() =>
            handleImport('Markdown', ['md', 'markdown'], (p) => api.importMarkdown(p))
          }
        />
        <ImportOption
          icon="🌐"
          label="HTML"
          hint=".html or .htm file"
          disabled={busy !== null}
          loading={busy === 'HTML'}
          onClick={() => handleImport('HTML', ['html', 'htm'], (p) => api.importHtml(p))}
        />
        <ImportOption icon="🗃️" label="Notion export" hint=".zip from Notion" soon />
        <ImportOption icon="📊" label="CSV" hint="Spreadsheet → database" soon />
      </div>
    </div>
  );
}

function ImportOption({
  icon,
  label,
  hint,
  onClick,
  disabled,
  loading,
  soon,
}: {
  icon: string;
  label: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  soon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || soon}
      className={[
        'w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors',
        soon
          ? 'border-border-hairline opacity-60 cursor-not-allowed'
          : 'border-border-hairline hover:bg-bg-hover disabled:opacity-50',
      ].join(' ')}
    >
      <span className="text-[18px]">{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-medium text-text-primary">{label}</span>
        <span className="block text-[11px] text-text-tertiary">{hint}</span>
      </span>
      {soon ? (
        <span className="text-[10px] text-text-tertiary uppercase tracking-wide">soon</span>
      ) : loading ? (
        <span className="text-[11px] text-text-tertiary animate-pulse">importing…</span>
      ) : null}
    </button>
  );
}

/** Strip characters that are unsafe in filenames on Windows/macOS/Linux. */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}
