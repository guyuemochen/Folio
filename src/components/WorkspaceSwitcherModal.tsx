import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../store/workspaceStore';
import { api, open } from '../lib/invoke';
import type { RegisteredWorkspace } from '../lib/types';
import { useDialog } from '../lib/dialog';

interface WorkspaceSwitcherModalProps {
  onClose: () => void;
}

/**
 * Modal for managing workspaces: list, switch, create, rename, move, delete.
 *
 * Each workspace maps to a folder on disk containing `data.db`. Switching is
 * a hot-swap (no restart needed) — the backend atomically replaces the SQLite
 * connection and the frontend clears all caches.
 */
export function WorkspaceSwitcherModal({ onClose }: WorkspaceSwitcherModalProps) {
  const { t } = useTranslation();
  const dialog = useDialog({ onClose, label: t('workspace.manager') });

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentRegisteredWorkspace = useWorkspaceStore((s) => s.currentRegisteredWorkspace);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);

  const [switching, setSwitching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<RegisteredWorkspace | null>(null);

  useEffect(() => {
    loadWorkspaces().catch((err) => console.error('[Folio] loadWorkspaces failed', err));
  }, [loadWorkspaces]);

  const fireToast = useCallback(
    (msg: string) =>
      window.dispatchEvent(new CustomEvent('folio:toast', { detail: msg })),
    [],
  );

  const handleSwitch = useCallback(
    async (ws: RegisteredWorkspace) => {
      if (switching) return;
      if (currentRegisteredWorkspace?.id === ws.id) {
        onClose();
        return;
      }
      setSwitching(true);
      try {
        await switchWorkspace(ws.id);
        onClose();
      } catch (err) {
        console.error('[Folio] switch workspace failed', err);
        fireToast(t('workspace.switchFailed'));
      } finally {
        setSwitching(false);
      }
    },
    [switching, currentRegisteredWorkspace, switchWorkspace, onClose, fireToast, t],
  );

  const handleCreate = useCallback(async () => {
    try {
      const folder = await open({ directory: true, multiple: false, title: t('workspace.folderPrompt') });
      if (!folder || typeof folder !== 'string') return;

      // Warn if the folder looks like a cloud-sync directory.
      const lower = folder.toLowerCase();
      if (/(dropbox|onedrive|google drive|icloud|googledrive)/.test(lower)) {
        fireToast(t('workspace.cloudWarning'));
      }

      const name = t('workspace.defaultName');
      await api.createWorkspace(folder, name);
      await loadWorkspaces();
      onClose();
    } catch (err) {
      console.error('[Folio] create workspace failed', err);
      fireToast(t('workspace.createFailed'));
    }
  }, [t, fireToast, loadWorkspaces, onClose]);

  const handleStartRename = useCallback((ws: RegisteredWorkspace) => {
    setEditingId(ws.id);
    setEditName(ws.name);
  }, []);

  const handleCommitRename = useCallback(
    async (ws: RegisteredWorkspace) => {
      const trimmed = editName.trim();
      setEditingId(null);
      if (!trimmed || trimmed === ws.name) return;
      try {
        await api.renameWorkspace(ws.id, trimmed);
        await loadWorkspaces();
      } catch (err) {
        console.error('[Folio] rename workspace failed', err);
        fireToast(t('workspace.renameFailed'));
      }
    },
    [editName, loadWorkspaces, fireToast, t],
  );

  const handleMove = useCallback(
    async (ws: RegisteredWorkspace) => {
      try {
        const folder = await open({ directory: true, multiple: false, title: t('workspace.moveHint') });
        if (!folder || typeof folder !== 'string') return;
        await api.moveWorkspace(ws.id, folder);
        await loadWorkspaces();
        fireToast(t('workspace.move') + ' ✓');
      } catch (err) {
        console.error('[Folio] move workspace failed', err);
        fireToast(t('workspace.moveFailed'));
      }
    },
    [t, loadWorkspaces, fireToast],
  );

  const handleDelete = useCallback(
    async (ws: RegisteredWorkspace, deleteFiles: boolean) => {
      setConfirmDelete(null);
      try {
        await api.deleteWorkspace(ws.id, deleteFiles);
        await loadWorkspaces();
      } catch (err) {
        console.error('[Folio] delete workspace failed', err);
        fireToast(t('workspace.deleteFailed'));
      }
    },
    [loadWorkspaces, fireToast, t],
  );

  const sortedWorkspaces = useMemo(() => {
    const sorted = [...workspaces].sort((a, b) => b.lastOpened - a.lastOpened);
    // Move the current workspace to the top.
    if (currentRegisteredWorkspace) {
      const currentIdx = sorted.findIndex((w) => w.id === currentRegisteredWorkspace.id);
      if (currentIdx > 0) {
        const [curr] = sorted.splice(currentIdx, 1);
        sorted.unshift(curr);
      }
    }
    return sorted;
  }, [workspaces, currentRegisteredWorkspace]);

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        {...dialog.containerProps}
        onClick={(e) => e.stopPropagation()}
        className="mt-[12vh] w-[480px] max-h-[70vh] flex flex-col rounded-lg border border-border-hairline bg-bg-page shadow-popover overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-hairline">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {t('workspace.manager')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-[18px] leading-none px-1"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {sortedWorkspaces.length === 0 && !switching ? (
            <div className="px-4 py-8 text-center text-text-secondary text-[13px]">
              {t('workspace.noWorkspaces')}
            </div>
          ) : (
            <div className="py-1">
              {sortedWorkspaces.map((ws) => {
                const isActive = currentRegisteredWorkspace?.id === ws.id;
                const isEditing = editingId === ws.id;
                return (
                  <div
                    key={ws.id}
                    className={[
                      'group flex items-center gap-2 px-3 py-2 transition-colors',
                      isActive ? 'bg-bg-active' : 'hover:bg-bg-hover',
                    ].join(' ')}
                  >
                    <span className="text-[15px] flex-shrink-0">📁</span>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => handleCommitRename(ws)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommitRename(ws);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full px-1.5 py-0.5 text-[13px] rounded border border-accent-primary bg-bg-page text-text-primary outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitch(ws)}
                          disabled={switching}
                          className="w-full text-left disabled:opacity-50"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={[
                                'text-[13px] truncate',
                                isActive ? 'font-semibold text-text-primary' : 'text-text-primary',
                              ].join(' ')}
                            >
                              {ws.name}
                            </span>
                            {isActive && (
                              <span className="text-[10px] text-accent-primary flex-shrink-0">
                                {t('workspace.active')}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-text-tertiary truncate">
                            {ws.folderPath}
                          </div>
                        </button>
                      )}
                    </div>

                    {/* Per-workspace actions */}
                    {!isEditing && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartRename(ws)}
                          className="px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary rounded hover:bg-bg-section"
                          title={t('workspace.rename')}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(ws)}
                          className="px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary rounded hover:bg-bg-section"
                          title={t('workspace.move')}
                        >
                          📂
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(ws)}
                          className="px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-status-red rounded hover:bg-bg-section"
                          title={t('workspace.delete')}
                        >
                          🗑
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-hairline flex items-center justify-between">
          <span className="text-[11px] text-text-tertiary">
            {switching ? t('workspace.switching') : ''}
          </span>
          <button
            type="button"
            onClick={handleCreate}
            disabled={switching}
            className="px-3 py-1.5 text-[13px] font-medium text-bg-page bg-accent-primary rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            + {t('workspace.new')}
          </button>
        </div>
      </div>

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <DeleteConfirmDialog
          ws={confirmDelete}
          onConfirm={(deleteFiles) => handleDelete(confirmDelete, deleteFiles)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>,
    document.body,
  );
}

// =============================================================================
// Delete confirmation sub-dialog
// =============================================================================

interface DeleteConfirmProps {
  ws: RegisteredWorkspace;
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({ ws, onConfirm, onCancel }: DeleteConfirmProps) {
  const { t } = useTranslation();
  const [deleteFiles, setDeleteFiles] = useState(false);

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[380px] rounded-lg border border-border-hairline bg-bg-page shadow-popover p-4"
      >
        <h3 className="text-[14px] font-semibold text-text-primary mb-2">
          {t('workspace.deleteConfirm', { name: ws.name })}
        </h3>
        <p className="text-[12px] text-text-secondary mb-3">
          {t('workspace.deleteHint')}
        </p>
        <label className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="accent-accent-primary"
          />
          {t('workspace.deleteWithFiles')}
        </label>
        {deleteFiles && (
          <p className="text-[11px] text-status-red mb-3">
            {t('workspace.deleteFilesConfirm')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteFiles)}
            className={[
              'px-3 py-1.5 text-[13px] font-medium rounded-md',
              deleteFiles
                ? 'bg-status-red text-white hover:opacity-90'
                : 'bg-accent-primary text-bg-page hover:opacity-90',
            ].join(' ')}
          >
            {t('common.remove')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
