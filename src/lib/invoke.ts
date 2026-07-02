import { invoke } from '@tauri-apps/api/core';
import type {
  AddPropertyInput,
  CreateDatabaseInput,
  CreatePageInput,
  CreateViewInput,
  DatabaseRow,
  DatabaseWithSchema,
  Page,
  PageSummary,
  PageWithDoc,
  PropertyDef,
  SearchHit,
  UpdateCellInput,
  UpdatePageMetaInput,
  UpdatePropertyInput,
  UpdateViewInput,
  ViewConfig,
  Workspace,
} from './types';

// ============================================================================
// All backend invoke wrappers live here so call sites get one consistent
// surface and TypeScript guarantees parameter shapes.
// ============================================================================

export const api = {
  // --- Workspace ----------------------------------------------------------
  getWorkspace: (): Promise<Workspace> => invoke('get_workspace'),

  // --- Page CRUD ----------------------------------------------------------
  listPages: (parentId: string | null = null): Promise<PageSummary[]> =>
    invoke('list_pages', { parentId }),

  createPage: (input: CreatePageInput): Promise<Page> =>
    invoke('create_page', { input }),

  getPage: (pageId: string): Promise<PageWithDoc> =>
    invoke('get_page', { pageId }),

  renamePage: (pageId: string, title: string): Promise<Page> =>
    invoke('rename_page', { pageId, title }),

  updatePageMeta: (pageId: string, input: UpdatePageMetaInput): Promise<Page> =>
    invoke('update_page_meta_cmd', { pageId, input }),

  updatePageDoc: (pageId: string, doc: string): Promise<void> =>
    invoke('update_page_doc', { pageId, doc }),

  trashPage: (pageId: string): Promise<void> => invoke('trash_page', { pageId }),

  restorePage: (pageId: string): Promise<void> => invoke('restore_page', { pageId }),

  deletePagePermanently: (pageId: string): Promise<void> =>
    invoke('delete_page_permanently', { pageId }),

  // --- Database (M3) ------------------------------------------------------
  createDatabase: (input: CreateDatabaseInput): Promise<DatabaseWithSchema> =>
    invoke('create_database', { input }),

  getDatabase: (databaseId: string): Promise<DatabaseWithSchema> =>
    invoke('get_database', { databaseId }),

  addProperty: (input: AddPropertyInput): Promise<PropertyDef> =>
    invoke('add_property', { input }),

  updateProperty: (propertyId: string, input: UpdatePropertyInput): Promise<PropertyDef> =>
    invoke('update_property_cmd', { propertyId, input }),

  deleteProperty: (propertyId: string): Promise<void> =>
    invoke('delete_property_cmd', { propertyId }),

  addDatabaseRow: (databaseId: string): Promise<DatabaseRow> =>
    invoke('add_database_row', { databaseId }),

  updateCell: (input: UpdateCellInput): Promise<void> =>
    invoke('update_cell_cmd', { input }),

  deleteDatabaseRow: (pageId: string): Promise<void> =>
    invoke('delete_database_row_cmd', { pageId }),

  queryDatabase: (databaseId: string): Promise<DatabaseRow[]> =>
    invoke('query_database', { databaseId }),

  listViews: (databaseId: string): Promise<ViewConfig[]> =>
    invoke('list_views', { databaseId }),

  createView: (input: CreateViewInput): Promise<ViewConfig> =>
    invoke('create_view', { input }),

  updateView: (viewId: string, input: UpdateViewInput): Promise<ViewConfig> =>
    invoke('update_view_cmd', { viewId, input }),

  deleteView: (viewId: string): Promise<void> => invoke('delete_view_cmd', { viewId }),

  // --- Search (M4) -------------------------------------------------------
  search: (query: string, limit?: number): Promise<SearchHit[]> =>
    invoke('search', { query, limit: limit ?? 50 }),
} as const;
