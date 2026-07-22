/**
 * Hello Counter — minimal Folio dashboard plugin example.
 *
 * Demonstrates:
 *   - Reading the host React via `globalThis.__FOLIO__.react` (the SDK does
 *     this internally — plugin authors using `@folio/plugin-sdk` don't need
 *     to touch globals directly; this single-file example does it for zero-
 *     build setup).
 *   - State (`useState`) + effects (`useEffect`) proxied from the host React.
 *   - Persisted state via `host.storage` (count survives app restarts + plugin
 *     reloads).
 *   - Config round-trip: the plugin reads `config.initialCount` (set via the
 *     inline edit when `isEditing`) and persists it with `onConfigChange`.
 *   - Subscribing to row count from `context.rows` (read-only dashboard data).
 *
 * This file MUST use ESM `export default` (native browser module syntax) —
 * the host loader is `await import(blobUrl)`. No bundler needed: drop this
 * file + manifest.json into a folder and copy into `<appData>/plugins/`.
 * The host's React is shared, so hooks work despite no
 * `import React from 'react'` in this file.
 */

// Pull React + hooks off the host-provided global. The SDK's react.ts proxy
// does exactly this for bundled plugins; this single-file example does it
// directly for zero-build setup.
const { useState, useEffect, createElement: h } = globalThis.__FOLIO__.react;

/** React component for the widget. */
function HelloCounter(props) {
  const { config, onConfigChange, host, context, isEditing } = props;
  const initialCount =
    config && typeof config.initialCount === 'number' ? config.initialCount : 0;
  const [count, setCount] = useState(initialCount);
  const [persisted, setPersisted] = useState(false);

  // Hydrate from host.storage on mount.
  useEffect(() => {
    let cancelled = false;
    host.storage
      .get('count')
      .then((saved) => {
        if (!cancelled && typeof saved === 'number') {
          setPersisted(true);
          setCount(saved);
        }
      })
      .catch((e) => console.error('[hello-counter] storage.get failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change (fire-and-forget).
  const bump = (delta) => {
    const next = count + delta;
    setCount(next);
    host.storage
      .set('count', next)
      .catch((e) => console.error('[hello-counter] storage.set failed:', e));
  };

  const rowsCount = context.rows.length;

  // Layout: top = row count, middle = big number, bottom = buttons.
  // When `isEditing` is true we expose an inline config edit (initialCount).
  return h(
    'div',
    { className: 'flex flex-col items-center justify-center h-full px-3 py-2 gap-1' },
    h('div', { className: 'text-[11px] text-text-tertiary' }, 'Rows in view: ' + rowsCount),
    h(
      'div',
      { className: 'text-3xl font-semibold text-text-primary tabular-nums leading-none' },
      String(count),
    ),
    h(
      'div',
      { className: 'flex items-center gap-1.5 mt-1' },
      h(
        'button',
        {
          type: 'button',
          onClick: () => bump(-1),
          className:
            'px-2 py-0.5 text-xs rounded border border-border-hairline hover:bg-bg-hover text-text-primary',
        },
        '−',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => bump(1),
          className:
            'px-2 py-0.5 text-xs rounded border border-border-hairline hover:bg-bg-hover text-text-primary',
        },
        '+',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setCount(initialCount);
            host.storage.delete('count').catch(() => {});
            setPersisted(false);
          },
          className:
            'px-2 py-0.5 text-xs rounded border border-border-hairline hover:bg-bg-hover text-text-tertiary',
          title: 'Reset',
        },
        '↺',
      ),
    ),
    isEditing &&
      h(
        'div',
        { className: 'mt-2 flex items-center gap-1 text-[11px] text-text-tertiary' },
        h('span', null, 'Initial:'),
        h('input', {
          type: 'number',
          value: initialCount,
          onChange: (e) => onConfigChange({ initialCount: Number(e.target.value) }),
          className: 'w-14 px-1 py-0.5 text-xs border border-border-hairline rounded bg-bg-page',
        }),
      ),
    persisted && h('div', { className: 'text-[10px] text-text-tertiary/70' }, '(persisted)'),
  );
}

// The default export merges with manifest.json (manifest wins on conflicts).
// Only `component` is required here — `id`, `name`, etc. come from the
// manifest sitting next to this file.
export default { component: HelloCounter };
