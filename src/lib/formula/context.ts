/**
 * Builds a {@link PropResolver} for the formula evaluator from a database
 * schema + a single row's cell values. Property *names* are the keys (the
 * `database_property` table enforces UNIQUE(database_id, name), so names are
 * unique within a database).
 *
 * Reference values are coerced to evaluator-friendly scalars:
 *   - number / boolean / string → as-is
 *   - checkbox boolean → boolean
 *   - multi_select array → comma-joined string
 *   - object (e.g. file attachment) → its `name`
 *   - missing / null → null
 *
 * Formula columns referencing *other* formula columns resolve to null —
 * chains are intentionally not supported (avoids cycles; documented MVP
 * constraint). Formulas should only reference concrete stored properties.
 */
import type { DatabaseRow, PropertyDef } from '../types';
import type { FormulaValue, PropResolver } from './evaluator';

/** Coerce a raw stored cell value into an evaluator scalar. */
function coerce(prop: PropertyDef, raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null;
  switch (prop.type) {
    case 'number':
    case 'checkbox':
      return raw as FormulaValue;
    case 'multi_select': {
      if (Array.isArray(raw)) return (raw as unknown[]).map(String).join(', ');
      return typeof raw === 'string' ? raw : null;
    }
    case 'files': {
      if (raw && typeof raw === 'object') {
        const r = raw as { name?: unknown };
        return typeof r.name === 'string' ? r.name : null;
      }
      return null;
    }
    default:
      // title / rich_text / select / status / date / person / url → string
      if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
      return typeof raw === 'string' ? raw : null;
  }
}

/** Build a name → value resolver for one row. */
export function buildRowResolver(
  properties: PropertyDef[],
  row: DatabaseRow,
): PropResolver {
  // Name → def (last write wins; names are unique so this is unambiguous).
  const byName = new Map<string, PropertyDef>();
  for (const p of properties) byName.set(p.name, p);
  return (name: string): FormulaValue => {
    const prop = byName.get(name);
    if (!prop) return null; // unknown column → null (soft miss)
    if (prop.type === 'formula') return null; // no chained formulas
    return coerce(prop, row.properties[prop.id]);
  };
}
