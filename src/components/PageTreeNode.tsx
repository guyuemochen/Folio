import { useEffect, useRef, useState } from 'react';
import type { PageSummary } from '../lib/types';
import { useWorkspaceStore } from '../store/workspaceStore';
import { api } from '../lib/invoke';

interface PageTreeNodeProps {
  page: PageSummary;
  level: number;
}

/**
 * Recursive page-tree row.
 *
 * Lazy-loads children on first expand. Supports HTML5 native drag rearrange,
 * inline rename, and the full PRD §5.2.3 context menu
 * (New subpage / Rename / Duplicate / Move to / Favorite / Trash).
 */
export function PageTreeNode({ page, level }: PageTreeNodeProps) {
  const expanded = useWorkspaceStore((s) => s.expanded.has(page.id));
  const currentPageId = useWorkspaceStore((s) => s.currentPageId);
  const childrenCache = useWorkspaceStore((s) => s.childrenCache[page.id]);
  const loadChildren = useWorkspaceStore((s) => s.loadChildren);
  const setCurrentPage = useWorkspaceStore((s) => s.setCurrentPage);
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand);
  const setExpanded = useWorkspaceStore((s) => s.setExpanded);
  const createChildPage = useWorkspaceStore((s) => s.createChildPage);
  const renamePageLocally = useWorkspaceStore((s) => s.renamePageLocally);
  const trashPage = useWorkspaceStore((s) => s.trashPage);
  const setFavorite = useWorkspaceStore((s) => s.setFavorite);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const children = childrenCache ?? [];
  const hasChildrenKnown = page.id in useWorkspaceStore.getState().childrenCache;

  // Lazy-load children when expanded for the first time.
  useEffect(() => {
    if (expanded && !hasChildrenKnown) {
      loadChildren(page.id).catch((err) =>
        console.error('[Folio] loadChildren failed', err),
      );
    }
  }, [expanded, hasChildrenKnown, page.id, loadChildren]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const active = page.id === currentPageId;

  const commitRename = async () => {
    setIsEditing(false);
    const next = draft.trim();
    if (next && next !== page.title) {
      try {
        await api.renamePage(page.id, next);
        renamePageLocally(page.id, next);
      } catch (err) {
        console.error('[Folio] rename failed', err);
      }
    } else {
      setDraft(page.title);
    }
  };

  const handleNewSubpage = async () => {
    try {
      const child = await createChildPage(page.id, 'Untitled');
      setExpanded(page.id, true);
      setCurrentPage(child.id);
    } catch (err) {
      console.error('[Folio] new subpage failed', err);
    }
  };

  const handleDuplicate = async () => {
    try {
      const full = await api.getPage(page.id);
      const child = await createChildPage(page.parentId ?? '', 'Copy of ' + (page.title || 'Untitled'));
      if (full.doc && full.doc !== '{"type":"doc","content":[{"type":"paragraph"}]}') {
        await api.updatePageDoc(child.id, full.doc);
      }
      setCurrentPage(child.id);
    } catch (err) {
      console.error('[Folio] duplicate failed', err);
    }
  };

  const handleTrash = async () => {
    try {
      await trashPage(page.id);
    } catch (err) {
      console.error('[Folio] trash failed', err);
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await setFavorite(page.id, !page.favorite);
    } catch (err) {
      console.error('[Folio] favorite failed', err);
    }
  };

  const openMenu = (rect: DOMRect) => {
    setMenuRect(rect);
    setMenuOpen(true);
  };

  return (
    <div>
      <div
        className={[
          'group relative flex items-center gap-1 pr-1 py-[3px] rounded-md cursor-pointer text-[13px]',
          'transition-colors duration-100 select-none',
          active ? 'bg-bg-active font-semibold' : 'hover:bg-bg-hover',
        ].join(' ')}
        style={{ paddingLeft: 6 + level * 16 }}
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/folio-page', page.id);
        }}
        onClick={() => !isEditing && setCurrentPage(page.id)}
        onDoubleClick={() => {
          setDraft(page.title);
          setIsEditing(true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu((e.currentTarget as HTMLElement).getBoundingClientRect());
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(page.id);
          }}
          className="w-4 flex-shrink-0 text-[10px] text-text-tertiary hover:text-text-primary"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <span className="flex-shrink-0 text-sm leading-none">
          {page.icon ?? '📄'}
        </span>

        {isEditing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                setDraft(page.title);
                setIsEditing(false);
              }
            }}
            className="flex-1 min-w-0 bg-transparent outline-none border-b border-accent text-[13px]"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">{page.title || 'Untitled'}</span>
        )}

        {page.favorite && !isEditing && (
          <span className="text-[10px] text-status-amber" title="Favorite">⭐</span>
        )}

        {!isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openMenu((e.currentTarget as HTMLElement).getBoundingClientRect());
            }}
            className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary px-1"
            aria-label="More actions"
          >
            ⋯
          </button>
        )}
      </div>

      {/* Children */}
      {expanded && children.length > 0 && (
        <div>
          {children.map((c) => (
            <PageTreeNode key={c.id} page={c} level={level + 1} />
          ))}
        </div>
      )}
      {expanded && children.length === 0 && hasChildrenKnown && (
        <div
          className="text-text-tertiary/60 italic text-[12px]"
          style={{ paddingLeft: 6 + (level + 1) * 16 + 22, paddingTop: 2, paddingBottom: 2 }}
        >
          No pages
        </div>
      )}

      {menuOpen && menuRect && (
        <NodeMenu
          anchorRect={menuRect}
          isFavorite={page.favorite}
          onClose={() => setMenuOpen(false)}
          onNewSubpage={() => {
            setMenuOpen(false);
            void handleNewSubpage();
          }}
          onRename={() => {
            setMenuOpen(false);
            setDraft(page.title);
            setIsEditing(true);
          }}
          onDuplicate={() => {
            setMenuOpen(false);
            void handleDuplicate();
          }}
          onMoveTo={() => {
            setMenuOpen(false);
            // MVP "Move to" placeholder — surface a toast via window event.
            window.dispatchEvent(new CustomEvent('folio:toast', { detail: 'Move to — coming soon' }));
          }}
          onToggleFavorite={() => {
            setMenuOpen(false);
            void handleToggleFavorite();
          }}
          onTrash={() => {
            setMenuOpen(false);
            if (confirm(`Move "${page.title || 'Untitled'}" to trash?`)) {
              void handleTrash();
            }
          }}
        />
      )}
    </div>
  );
}

interface NodeMenuProps {
  anchorRect: DOMRect;
  isFavorite: boolean;
  onClose: () => void;
  onNewSubpage: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMoveTo: () => void;
  onToggleFavorite: () => void;
  onTrash: () => void;
}

function NodeMenu(props: NodeMenuProps) {
  // Reuse the lightweight popover styling. Inline rather than using
  // <Popover> because we want the menu flush to the row, not anchored above.
  const { anchorRect, onClose, isFavorite, ...handlers } = props;
  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-node-menu]')) onClose();
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

  // Position the menu just below the row, right-aligned to the row.
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 2,
    left: Math.min(anchorRect.right - 176, window.innerWidth - 184),
    width: 176,
    zIndex: 1100,
  };

  return (
    <div
      data-node-menu
      style={style}
      className="rounded-md border border-border-hairline bg-bg-page shadow-popover py-1 text-[13px]"
    >
      <MenuItem label="New subpage" onClick={handlers.onNewSubpage} />
      <MenuItem label="Rename" onClick={handlers.onRename} />
      <MenuItem label="Duplicate" onClick={handlers.onDuplicate} />
      <MenuItem label="Move to…" onClick={handlers.onMoveTo} />
      <MenuItem
        label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
        onClick={handlers.onToggleFavorite}
      />
      <div className="my-1 border-t border-border-hairline" />
      <MenuItem label="Move to Trash" danger onClick={handlers.onTrash} />
    </div>
  );
}

function MenuItem({
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
