import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from '../ui/Popover';
import type { ViewConfig } from '../../lib/types';
import { nextViewName, useViewTabs } from './useViewTabs';

interface ViewTabsProps {
  databaseId: string;
  views: ViewConfig[];
  activeViewId: string | null;
  /** Called whenever the user picks a tab. The parent owns the active id
   * (so it can persist it via localStorage) and passes it back in. */
  onSelect: (viewId: string) => void;
  /** Called after a create/rename/delete/duplicate so the parent can update
   * the active id (e.g. switch to the newly created tab). The hook already
   * refreshes the schema query; this is purely for active-tab bookkeeping. */
  onAfterMutate: (mutation: { kind: 'create' | 'duplicate'; view: ViewConfig } | { kind: 'delete'; viewId: string }) => void;
}

/**
 * Tab strip above the database table (Phase 1 of the multi-view feature).
 *
 * Renders one tab per saved `ViewConfig`, plus a ➕ button that opens a
 * type-picker popover (table / board / calendar / timeline / gallery / list).
 * Tabs support click-to-switch, double-click-to-rename (inline input), and a
 * right-click context menu (Rename / Duplicate / Delete). Embedded
 * LinkedDatabaseBlock instances never render this strip — they stay
 * single-view by design.
 *
 * The component is presentational + local-state only. All view mutations go
 * through `useViewTabs`, and the active-tab id is owned by the parent so it
 * can be persisted to localStorage independently of the backend.
 */
export function ViewTabs({ databaseId, views, activeViewId, onSelect, onAfterMutate }: ViewTabsProps) {
  const { t } = useTranslation();
  const { createView, renameView, deleteView, duplicateView } = useViewTabs(databaseId);
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const [createPickerAnchor, setCreatePickerAnchor] = useState<DOMRect | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ viewId: string; anchorRect: DOMRect } | null>(null);

  const onPlusClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setCreatePickerAnchor(e.currentTarget.getBoundingClientRect());
    setCreatePickerOpen(true);
  };

  const handleCreate = async (type: ViewConfig['type']) => {
    const typeLabel = t(`database.viewType.${type}`);
    const name = nextViewName(views, type, typeLabel === `database.viewType.${type}` ? type : typeLabel);
    setCreatePickerOpen(false);
    try {
      const v = await createView({ name, type });
      onAfterMutate({ kind: 'create', view: v });
    } catch (err) {
      console.error('[Folio] create view failed', err);
    }
  };

  const handleRenameCommit = async (viewId: string, nextName: string) => {
    const trimmed = nextName.trim();
    setRenamingId(null);
    // No-op if the name is empty or unchanged — avoid spurious API calls +
    // backend round-trips that would invalidate the schema query for nothing.
    if (!trimmed) return;
    const current = views.find((v) => v.id === viewId);
    if (current && current.name === trimmed) return;
    try {
      await renameView(viewId, trimmed);
    } catch (err) {
      console.error('[Folio] rename view failed', err);
    }
  };

  const handleDelete = async (viewId: string) => {
    setMenuFor(null);
    if (views.length <= 1) return; // never let the last view be deleted
    if (!window.confirm(t('database.deleteViewConfirm'))) return;
    try {
      await deleteView(viewId);
      onAfterMutate({ kind: 'delete', viewId });
    } catch (err) {
      console.error('[Folio] delete view failed', err);
    }
  };

  const handleDuplicate = async (viewId: string) => {
    setMenuFor(null);
    const source = views.find((v) => v.id === viewId);
    if (!source) return;
    try {
      const created = await duplicateView(source);
      onAfterMutate({ kind: 'duplicate', view: created });
    } catch (err) {
      console.error('[Folio] duplicate view failed', err);
    }
  };

  return (
    <div className="flex items-center gap-0.5 px-2 pt-1.5 border-b border-border-hairline bg-bg-page overflow-x-auto">
      {views.map((view) => (
        <TabButton
          key={view.id}
          view={view}
          active={view.id === activeViewId}
          renaming={renamingId === view.id}
          onClick={() => onSelect(view.id)}
          onStartRename={() => setRenamingId(view.id)}
          onCommitRename={(name) => handleRenameCommit(view.id, name)}
          onContextMenu={(rect) => setMenuFor({ viewId: view.id, anchorRect: rect })}
        />
      ))}

      <button
        type="button"
        onClick={onPlusClick}
        className="ml-1 shrink-0 px-2 py-1 text-[12px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
        title={t('database.newView')}
        aria-label={t('database.newView')}
      >
        +
      </button>

      {createPickerOpen && createPickerAnchor && (
        <CreateViewPicker
          anchorRect={createPickerAnchor}
          onClose={() => setCreatePickerOpen(false)}
          onPick={handleCreate}
        />
      )}

      {menuFor && (
        <TabContextMenu
          anchorRect={menuFor.anchorRect}
          canDelete={views.length > 1}
          onClose={() => setMenuFor(null)}
          onRename={() => {
            setRenamingId(menuFor.viewId);
            setMenuFor(null);
          }}
          onDuplicate={() => handleDuplicate(menuFor.viewId)}
          onDelete={() => handleDelete(menuFor.viewId)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<ViewConfig['type'], string> = {
  table: '📋',
  board: '📊',
  calendar: '📅',
  timeline: '⏱',
  gallery: '🖼',
  list: '📝',
};

interface TabButtonProps {
  view: ViewConfig;
  active: boolean;
  renaming: boolean;
  onClick: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onContextMenu: (anchorRect: DOMRect) => void;
}

function TabButton({
  view,
  active,
  renaming,
  onClick,
  onStartRename,
  onCommitRename,
  onContextMenu,
}: TabButtonProps) {
  const { t } = useTranslation();
  const typeLabelKey = `database.viewType.${view.type}`;
  const rawTypeLabel = t(typeLabelKey);
  const typeLabel = rawTypeLabel === typeLabelKey ? view.type : rawTypeLabel;

  // Keyboard handler for the inline rename input: Enter commits, Escape
  // aborts (resets to original), and we stopPropagation so the parent
  // keydown handlers (if any) don't also fire.
  const onRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      (e.target as HTMLInputElement).value = view.name;
      (e.target as HTMLInputElement).blur();
    }
  };

  if (renaming) {
    return (
      <RenameInput
        initial={view.name}
        onCommit={onCommitRename}
        onKeyDown={onRenameKeyDown}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={(e) => {
        // Avoid selecting text on double-click; we want to enter rename mode.
        e.preventDefault();
        onStartRename();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.currentTarget.getBoundingClientRect());
      }}
      title={`${view.name} · ${typeLabel}`}
      className={`group relative shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] rounded-t-md transition-colors ${
        active
          ? 'text-text-primary bg-bg-section font-medium'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
    >
      <span className="text-[11px] opacity-80" aria-hidden>{TYPE_ICON[view.type]}</span>
      <span className="max-w-[180px] truncate">{view.name}</span>
      {/* Active underline — uses --accent so it follows the theme. */}
      {active && (
        <span
          aria-hidden
          className="absolute left-2 right-2 -bottom-px h-0.5 bg-accent rounded-full"
        />
      )}
    </button>
  );
}

interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

function RenameInput({ initial, onCommit, onKeyDown }: RenameInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  // Autofocus + select-all on mount so the user can just start typing to
  // replace the existing name (matches Notion / browser tab rename UX).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initial}
      onKeyDown={onKeyDown}
      onBlur={(e) => onCommit(e.target.value)}
      // Match the tab's font metrics so the rename input doesn't visibly
      // shift the strip height when it appears.
      className="shrink-0 px-2 py-1 text-[12.5px] bg-bg-page border border-accent rounded outline-none min-w-[80px]"
    />
  );
}

interface CreateViewPickerProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onPick: (type: ViewConfig['type']) => void;
}

function CreateViewPicker({ anchorRect, onClose, onPick }: CreateViewPickerProps) {
  const { t } = useTranslation();
  const types: ViewConfig['type'][] = ['table', 'board', 'calendar', 'timeline', 'gallery', 'list'];
  return (
    <Popover anchorRect={anchorRect} onClose={onClose} width={280} placement="bottom-start" ariaLabel={t('database.newView')}>
      <div className="py-2">
        <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          {t('database.pickViewType')}
        </div>
        <div className="grid grid-cols-2 gap-1 px-2">
          {types.map((type) => {
            const labelKey = `database.viewType.${type}`;
            const raw = t(labelKey);
            const label = raw === labelKey ? type : raw;
            // Non-table types get a subtle "Preview" badge so the user knows
            // the renderer is in development before they click. We don't use
            // `viewTypeComingSoon` here because that one carries the type
            // name and would be redundant next to the label.
            const implemented = type === 'table';
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className="flex items-center gap-2 px-2 py-2 text-[12px] rounded text-left text-text-primary hover:bg-bg-hover transition-colors"
              >
                <span className="text-[14px]" aria-hidden>{TYPE_ICON[type]}</span>
                <span className="flex flex-col">
                  <span className="font-medium">{label}</span>
                  {!implemented && (
                    <span className="text-[10px] text-text-tertiary italic">
                      {t('database.viewTypePreviewTag')}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

interface TabContextMenuProps {
  anchorRect: DOMRect;
  canDelete: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function TabContextMenu({
  anchorRect,
  canDelete,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
}: TabContextMenuProps) {
  const { t } = useTranslation();
  return (
    <Popover anchorRect={anchorRect} onClose={onClose} width={200} placement="bottom-start">
      <div className="py-1">
        <MenuItem label={t('database.renameView')} onClick={onRename} />
        <MenuItem label={t('database.duplicateView')} onClick={onDuplicate} />
        <MenuItem
          label={canDelete ? t('database.deleteView') : t('database.atLeastOneView')}
          onClick={canDelete ? onDelete : onClose}
          danger={canDelete}
          disabled={!canDelete}
        />
      </div>
    </Popover>
  );
}

interface MenuItemProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function MenuItem({ label, onClick, danger, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-[12.5px] ${
        disabled
          ? 'text-text-tertiary cursor-not-allowed'
          : danger
            ? 'text-status-red hover:bg-bg-hover'
            : 'text-text-primary hover:bg-bg-hover'
      }`}
    >
      {label}
    </button>
  );
}
