import { create } from 'zustand';
import type { PageSummary, Workspace } from '../lib/types';
import { api } from '../lib/invoke';

const RECENTS_KEY = 'folio:recents';
const RECENTS_MAX = 10;

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

/**
 * Workspace-level UI state — current page id + cached page lists for the sidebar.
 *
 * Page *content* is fetched per-page in PageView (TanStack Query), not stored here.
 */
interface WorkspaceState {
  workspace: Workspace | null;
  /** Top-level pages shown in the sidebar. */
  rootPages: PageSummary[];
  /** Currently open page id (drives the route). */
  currentPageId: string | null;
  /** Recently opened page ids (most recent first). Cap at 10. */
  recents: string[];

  // Actions
  loadWorkspace: () => Promise<void>;
  loadRootPages: () => Promise<void>;
  setCurrentPage: (pageId: string | null) => void;
  createRootPage: (title?: string) => Promise<PageSummary>;
  createRootDatabase: (name?: string) => Promise<PageSummary>;
  createChildPage: (parentId: string, title?: string) => Promise<PageSummary>;
  removePageLocally: (pageId: string) => void;
  renamePageLocally: (pageId: string, title: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspace: null,
  rootPages: [],
  currentPageId: null,
  recents: loadRecents(),

  loadWorkspace: async () => {
    const ws = await api.getWorkspace();
    set({ workspace: ws });
  },

  loadRootPages: async () => {
    const pages = await api.listPages(null);
    set({ rootPages: pages });
  },

  setCurrentPage: (pageId) =>
    set((s) => {
      if (!pageId) return { currentPageId: null };
      // Prepend to recents (dedupe, cap at 10), persist to localStorage.
      const next = [pageId, ...s.recents.filter((id) => id !== pageId)].slice(0, 10);
      saveRecents(next);
      return { currentPageId: pageId, recents: next };
    }),

  createRootPage: async (title) => {
    const page = await api.createPage({ parentId: null, parentType: 'workspace', title });
    const summary: PageSummary = {
      id: page.id,
      title: page.title,
      icon: page.icon,
      parentId: page.parentId,
      parentType: page.parentType,
      isTrashed: page.isTrashed,
      updatedAt: page.updatedAt,
    };
    set((s) => ({ rootPages: [...s.rootPages, summary] }));
    return summary;
  },

  createRootDatabase: async (name) => {
    const db = await api.createDatabase({ parentId: null, parentType: 'workspace', name });
    const summary: PageSummary = {
      id: db.id,
      title: db.title,
      icon: db.icon,
      parentId: db.parentId,
      parentType: db.parentType,
      isTrashed: db.isTrashed,
      updatedAt: db.updatedAt,
    };
    set((s) => ({ rootPages: [...s.rootPages, summary] }));
    return summary;
  },

  createChildPage: async (parentId, title) => {
    const page = await api.createPage({ parentId, parentType: 'page', title });
    const summary: PageSummary = {
      id: page.id,
      title: page.title,
      icon: page.icon,
      parentId: page.parentId,
      parentType: page.parentType,
      isTrashed: page.isTrashed,
      updatedAt: page.updatedAt,
    };
    return summary;
  },

  removePageLocally: (pageId) => {
    set((s) => ({
      rootPages: s.rootPages.filter((p) => p.id !== pageId),
      currentPageId: s.currentPageId === pageId ? null : s.currentPageId,
    }));
  },

  renamePageLocally: (pageId, title) => {
    set((s) => ({
      rootPages: s.rootPages.map((p) => (p.id === pageId ? { ...p, title } : p)),
    }));
  },
}));

/** Convenience selector for components that only want the currentPageId. */
export function useCurrentPageId(): string | null {
  return useWorkspaceStore((s) => s.currentPageId);
}
