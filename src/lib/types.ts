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

/** Filter tree node. Recursive AND/OR with comparison leaves. */
export interface FilterLeaf {
  op: 'and' | 'or' | 'compare';
  propertyId?: string;
  operator?: string; // 'contains' | 'is' | 'is_before' | ...
  value?: unknown;
  children?: FilterLeaf[];
}

export interface SortEntry {
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface GroupConfig {
  propertyId: string;
  hiddenGroups?: string[];
}

export interface ViewConfig {
  id: string;
  databaseId: string;
  name: string;
  type: 'table' | 'board' | 'calendar' | 'timeline' | 'gallery' | 'list';
  filter?: FilterLeaf | null;
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
  filter?: FilterLeaf | null;
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
