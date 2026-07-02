import { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { api } from '../lib/invoke';
import type { PageSummary } from '../lib/types';

/**
 * Sidebar — page tree navigation.
 *
 * MVP shape (PRD §6.1):
 *   [Workspace Switcher]
 *   Search (Cmd+K — wired in later milestone)
 *   ───
 *   Favorites (reserved)
 *   ───
 *   Pages (top-level)
 *     • page item with hover actions (new subpage / rename / trash)
 *   ───
 *   Trash (reserved)
 *   ───
 *   Settings / About (reserved)
 *
 * Inline rename: double-click the title.
 * Context menu: right-click the row.
 */
export function Sidebar() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const rootPages = useWorkspaceStore((s) => s.rootPages);
  const currentPageId = useWorkspaceStore((s) => s.currentPageId);
  const loadWorkspace = useWorkspaceStore((s) => s.loadWorkspace);
  const loadRootPages = useWorkspaceStore((s) => s.loadRootPages);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const createRootPage = useWorkspaceStore((s) => s.createRootPage);
  const removePageLocally = useWorkspaceStore((s) => s.removePageLocally);
  const renamePageLocally = useWorkspaceStore((s) => s.renamePageLocally);

  useEffect(() => {
    Promise.all([loadWorkspace(), loadRootPages()]).catch((err) =>
      console.error('[Folio] sidebar init failed', err),
    );
  }, [loadWorkspace, loadRootPages]);

  const handleNewRootPage = async () => {
    const page = await createRootPage('Untitled');
    setCurrentPage(page.id);
  };

  const createRootDatabase = useWorkspaceStore((s) => s.createRootDatabase);

  const handleNewRootDatabase = async () => {
    const db = await createRootDatabase('Untitled database');
    setCurrentPage(db.id);
  };

  const handleTrash = async (pageId: string) => {
    try {
      await api.trashPage(pageId);
      removePageLocally(pageId);
    } catch (err) {
      console.error('[Folio] trash failed', err);
    }
  };

  return (
    <aside className="w-sidebar bg-bg-sidebar border-r border-border-hairline flex flex-col select-none text-[13px]">
      {/* Workspace header */}
      <button
        type="button"
        className="h-11 px-3 flex items-center gap-2 hover:bg-bg-hover transition-colors"
      >
        <span className="text-[15px]">📝</span>
        <span className="font-medium flex-1 text-left truncate text-text-primary">
          {workspace?.name ?? 'Folio'}
        </span>
        <span className="text-[10px] text-text-tertiary">▾</span>
      </button>

      {/* Quick actions */}
      <div className="px-2 pt-1 pb-2">
        <SidebarAction icon="+" label="New page" shortcut="Ctrl+N" onClick={handleNewRootPage} />
        <SidebarAction icon="📊" label="New database" onClick={handleNewRootDatabase} />
      </div>

      {/* Page list */}
      <div className="flex-1 px-1.5 pt-2 overflow-y-auto">
        <div className="px-2 pb-1 text-[11px] font-medium text-text-tertiary">Pages</div>
        {rootPages.length === 0 ? (
          <div className="px-2 py-1.5 text-text-tertiary/80 italic">
            No pages yet.
          </div>
        ) : (
          rootPages.map((p) => (
            <PageRow
              key={p.id}
              page={p}
              active={p.id === currentPageId}
              onClick={() => setCurrentPage(p.id)}
              onTrash={() => handleTrash(p.id)}
              onRename={async (title) => {
                try {
                  await api.renamePage(p.id, title);
                  renamePageLocally(p.id, title);
                } catch (err) {
                  console.error('[Folio] rename failed', err);
                }
              }}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 text-[11px] text-text-tertiary/70 border-t border-border-hairline">
        M3 · local-first
      </div>
    </aside>
  );
}

function SidebarAction({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: string;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-2 py-1 text-left rounded flex items-center gap-2 text-text-secondary hover:bg-bg-hover transition-colors"
    >
      <span className="w-4 text-center text-[14px] leading-none">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-text-tertiary/70">{shortcut}</span>}
    </button>
  );
}

interface PageRowProps {
  page: PageSummary;
  active: boolean;
  onClick: () => void;
  onTrash: () => void;
  onRename: (title: string) => void;
}

function PageRow({ page, active, onClick, onTrash, onRename }: PageRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commitRename = () => {
    setIsEditing(false);
    const next = draft.trim();
    if (next && next !== page.title) {
      onRename(next);
    } else {
      setDraft(page.title);
    }
  };

  return (
    <div
      className={[
        'group relative flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer',
        'transition-colors duration-100',
        active ? 'bg-bg-active text-text-primary font-semibold' : 'hover:bg-bg-hover text-text-primary',
      ].join(' ')}
      onClick={() => !isEditing && onClick()}
      onDoubleClick={() => {
        setDraft(page.title);
        setIsEditing(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <span className="flex-shrink-0 text-sm">{page.icon ?? '📄'}</span>

      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              setDraft(page.title);
              setIsEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 text-sm bg-transparent outline-none border-b border-accent"
        />
      ) : (
        <span className="flex-1 min-w-0 truncate">{page.title || 'Untitled'}</span>
      )}

      {/* Hover actions */}
      {!isEditing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(true);
          }}
          className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary px-1"
          aria-label="More actions"
        >
          ⋯
        </button>
      )}

      {/* Context menu */}
      {menuOpen && (
        <>
          {/* Click-away */}
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-sm">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setDraft(page.title);
                setIsEditing(true);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                if (confirm(`Move "${page.title || 'Untitled'}" to trash?`)) {
                  onTrash();
                }
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover text-status-red"
            >
              Move to Trash
            </button>
          </div>
        </>
      )}
    </div>
  );
}
