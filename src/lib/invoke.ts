import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type {
  AddPropertyInput,
  AttachmentInfo,
  CreateDatabaseInput,
  CreatePageInput,
  CreateTemplateInput,
  CreateViewInput,
  DatabaseRow,
  DatabaseTemplate,
  DatabaseWithSchema,
  ExportFormat,
  ImportResult,
  Page,
  PageSnapshot,
  PageSummary,
  PageWithDoc,
  PropertyDef,
  SearchHit,
  SnapshotSource,
  TrashedPage,
  UpdateCellInput,
  UpdatePageMetaInput,
  UpdatePropertyInput,
  UpdateTemplateInput,
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

  // --- Database — M4 extras (templates, duplicate, csv, files) -------------
  duplicateProperty: (propertyId: string): Promise<PropertyDef> =>
    invoke('duplicate_property_cmd', { propertyId }),

  duplicateDatabaseRow: (rowId: string): Promise<DatabaseRow> =>
    invoke('duplicate_database_row', { rowId }),

  exportDatabaseCsv: (databaseId: string): Promise<string> =>
    invoke('export_database_csv', { databaseId }),

  addDatabaseRowFromTemplate: (databaseId: string, templateId: string): Promise<DatabaseRow> =>
    invoke('add_database_row_from_template_cmd', { databaseId, templateId }),

  listTemplates: (databaseId: string): Promise<DatabaseTemplate[]> =>
    invoke('list_templates', { databaseId }),

  createTemplate: (input: CreateTemplateInput): Promise<DatabaseTemplate> =>
    invoke('create_template', { input }),

  updateTemplate: (templateId: string, input: UpdateTemplateInput): Promise<DatabaseTemplate> =>
    invoke('update_template_cmd', { templateId, input }),

  deleteTemplate: (templateId: string): Promise<void> =>
    invoke('delete_template_cmd', { templateId }),

  attachFile: (
    srcPath: string,
    databaseId: string,
    pageId: string,
    propertyId: string,
  ): Promise<AttachmentInfo> =>
    invoke('attach_file', {
      srcPath,
      databaseId,
      pageId,
      propertyId,
    }),

  // --- Search (M4) -------------------------------------------------------
  search: (query: string, limit?: number): Promise<SearchHit[]> =>
    invoke('search', { query, limit: limit ?? 50 }),

  // --- Trash / Favorites / Snapshots (M3 §5.2.4) -------------------------
  listTrashedPages: (): Promise<TrashedPage[]> => invoke('list_trashed_pages'),

  purgeOldTrash: (): Promise<number> => invoke('purge_old_trash'),

  emptyTrash: (): Promise<number> => invoke('empty_trash'),

  setFavorite: (pageId: string, isFavorite: boolean): Promise<void> =>
    invoke('set_favorite', { pageId, isFavorite }),

  listFavorites: (): Promise<PageSummary[]> => invoke('list_favorites'),

  reorderFavorites: (orderedPageIds: string[]): Promise<void> =>
    invoke('reorder_favorites', { orderedPageIds }),

  createSnapshot: (
    pageId: string,
    content: string,
    title: string,
    source?: SnapshotSource,
  ): Promise<PageSnapshot> =>
    invoke('create_snapshot_cmd', { pageId, content, title, source: source ?? 'auto' }),

  listSnapshots: (pageId: string): Promise<PageSnapshot[]> =>
    invoke('list_snapshots', { pageId }),

  restoreSnapshot: (snapshotId: string): Promise<void> =>
    invoke('restore_snapshot', { snapshotId }),

  // --- Export (M5 §5.5.2) ------------------------------------------------
  exportPage: (pageId: string, format: ExportFormat): Promise<string> =>
    invoke('export_page', { pageId, format }),

  // --- Import (M5 §5.5.1) ------------------------------------------------
  importMarkdown: (mdPath: string, parentId?: string): Promise<Page> =>
    invoke('import_markdown', { mdPath, parentId }),

  importHtml: (htmlPath: string, parentId?: string): Promise<Page> =>
    invoke('import_html', { htmlPath, parentId }),

  importCsv: (csvPath: string, parentId?: string): Promise<Page> =>
    invoke('import_csv', { csvPath, parentId }),

  importNotionZip: (zipPath: string, parentId?: string): Promise<ImportResult> =>
    invoke('import_notion_zip', { zipPath, parentId }),

  // --- Workspace export + backup (M5 §5.5.2) ----------------------------
  exportWorkspace: (format: ExportFormat): Promise<string> =>
    invoke('export_workspace', { format }),

  createBackup: (): Promise<string> =>
    invoke('create_backup'),

  restoreBackup: (backupPath: string): Promise<boolean> =>
    invoke('restore_backup', { backupPath }),

  // --- File saving (M5 export → user-chosen path) -----------------------
  saveTextFile: (path: string, content: string): Promise<void> =>
    invoke('save_text_file', { path, content }),

  saveBinaryFile: (path: string, contentB64: string): Promise<void> =>
    invoke('save_binary_file', { path, contentB64 }),
} as const;

// Re-export dialog helpers for convenience.
export { open, save };
