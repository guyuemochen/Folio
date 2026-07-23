/**
 * Pie Chart — Folio dashboard plugin.
 *
 * Counts the rows in the current view by the value of one user-picked
 * property, then renders the distribution as a pie chart with a legend.
 *
 * Designed for `select` / `status` / `multi_select` columns (where each row
 * holds one or more discrete option values), but works for any property type
 * — values are stringified, and booleans render as ✓ / ✗ so checkbox
 * columns produce a tidy two-slice pie.
 *
 * Zero-build setup (same as hello-counter): reads React off the host global,
 * default-exports `{ component }`, sits next to a `manifest.json`. Drop the
 * folder into `<appData>/plugins/` to install.
 */

const { useMemo, createElement: h } = globalThis.__FOLIO__.react;

// ----------------------------------------------------------------------------
// Palette — assigned to slices in declaration order. Loops if there are more
// distinct values than colours. Picked to read well on both light + dark
// themes (mid-saturation, WCAG-AA against white).
// ----------------------------------------------------------------------------
const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#64748b', // slate
];

const EMPTY_LABEL = '(empty)';

/**
 * Tally rows by the value of one property.
 *
 * @param rows       DatabaseRow[] — the view's current row set.
 * @param property   PropertyDef — the column to group by, or null.
 * @returns an ordered array of `{ label, count, color }` slices. Order
 *          follows the property's declared `options` when present (so the
 *          chart matches the schema author's intent); otherwise sorts by
 *          count descending. Stray values not in `options` are appended.
 */
function computeSlices(rows, property) {
  if (!property) return [];
  const counts = new Map();
  const bump = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const row of rows) {
    const v = row?.properties?.[property.id];
    if (Array.isArray(v)) {
      // multi_select — each entry counts once; empty array → empty bucket
      if (v.length === 0) bump(EMPTY_LABEL);
      else for (const item of v) bump(String(item));
    } else if (v === true) {
      bump('✓');
    } else if (v === false) {
      bump('✗');
    } else if (v === null || v === undefined || v === '') {
      bump(EMPTY_LABEL);
    } else {
      bump(String(v));
    }
  }

  // Order: declared options first (select / status / multi_select), then any
  // stray values; everything else sorts by count desc.
  const opts = property.options;
  let labels;
  if (Array.isArray(opts) && opts.length > 0) {
    labels = opts.map((o) => String(o.value));
    for (const k of counts.keys()) {
      if (!labels.includes(k)) labels.push(k);
    }
  } else {
    labels = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  }

  return labels
    .filter((label) => counts.has(label))
    .map((label, i) => ({
      label,
      count: counts.get(label),
      color: PALETTE[i % PALETTE.length],
    }));
}

/**
 * Build an SVG path string for a pie wedge from `startAngle` to `endAngle`
 * (radians, 0 = 3 o'clock, increasing clockwise because SVG y grows down).
 *
 * A wedge spanning the full circle (a single slice = 100%) is rendered as a
 * near-full arc — a single SVG <arc> command can't represent exactly 360°.
 */
function arcPath(cx, cy, r, startAngle, endAngle) {
  if (endAngle - startAngle >= Math.PI * 2 - 1e-6) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/** Render the pie as an SVG. Caller picks the layout box; the svg scales to
 *  fit via viewBox + max-w/max-h so it shrinks on small cells. */
function Pie({ slices, total }) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  let angle = -Math.PI / 2; // start at 12 o'clock

  const wedges = slices.map((s) => {
    const sweep = (s.count / total) * Math.PI * 2;
    const path = arcPath(cx, cy, r, angle, angle + sweep);
    angle += sweep;
    return { ...s, path };
  });

  return h(
    'svg',
    {
      viewBox: `0 0 ${size} ${size}`,
      className: 'w-full h-full max-w-[160px] max-h-[160px]',
      role: 'img',
    },
    wedges.map((w, i) =>
      h('path', {
        key: i,
        d: w.path,
        fill: w.color,
        stroke: 'white',
        strokeWidth: 1.5,
      }),
    ),
  );
}

/** The widget component exported to Folio.
 *
 *  Two visual states, both driven by `config.propertyId` (no internal state,
 *  no reliance on `props.isEditing` — which the host currently hardcodes to
 *  false):
 *    - No column picked  → show a column picker (onboarding)
 *    - Column picked     → show the pie + legend, with a small "Change"
 *                          link that clears the pick and returns to the picker
 */
function PieChartWidget(props) {
  const { config, onConfigChange, context } = props;
  const propertyId =
    config && typeof config.propertyId === 'string' ? config.propertyId : '';
  const properties = (context.properties ?? []).filter((p) => p.type !== 'title');
  const property = properties.find((p) => p.id === propertyId) ?? null;
  const rows = context.rows ?? [];

  const slices = useMemo(() => computeSlices(rows, property), [rows, property]);
  const total = slices.reduce((s, x) => s + x.count, 0);

  // ----- State 1: no column picked → show the picker. ---------------------
  if (!property) {
    return h(
      'div',
      { className: 'flex flex-col h-full px-3 py-3 gap-2' },
      h(
        'label',
        { className: 'text-xs text-text-tertiary', htmlFor: 'pie-column' },
        'Group rows by:',
      ),
      h(
        'select',
        {
          id: 'pie-column',
          value: propertyId,
          onChange: (e) =>
            onConfigChange({ propertyId: e.target.value || undefined }),
          className:
            'w-full px-2 py-1.5 text-sm border border-border-hairline rounded bg-bg-page text-text-primary',
        },
        h('option', { value: '' }, '— select a column —'),
        properties.map((p) =>
          h('option', { key: p.id, value: p.id }, p.name + ' · ' + p.type),
        ),
      ),
      properties.length === 0
        ? h(
            'p',
            { className: 'text-[11px] text-text-tertiary italic' },
            'This database has no chartable properties yet.',
          )
        : h(
            'p',
            { className: 'text-[11px] text-text-tertiary/70' },
            'Counts how many rows hold each value of the chosen column.',
          ),
    );
  }

  // ----- State 2: column picked → chart + legend + re-pick footer. -------
  return h(
    'div',
    { className: 'flex flex-col h-full px-3 py-2 gap-2' },
    total > 0
      ? h(
          'div',
          { className: 'flex-1 min-h-0 flex items-center gap-3' },
          h(Pie, { slices, total }),
          h(
            'div',
            {
              className:
                'flex-1 min-w-0 flex flex-col gap-1 overflow-y-auto max-h-full',
            },
            slices.map((s, i) =>
              h(
                'div',
                { key: i, className: 'flex items-center gap-1.5 text-xs' },
                h('span', {
                  className: 'w-2.5 h-2.5 rounded-sm shrink-0',
                  style: { backgroundColor: s.color },
                }),
                h(
                  'span',
                  { className: 'flex-1 truncate text-text-primary' },
                  s.label,
                ),
                h(
                  'span',
                  { className: 'text-text-tertiary tabular-nums' },
                  String(s.count),
                ),
                h(
                  'span',
                  {
                    className:
                      'text-text-tertiary/70 tabular-nums text-[10px] w-9 text-right',
                  },
                  Math.round((s.count / total) * 100) + '%',
                ),
              ),
            ),
          ),
        )
      : h(
          'div',
          {
            className:
              'flex-1 flex items-center justify-center text-xs text-text-tertiary italic text-center px-2',
          },
          'No rows to chart for "' + property.name + '"',
        ),

    // Footer: which column we're grouped by + a link to re-pick.
    h(
      'div',
      {
        className:
          'flex items-center gap-2 text-[11px] border-t border-border-hairline pt-1.5',
      },
      h(
        'span',
        { className: 'text-text-tertiary truncate flex-1' },
        'By: ' + property.name,
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => onConfigChange({ propertyId: undefined }),
          className:
            'text-accent hover:underline shrink-0',
          title: 'Pick a different column',
        },
        'Change',
      ),
    ),
  );
}

export default { component: PieChartWidget };
