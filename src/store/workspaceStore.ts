import { create } from 'zustand';
import type { PageSummary, RegisteredWorkspace, TrashedPage, Workspace } from '../lib/types';
import { api } from '../lib/invoke';
import { queryClient } from '../lib/queryClient';

const RECENTS_KEY = 'folio:recents';
const RECENTS_MAX = 5;
const EXPANDED_KEY = 'folio:expanded-tree-nodes';

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return (parsed as string[]).slice(0, RECENTS_MAX);
    }
  } catch {
    // ignore — fall through to empty
  }
  return [];
}

function saveRecents(ids: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_MAX)));
  } catch {
    // ignore quota errors
  }
}

/** Persisted set of expanded page-tree node ids (so the tree state survives reloads). */
function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return new Set(parsed as string[]);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveExpanded(ids: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore quota errors
  }
}

/** Sentinel key used for the root-pages slot of the children cache. */
const ROOT_KEY = '__root__';

/**
 * Workspace-level UI state — current page id + cached page lists for the sidebar.
 *
 * Page *content* is fetched per-page in PageView (TanStack Query), not stored here.
 * The sidebar's recursive page tree reads lazily from `childrenCache`: a map from
 * parent id (or ROOT_KEY) to that parent's child PageSummary list.
 */
interface WorkspaceState {
  workspace: Workspace | null;
  /** The active registered workspace (with folder path, from the registry). */
  currentRegisteredWorkspace: RegisteredWorkspace | null;
  /** All known workspaces from the registry. */
  workspaces: RegisteredWorkspace[];
  /** Children of the workspace root (kept for backwards-compat / quick access). */
  rootPages: PageSummary[];
  /** Children cache for the recursive page tree. Key = parent id, or ROOT_KEY. */
  childrenCache: Record<string, PageSummary[]>;
  /** Set of expanded tree node ids. */
  expanded: Set<string>;
  /** Currently open page id (drives the route). */
  currentPageId: string | null;
  /** Recently opened page ids (most recent first). Cap at RECENTS_MAX (5). */
  recents: string[];
  /** Favorited pages (ordered by user). */
  favorites: PageSummary[];
  /** Trashed pages. Loaded on demand when Trash is opened. */
  trashedPages: TrashedPage[];

  // Actions
  loadWorkspace: () => Promise<void>;
  loadWorkspaces: () => Promise<void>;
  loadRootPages: () => Promise<void>;
  loadChildren: (parentId: string) => Promise<void>;
  setCurrentPage: (pageId: string | null) => void;
  createRootPage: (title?: string) => Promise<PageSummary>;
  createRootDatabase: (name?: string) => Promise<PageSummary>;
  createChildPage: (parentId: string, title?: string) => Promise<PageSummary>;
  createChildDatabase: (parentId: string, name?: string) => Promise<PageSummary>;
  /** Add a row to a database (the row IS a page with parentType='database'). */
  createDatabaseRow: (databaseId: string) => Promise<PageSummary>;
  /** Reparent a page (sidebar drag-to-move). newParentId=null → workspace root. */
  movePage: (
    pageId: string,
    newParentId: string | null,
    newParentType: 'workspace' | 'page',
  ) => Promise<void>;
  toggleExpand: (pageId: string) => void;
  setExpanded: (pageId: string, expanded: boolean) => void;
  removePageLocally: (pageId: string) => void;
  renamePageLocally: (pageId: string, title: string) => void;
  updateIconLocally: (pageId: string, icon: string | null) => void;
  updateCoverLocally: (pageId: string, cover: string | null) => void;

  // Workspace management
  /** Switch to a different workspace: flush editor → backend swap → reset caches. */
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /** Clear all workspace-specific state (called after a successful switch). */
  resetWorkspace: () => void;

  // Favorites
  loadFavorites: () => Promise<void>;
  setFavorite: (pageId: string, isFavorite: boolean) => Promise<void>;
  reorderFavorites: (orderedIds: string[]) => Promise<void>;

  // Trash
  loadTrashedPages: () => Promise<void>;
  trashPage: (pageId: string) => Promise<void>;
  restorePage: (pageId: string) => Promise<void>;
  deletePermanently: (pageId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

function summaryFromPage(p: {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  parentType: 'workspace' | 'page' | 'database';
  type: 'page' | 'database';
  isTrashed: boolean;
  updatedAt: number;
  favorite?: boolean;
}): PageSummary {
  return {
    id: p.id,
    title: p.title,
    icon: p.icon,
    parentId: p.parentId,
    parentType: p.parentType,
    type: p.type,
    isTrashed: p.isTrashed,
    updatedAt: p.updatedAt,
    favorite: p.favorite ?? false,
  };
}

/** Remove a page id from anywhere it appears in the children cache. */
function purgeFromCache(
  cache: Record<string, PageSummary[]>,
  pageId: string,
): Record<string, PageSummary[]> {
  const next: Record<string, PageSummary[]> = {};
  for (const [k, v] of Object.entries(cache)) {
    next[k] = v.filter((p) => p.id !== pageId);
  }
  return next;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  currentRegisteredWorkspace: null,
  workspaces: [],
  rootPages: [],
  childrenCache: {},
  expanded: loadExpanded(),
  currentPageId: null,
  recents: loadRecents(),
  favorites: [],
  trashedPages: [],

  loadWorkspace: async () => {
    const ws = await api.getWorkspace();
    const regWs = await api.getCurrentWorkspace();
    set({ workspace: ws, currentRegisteredWorkspace: regWs });
  },

  loadWorkspaces: async () => {
    const list = await api.listWorkspaces();
    set({ workspaces: list });
  },

  loadRootPages: async () => {
    const pages = await api.listPages(null);
    set((s) => ({
      rootPages: pages,
      childrenCache: { ...s.childrenCache, [ROOT_KEY]: pages },
    }));
  },

  loadChildren: async (parentId) => {
    const pages = await api.listPages(parentId);
    set((s) => ({ childrenCache: { ...s.childrenCache, [parentId]: pages } }));
  },

  setCurrentPage: (pageId) =>
    set((s) => {
      if (!pageId) return { currentPageId: null };
      // Prepend to recents (dedupe, cap at RECENTS_MAX), persist to localStorage.
      const next = [pageId, ...s.recents.filter((id) => id !== pageId)].slice(0, RECENTS_MAX);
      saveRecents(next);
      return { currentPageId: pageId, recents: next };
    }),

  createRootPage: async (title) => {
    const page = await api.createPage({ parentId: null, parentType: 'workspace', title });
    const summary = summaryFromPage(page);
    set((s) => ({
      rootPages: [...s.rootPages, summary],
      childrenCache: {
        ...s.childrenCache,
        [ROOT_KEY]: [...(s.childrenCache[ROOT_KEY] ?? s.rootPages), summary],
      },
    }));
    return summary;
  },

  createRootDatabase: async (name) => {
    const db = await api.createDatabase({ parentId: null, parentType: 'workspace', name });
    const summary = summaryFromPage(db);
    set((s) => ({
      rootPages: [...s.rootPages, summary],
      childrenCache: {
        ...s.childrenCache,
        [ROOT_KEY]: [...(s.childrenCache[ROOT_KEY] ?? s.rootPages), summary],
      },
    }));
    return summary;
  },

  createChildPage: async (parentId, title) => {
    const page = await api.createPage({ parentId, parentType: 'page', title });
    const summary = summaryFromPage(page);
    set((s) => {
      const existing = s.childrenCache[parentId] ?? [];
      return {
        childrenCache: { ...s.childrenCache, [parentId]: [...existing, summary] },
        expanded: new Set([...s.expanded, parentId]),
      };
    });
    return summary;
  },

  createChildDatabase: async (parentId, name) => {
    const db = await api.createDatabase({ parentId, parentType: 'page', name });
    const summary = summaryFromPage(db);
    set((s) => {
      const existing = s.childrenCache[parentId] ?? [];
      return {
        childrenCache: { ...s.childrenCache, [parentId]: [...existing, summary] },
        expanded: new Set([...s.expanded, parentId]),
      };
    });
    return summary;
  },

  createDatabaseRow: async (databaseId) => {
    const row = await api.addDatabaseRow(databaseId);
    const summary: PageSummary = {
      id: row.id,
      title: row.title,
      icon: row.icon,
      parentId: row.parentId,
      parentType: 'database',
      type: 'page',
      isTrashed: row.isTrashed,
      updatedAt: row.updatedAt,
      favorite: false,
    };
    set((s) => {
      const existing = s.childrenCache[databaseId] ?? [];
      return {
        childrenCache: { ...s.childrenCache, [databaseId]: [...existing, summary] },
        expanded: new Set([...s.expanded, databaseId]),
      };
    });
    // Bust the table view's row cache so the new row appears immediately.
    queryClient.invalidateQueries({ queryKey: ['database-rows', databaseId] });
    return summary;
  },

  movePage: async (pageId, newParentId, newParentType) => {
    const page = await api.movePage({ pageId, newParentId, newParentType });
    const summary = summaryFromPage(page);
    set((s) => {
      // The old parent is not known reliably, so purge the moved page from every
      // cached list (root + all children) then re-insert under the new parent.
      const nextCache = purgeFromCache(s.childrenCache, pageId);
      const nextRoot = s.rootPages.filter((p) => p.id !== pageId);
      if (newParentId === null) {
        return {
          rootPages: [...nextRoot, summary],
          childrenCache: { ...nextCache, [ROOT_KEY]: [...nextRoot, summary] },
          expanded: s.expanded,
        };
      }
      return {
        rootPages: nextRoot,
        childrenCache: {
          ...nextCache,
          [newParentId]: [...(nextCache[newParentId] ?? []), summary],
        },
        // Auto-expand the new parent so the moved page is immediately visible.
        expanded: new Set([...s.expanded, newParentId]),
      };
    });
  },

  toggleExpand: (pageId) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      saveExpanded(next);
      return { expanded: next };
    }),

  setExpanded: (pageId, expanded) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (expanded) next.add(pageId);
      else next.delete(pageId);
      saveExpanded(next);
      return { expanded: next };
    }),

  removePageLocally: (pageId) => {
    set((s) => ({
      rootPages: s.rootPages.filter((p) => p.id !== pageId),
      childrenCache: purgeFromCache(s.childrenCache, pageId),
      favorites: s.favorites.filter((p) => p.id !== pageId),
      currentPageId: s.currentPageId === pageId ? null : s.currentPageId,
    }));
  },

  renamePageLocally: (pageId, title) =>
    set((s) => {
      const patch = (list: PageSummary[]) =>
        list.map((p) => (p.id === pageId ? { ...p, title } : p));
      const nextCache: Record<string, PageSummary[]> = {};
      for (const [k, v] of Object.entries(s.childrenCache)) {
        nextCache[k] = patch(v);
      }
      return {
        rootPages: patch(s.rootPages),
        childrenCache: nextCache,
        favorites: patch(s.favorites),
      };
    }),

  updateIconLocally: (pageId, icon) =>
    set((s) => {
      const patch = (list: PageSummary[]) =>
        list.map((p) => (p.id === pageId ? { ...p, icon } : p));
      const nextCache: Record<string, PageSummary[]> = {};
      for (const [k, v] of Object.entries(s.childrenCache)) {
        nextCache[k] = patch(v);
      }
      return {
        rootPages: patch(s.rootPages),
        childrenCache: nextCache,
        favorites: patch(s.favorites),
      };
    }),

  updateCoverLocally: () => {
    // Cover is only used by the open PageView, not by sidebar summaries.
    // No-op here — kept for API symmetry in case future sidebars render covers.
  },

  // === Workspace management ===============================================

  resetWorkspace: () => {
    set({
      workspace: null,
      currentRegisteredWorkspace: null,
      rootPages: [],
      childrenCache: {},
      currentPageId: null,
      favorites: [],
      trashedPages: [],
      expanded: new Set(),
      recents: [],
    });
    try {
      localStorage.removeItem(RECENTS_KEY);
      localStorage.removeItem(EXPANDED_KEY);
    } catch {
      // ignore
    }
    // Clear ALL TanStack Query caches so stale data from the old workspace
    // never bleeds into the new one.
    queryClient.clear();
  },

  switchWorkspace: async (workspaceId) => {
    // 1. Tell the editor to flush any pending debounced save BEFORE the
    //    backend swaps the connection. The editor listens for this event
    //    and awaits its save before we proceed.
    window.dispatchEvent(new CustomEvent('folio:workspace-switching'));

    // Give the editor listener a microtask to start its flush.
    // The actual save + backend swap are serialized by the Mutex on the
    // Rust side, so even if the flush is still in-flight when switchWorkspace
    // runs, the switch command will wait for the lock.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2. Backend swap (opens new DB, swaps under lock, emits event).
    await api.switchWorkspace(workspaceId);

    // 3. Clear all caches + workspace-scoped state.
    get().resetWorkspace();

    // 4. Reload everything for the new workspace.
    await Promise.all([
      get().loadWorkspace(),
      get().loadRootPages(),
      get().loadFavorites(),
      get().loadWorkspaces(),
    ]);
  },

  // === Favorites ===========================================================
  loadFavorites: async () => {
    const favs = await api.listFavorites();
    set({ favorites: favs });
  },

  setFavorite: async (pageId, isFavorite) => {
    await api.setFavorite(pageId, isFavorite);
    await get().loadFavorites();
    // Also reflect the flag into the children cache so tree rows update.
    set((s) => {
      const patch = (list: PageSummary[]) =>
        list.map((p) => (p.id === pageId ? { ...p, favorite: isFavorite } : p));
      const nextCache: Record<string, PageSummary[]> = {};
      for (const [k, v] of Object.entries(s.childrenCache)) {
        nextCache[k] = patch(v);
      }
      return { rootPages: patch(s.rootPages), childrenCache: nextCache };
    });
  },

  reorderFavorites: async (orderedIds) => {
    await api.reorderFavorites(orderedIds);
    await get().loadFavorites();
  },

  // === Trash ===============================================================
  loadTrashedPages: async () => {
    const list = await api.listTrashedPages();
    set({ trashedPages: list });
  },

  trashPage: async (pageId) => {
    await api.trashPage(pageId);
    set((s) => ({
      rootPages: s.rootPages.filter((p) => p.id !== pageId),
      childrenCache: purgeFromCache(s.childrenCache, pageId),
      favorites: s.favorites.filter((p) => p.id !== pageId),
      currentPageId: s.currentPageId === pageId ? null : s.currentPageId,
    }));
    // The trashed page may be a database row — bust the rows cache so the
    // table view removes it immediately.
    queryClient.invalidateQueries({ queryKey: ['database-rows'] });
    await get().loadTrashedPages();
  },

  restorePage: async (pageId) => {
    await api.restorePage(pageId);
    set((s) => ({ trashedPages: s.trashedPages.filter((p) => p.id !== pageId) }));
    // The restored page may be a database row — bust the rows cache.
    queryClient.invalidateQueries({ queryKey: ['database-rows'] });
    // Refresh root list — the page may have been restored to workspace root.
    await get().loadRootPages();
  },

  deletePermanently: async (pageId) => {
    await api.deletePagePermanently(pageId);
    set((s) => ({ trashedPages: s.trashedPages.filter((p) => p.id !== pageId) }));
    // The permanently deleted page may have been a database row.
    queryClient.invalidateQueries({ queryKey: ['database-rows'] });
  },

  emptyTrash: async () => {
    await api.emptyTrash();
    set({ trashedPages: [] });
  },
}));

/** Convenience selector for components that only want the currentPageId. */
export function useCurrentPageId(): string | null {
  return useWorkspaceStore((s) => s.currentPageId);
}

/** Sentinel exported for tree components that want to read the root slot. */
export const TREE_ROOT_KEY = ROOT_KEY;
