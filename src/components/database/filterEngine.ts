/**
 * Filter engine for database views (PRD §5.3.4).
 *
 * - Operators per property type.
 * - Recursive AND/OR evaluation of a FilterNode tree against a row.
 * - Helpers to flatten the tree into display chips and to build a default leaf.
 *
 * Evaluation is client-side: query_database returns all non-trashed rows and
 * this module narrows them by the persisted filter spec.
 */

import type {
  DatabaseRow,
  FilterGroup,
  FilterLeaf,
  FilterNode,
  PropertyDef,
  PropertyType,
  SelectOption,
} from '../../lib/types';

export interface OperatorDef {
  value: string;
  /** i18n key — resolved to display text by the caller via t(labelKey). */
  labelKey: string;
}

/** Operators available for a given property type (PRD §5.3.4 table). */

const TEXT_OPS: OperatorDef[] = [
  { value: 'contains', labelKey: 'database.opContains' },
  { value: 'does_not_contain', labelKey: 'database.opDoesNotContain' },
  { value: 'starts_with', labelKey: 'database.opStartsWith' },
  { value: 'ends_with', labelKey: 'database.opEndsWith' },
  { value: 'is_empty', labelKey: 'database.opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'database.opIsNotEmpty' },
];

const NUMBER_OPS: OperatorDef[] = [
  { value: 'equals', labelKey: 'database.opEquals' },
  { value: 'not_equals', labelKey: 'database.opNotEquals' },
  { value: 'greater', labelKey: 'database.opGreater' },
  { value: 'less', labelKey: 'database.opLess' },
  { value: 'greater_equal', labelKey: 'database.opGreaterEqual' },
  { value: 'less_equal', labelKey: 'database.opLessEqual' },
  { value: 'is_empty', labelKey: 'database.opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'database.opIsNotEmpty' },
];

const SELECT_OPS: OperatorDef[] = [
  { value: 'is', labelKey: 'database.opIs' },
  { value: 'is_not', labelKey: 'database.opIsNot' },
  { value: 'is_empty', labelKey: 'database.opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'database.opIsNotEmpty' },
];

const DATE_OPS: OperatorDef[] = [
  { value: 'is', labelKey: 'database.opIs' },
  { value: 'is_before', labelKey: 'database.opIsBefore' },
  { value: 'is_after', labelKey: 'database.opIsAfter' },
  { value: 'is_within', labelKey: 'database.opIsWithin' },
  { value: 'is_empty', labelKey: 'database.opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'database.opIsNotEmpty' },
];

const CHECKBOX_OPS: OperatorDef[] = [
  { value: 'is_checked', labelKey: 'database.opIsChecked' },
  { value: 'is_unchecked', labelKey: 'database.opIsUnchecked' },
];

const URL_OPS: OperatorDef[] = [
  { value: 'is', labelKey: 'database.opIs' },
  { value: 'is_not', labelKey: 'database.opIsNot' },
  { value: 'contains', labelKey: 'database.opContains' },
  { value: 'starts_with', labelKey: 'database.opStartsWith' },
  { value: 'ends_with', labelKey: 'database.opEndsWith' },
];

const EMPTY_OPS: OperatorDef[] = [
  { value: 'is_empty', labelKey: 'database.opIsEmpty' },
  { value: 'is_not_empty', labelKey: 'database.opIsNotEmpty' },
];

const OPERATORS_BY_TYPE: Record<PropertyType, OperatorDef[]> = {
  title: TEXT_OPS,
  rich_text: TEXT_OPS,
  number: NUMBER_OPS,
  select: SELECT_OPS,
  multi_select: SELECT_OPS,
  status: SELECT_OPS,
  date: DATE_OPS,
  person: SELECT_OPS,
  checkbox: CHECKBOX_OPS,
  url: URL_OPS,
  files: EMPTY_OPS,
};

export function operatorsFor(type: PropertyType): OperatorDef[] {
  return OPERATORS_BY_TYPE[type] ?? EMPTY_OPS;
}

/** Whether an operator needs a value input (vs. being self-contained like is_empty). */
export function operatorNeedsValue(operator: string): boolean {
  return !['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked'].includes(operator);
}

/** Build a fresh leaf with sensible defaults for the first operator of a type.
 * Accepts the full PropertyDef so option-based types (select/status) can
 * default to the first available option instead of an empty string that
 * silently matches nothing. */
export function makeLeaf(property: PropertyDef): FilterLeaf {
  const ops = operatorsFor(property.type);
  const op = ops[0]?.value ?? 'is_empty';
  return {
    kind: 'leaf',
    id: newId(),
    propertyId: property.id,
    operator: op,
    value: defaultValueFor(op, property.type, property.options),
  };
}

export function makeGroup(op: 'and' | 'or' = 'and'): FilterGroup {
  return { kind: 'group', op, children: [] };
}

/** Generate a stable unique ID for a filter leaf.
 * `crypto.randomUUID` is available in all Tauri webviews (Chromium ≥ 92,
 * WKWebView, WebKitGTK 2.42+). The fallback covers rare headless/test envs. */
function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}

/** Backfill missing `id` fields on leaves for filters persisted before the
 * `id` field was added. Returns the same node shape with IDs guaranteed.
 * Call this once when loading a filter from storage. */
export function normalizeFilter(node: FilterNode | null | undefined): FilterNode | null {
  if (!node) return null;
  const fix = (n: FilterNode): FilterNode => {
    if (n.kind === 'leaf') {
      return n.id ? n : { ...n, id: newId() };
    }
    const children = n.children.map(fix);
    return children === n.children ? n : { ...n, children };
  };
  return fix(node);
}

function defaultValueFor(
  operator: string,
  type: PropertyType,
  options?: SelectOption[],
): unknown {
  if (!operatorNeedsValue(operator)) return null;
  switch (type) {
    case 'number':
      return 0;
    case 'checkbox':
      return true;
    case 'multi_select':
      return [];
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'select':
    case 'status':
      // Default to the first defined option so the filter is immediately useful.
      return options?.[0]?.value ?? '';
    case 'person':
      // Person is MVP-simplified to a single "Me" option (see PersonCell).
      return 'Me';
    default:
      return '';
  }
}

// =============================================================================
// Evaluation
// =============================================================================

/** Return rows that satisfy the filter tree. A null filter passes everything. */
export function applyFilter(
  rows: DatabaseRow[],
  filter: FilterNode | null | undefined,
): DatabaseRow[] {
  if (!filter) return rows;
  return rows.filter((row) => evalNode(filter, row));
}

function evalNode(node: FilterNode, row: DatabaseRow): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) return true;
    return node.op === 'and'
      ? node.children.every((c) => evalNode(c, row))
      : node.children.some((c) => evalNode(c, row));
  }
  return evalLeaf(node, row);
}

function evalLeaf(leaf: FilterLeaf, row: DatabaseRow): boolean {
  const raw = row.properties[leaf.propertyId];
  const s = scalarString(raw);

  switch (leaf.operator) {
    case 'contains':
      return s.includes(String(leaf.value ?? ''));
    case 'does_not_contain':
      return !s.includes(String(leaf.value ?? ''));
    case 'starts_with':
      return s.startsWith(String(leaf.value ?? ''));
    case 'ends_with':
      return s.endsWith(String(leaf.value ?? ''));
    case 'is_empty':
      return isEmptyValue(raw);
    case 'is_not_empty':
      return !isEmptyValue(raw);
    case 'is':
      return valueEquals(raw, leaf.value);
    case 'is_not':
      return !valueEquals(raw, leaf.value);
    case 'equals':
      return Number(raw) === Number(leaf.value);
    case 'not_equals':
      return Number(raw) !== Number(leaf.value);
    case 'greater':
      return Number(raw) > Number(leaf.value);
    case 'less':
      return Number(raw) < Number(leaf.value);
    case 'greater_equal':
      return Number(raw) >= Number(leaf.value);
    case 'less_equal':
      return Number(raw) <= Number(leaf.value);
    case 'is_before':
      return compareDates(raw, leaf.value) < 0;
    case 'is_after':
      return compareDates(raw, leaf.value) > 0;
    case 'is_within':
      return compareDates(raw, leaf.value) === 0;
    case 'is_checked':
      return raw === true;
    case 'is_unchecked':
      return raw !== true;
    default:
      return true;
  }
}

function scalarString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(scalarString).join(' ');
  if (typeof v === 'object') {
    const obj = v as { name?: unknown };
    if (typeof obj.name === 'string') return obj.name;
  }
  return JSON.stringify(v);
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b) ? b.every((x) => a.includes(x)) : a.includes(b);
  if (Array.isArray(b)) return b.every((x) => valueEquals(a, x));
  return String(a ?? '') === String(b ?? '');
}

function compareDates(a: unknown, b: unknown): number {
  const da = toDate(a);
  const db = toDate(b);
  if (da == null || db == null) return 0;
  return da.getTime() - db.getTime();
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'string' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// =============================================================================
// Token rendering — flatten the tree into a structured token stream that
// preserves AND/OR connectors and group boundaries, so the FilterBar can show
// (A AND B) OR (C AND D) instead of an ambiguous flat chip list.
// =============================================================================

export type FilterToken =
  | {
      kind: 'chip';
      leaf: FilterLeaf;
      propertyName: string;
      /** i18n key for the operator — caller translates via t(operatorLabelKey). */
      operatorLabelKey: string;
      valueLabel: string;
    }
  | { kind: 'connector'; op: 'and' | 'or' }
  | { kind: 'group_open' }
  | { kind: 'group_close' };

/** Flatten the filter tree into an ordered token stream.
 *
 * Root group is never parenthesized. A non-root group with more than one child
 * is wrapped in `group_open` / `group_close` so the logical structure is
 * visible. Single-child and empty groups produce no delimiters — they are
 * transparent (a single-child group is logically equivalent to its child).
 *
 * Example:  OR( AND(A, B), C )
 * Tokens:   group_open · chip(A) · connector(AND) · chip(B) · group_close · connector(OR) · chip(C)
 * Renders:  (A AND B) OR C
 */
export function flattenTokens(
  filter: FilterNode | null | undefined,
  properties: PropertyDef[],
): FilterToken[] {
  if (!filter) return [];
  const byId = new Map(properties.map((p) => [p.id, p]));
  const out: FilterToken[] = [];
  walkTokens(filter, byId, out, 0);
  return out;
}

function walkTokens(
  node: FilterNode,
  properties: Map<string, PropertyDef>,
  out: FilterToken[],
  depth: number,
): void {
  if (node.kind === 'group') {
    if (node.children.length === 0) return;
    const wrap = depth > 0 && node.children.length > 1;
    if (wrap) out.push({ kind: 'group_open' });
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) out.push({ kind: 'connector', op: node.op });
      walkTokens(node.children[i], properties, out, depth + 1);
    }
    if (wrap) out.push({ kind: 'group_close' });
    return;
  }
  const prop = properties.get(node.propertyId);
  const ops = prop ? operatorsFor(prop.type) : [];
  const opLabelKey = ops.find((o) => o.value === node.operator)?.labelKey ?? node.operator;
  out.push({
    kind: 'chip',
    leaf: node,
    propertyName: prop?.name ?? node.propertyId,
    operatorLabelKey: opLabelKey,
    valueLabel: valueLabelFor(node),
  });
}

function valueLabelFor(leaf: FilterLeaf): string {
  if (!operatorNeedsValue(leaf.operator)) return '';
  const v = leaf.value;
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return (v as { name?: string }).name ?? '';
  return String(v);
}
