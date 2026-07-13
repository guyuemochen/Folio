/**
 * Shared types — mirror Rust structs in src-tauri/src/lib.rs.
 *
 * Keep these in sync with the Rust side. Naming is camelCase here,
 * matching `#[serde(rename_all = "camelCase")]` on the Rust structs.
 */

export interface Workspace {
  id: string;
  name: string;
}

export interface PageSummary {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  parentType: 'workspace' | 'page' | 'database';
  isTrashed: boolean;
  updatedAt: number;
  favorite: boolean;
}

export interface Page {
  id: string;
  workspaceId: string;
  parentId: string | null;
  parentType: 'workspace' | 'page' | 'database';
  type: 'page' | 'database';
  title: string;
  icon: string | null;
  cover: string | null;
  fullWidth: boolean;
  smallText: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  trashedAt: number | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PageWithDoc extends Page {
  /** TipTap/ProseMirror document JSON string. Parse before use. */
  doc: string;
}

export interface CreatePageInput {
  parentId?: string | null;
  parentType?: 'workspace' | 'page' | 'database';
  title?: string;
  icon?: string;
}

export interface UpdatePageMetaInput {
  title?: string;
  /** null to clear the icon. */
  icon?: string | null;
  /** null to clear the cover. */
  cover?: string | null;
}

/**
 * Minimal TipTap doc shape we care about. TipTap's own JSON type lives in
 * @tiptap/core; here we just need a permissive shape for storage round-trip.
 */
export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ============================================================================
// Database (M3) — mirrors src-tauri/src/database.rs
// ============================================================================

export type PropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'
  | 'files';

export interface SelectOption {
  value: string;
  /** One of the 9 Notion semantic colors: gray/brown/orange/yellow/green/blue/purple/pink/red. */
  color: string;
}

export interface PropertyDef {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  numberFormat?: 'integer' | 'decimal' | 'percent' | 'currency' | null;
  isRequired: boolean;
  order: number;
  createdAt: number;
}

/**
 * Filter tree. Recursive AND/OR groups with comparison leaves.
 * Discriminated union on `kind` so consumers can narrow without casts.
 *
 * Persistence: serialized to JSON into `database_view.filter`.
 * Evaluation: client-side (see applyFilter in DatabaseView).
 */
export interface FilterLeaf {
  kind: 'leaf';
  propertyId: string;
  /** e.g. 'contains' | 'is' | 'is_before'. Varies by property type. */
  operator: string;
  /** Comparison target; shape depends on property + operator. */
  value: unknown;
}

export interface FilterGroup {
  kind: 'group';
  op: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = FilterGroup | FilterLeaf;

export interface SortEntry {
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface GroupConfig {
  propertyId: string;
  /** Group values that are collapsed in the UI (persisted per view). */
  collapsedGroups?: string[];
}

export interface ViewConfig {
  id: string;
  databaseId: string;
  name: string;
  type: 'table' | 'board' | 'calendar' | 'timeline' | 'gallery' | 'list';
  filter?: FilterNode | null;
  sort?: SortEntry[] | null;
  group?: GroupConfig | null;
  hiddenProperties?: string[] | null;
  columnWidths?: Record<string, number> | null;
  isDefault: boolean;
  createdAt: number;
}

export interface DatabaseWithSchema extends Page {
  properties: PropertyDef[];
  views: ViewConfig[];
  defaultViewId: string | null;
}

/** Row = page summary + map of propertyId -> raw JSON value. */
export interface DatabaseRow {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  parentType: string;
  isTrashed: boolean;
  updatedAt: number;
  properties: Record<string, unknown>;
}

// ============================================================================
// Database templates (§5.3.7)
// ============================================================================

export interface DatabaseTemplate {
  id: string;
  databaseId: string;
  name: string;
  icon: string | null;
  /** Map of propertyId -> default value applied on new-row creation. */
  defaultPropertyValues: Record<string, unknown>;
  /** TipTap/ProseMirror doc JSON string used to seed the row page's content. */
  defaultContent: string;
  isDefault: boolean;
  createdAt: number;
}

export interface CreateTemplateInput {
  databaseId: string;
  name: string;
  icon?: string;
  defaultPropertyValues?: Record<string, unknown>;
  defaultContent?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  icon?: string | null;
  defaultPropertyValues?: Record<string, unknown>;
  defaultContent?: string;
  isDefault?: boolean;
}

// ============================================================================
// File attachments (files property type)
// ============================================================================

export interface AttachmentInfo {
  /** Original file name shown in the chip. */
  name: string;
  /** Path relative to app data dir (for Rust-side resolution). */
  path: string;
  size: number;
}

// === Input types for create/update calls ==================================

export interface CreateDatabaseInput {
  parentId?: string | null;
  parentType?: 'workspace' | 'page';
  name?: string;
}

export interface AddPropertyInput {
  databaseId: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  numberFormat?: string;
}

export interface UpdatePropertyInput {
  name?: string;
  options?: SelectOption[];
  numberFormat?: string;
}

export interface UpdateCellInput {
  pageId: string;
  propertyId: string;
  value: unknown;
}

export interface CreateViewInput {
  databaseId: string;
  name: string;
  type?: 'table' | 'board' | 'calendar' | 'timeline' | 'gallery' | 'list';
}

export interface UpdateViewInput {
  name?: string;
  filter?: FilterNode | null;
  sort?: SortEntry[] | null;
  group?: GroupConfig | null;
  hiddenProperties?: string[] | null;
  columnWidths?: Record<string, number> | null;
}

// ============================================================================
// Search (M4)
// ============================================================================

export interface SearchHit {
  pageId: string;
  title: string;
  icon: string | null;
  parentType: 'workspace' | 'page' | 'database';
  /** Snippet with `<mark>` highlighting around matches; may contain JSON noise. */
  snippet: string;
  rank: number;
  matchedIn: 'title' | 'content';
}

// ============================================================================
// Trash / Favorites / Snapshots (M3 PRD §5.2.4)
// ============================================================================

/** A trashed page plus breadcrumb info for the Trash view (PRD §5.2.4). */
export interface TrashedPage {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  parentType: 'workspace' | 'page' | 'database';
  /** Title of the parent page (null when restored to workspace root). */
  parentTitle: string | null;
  trashedAt: number | null;
}

// ============================================================================
// Linked database block (§5.3.8)
// ============================================================================

/**
 * Subset of {@link ViewConfig} that a linked-database block carries inline
 * (inside the page document) instead of referencing a row in
 * `database_view`. Keeping the config in the document lets every
 * linked-database block have its own independent filter / sort / group /
 * hidden columns / column widths without polluting the source database's
 * saved views.
 */
export interface LocalViewConfig {
  filter?: FilterNode | null;
  sort?: SortEntry[] | null;
  group?: GroupConfig | null;
  hiddenProperties?: string[] | null;
  columnWidths?: Record<string, number> | null;
}

/**
 * Attributes persisted on a `linkedDatabase` TipTap node (PRD §5.3.8).
 *
 * The block renders a DatabaseView inline that mirrors a source database.
 * `sourceDatabaseId` points at the row in `page` of `type='database'`.
 * `viewConfig` is the *local* view configuration stored in the document —
 * it is independent of any saved view on the source database, so each
 * linked-database block can filter/sort/group differently while still
 * reading the same underlying rows via `query_database`.
 *
 * `sourceViewId` is optional metadata: when the user picks a starting
 * view from the source db's view list, we copy that view's config into
 * `viewConfig` and record its id here so the header can show which view
 * the link was based on. It is never read back to look up state.
 */
export interface LinkedDatabaseAttrs {
  sourceDatabaseId: string;
  viewConfig: LocalViewConfig;
  /** Optional: id of the source-db view this link was originally based on. */
  sourceViewId?: string | null;
}

/** Window event payload for inserting a block via loose coupling with the editor. */
export interface InsertBlockEventDetail {
  type: 'linkedDatabase';
  attrs: LinkedDatabaseAttrs;
}

/** Snapshot source: 'auto' = debounced save, 'manual' = user action. */
export type SnapshotSource = 'auto' | 'manual';

/** One snapshot row for the page History UI (PRD §5.2.4). */
export interface PageSnapshot {
  id: string;
  pageId: string;
  /** Full TipTap doc JSON string at the snapshot point. */
  content: string;
  title: string;
  source: SnapshotSource;
  createdAt: number;
}

// =============================================================================
// M5: Import / Export (PRD §5.5)
// =============================================================================

/** Export format sent to the `export_page` Tauri command. */
export type ExportFormat = 'markdown' | 'html';

/** Summary returned by Notion zip import. */
export interface ImportResult {
  pagesCreated: number;
  warnings: string[];
  errors: string[];
}
