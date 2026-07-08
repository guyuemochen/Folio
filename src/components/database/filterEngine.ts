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
} from '../../lib/types';

export interface OperatorDef {
  value: string;
  label: string;
}

/** Operators available for a given property type (PRD §5.3.4 table). */

const TEXT_OPS: OperatorDef[] = [
  { value: 'contains', label: 'contains' },
  { value: 'does_not_contain', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const NUMBER_OPS: OperatorDef[] = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '≠' },
  { value: 'greater', label: '>' },
  { value: 'less', label: '<' },
  { value: 'greater_equal', label: '≥' },
  { value: 'less_equal', label: '≤' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const SELECT_OPS: OperatorDef[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const DATE_OPS: OperatorDef[] = [
  { value: 'is', label: 'is' },
  { value: 'is_before', label: 'is before' },
  { value: 'is_after', label: 'is after' },
  { value: 'is_within', label: 'is within' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const CHECKBOX_OPS: OperatorDef[] = [
  { value: 'is_checked', label: 'is checked' },
  { value: 'is_unchecked', label: 'is unchecked' },
];

const URL_OPS: OperatorDef[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
];

const EMPTY_OPS: OperatorDef[] = [
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
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

/** Build a fresh leaf with sensible defaults for the first operator of a type. */
export function makeLeaf(propertyId: string, type: PropertyType): FilterLeaf {
  const ops = operatorsFor(type);
  const op = ops[0]?.value ?? 'is_empty';
  return { kind: 'leaf', propertyId, operator: op, value: defaultValueFor(op, type) };
}

export function makeGroup(op: 'and' | 'or' = 'and'): FilterGroup {
  return { kind: 'group', op, children: [] };
}

function defaultValueFor(operator: string, type: PropertyType): unknown {
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
// Chip rendering (flatten leaves into "property operator value" strings)
// =============================================================================

export interface FilterChip {
  leaf: FilterLeaf;
  propertyName: string;
  operatorLabel: string;
  valueLabel: string;
}

export function flattenChips(
  filter: FilterNode | null | undefined,
  properties: PropertyDef[],
): FilterChip[] {
  if (!filter) return [];
  const byId = new Map(properties.map((p) => [p.id, p]));
  const out: FilterChip[] = [];
  walk(filter, byId, out);
  return out;
}

function walk(
  node: FilterNode,
  properties: Map<string, PropertyDef>,
  out: FilterChip[],
): void {
  if (node.kind === 'group') {
    for (const c of node.children) walk(c, properties, out);
    return;
  }
  const prop = properties.get(node.propertyId);
  const ops = prop ? operatorsFor(prop.type) : [];
  const opLabel = ops.find((o) => o.value === node.operator)?.label ?? node.operator;
  out.push({
    leaf: node,
    propertyName: prop?.name ?? node.propertyId,
    operatorLabel: opLabel,
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
