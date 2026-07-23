/**
 * JSX runtime bridge — lets plugins use the modern automatic JSX runtime
 * (`jsxImportSource`) without bundling their own React.
 *
 * Plugin authors configure their bundler:
 *
 *     // vite.config.js
 *     export default {
 *       esbuild: { jsx: 'automatic', jsxImportSource: '@folio/plugin-sdk' }
 *     }
 *
 * Then any `.jsx`/`.tsx` file compiles `import { jsx } from '@folio/plugin-sdk/jsx-runtime'`,
 * which this module provides — proxying through to the host React.
 *
 * (The implementation re-uses the proxy from `./react.ts` rather than
 * re-fetching the global, so there's a single source for the React lookup.)
 */
import { React, Fragment } from './react';
import type { JSX as ReactJSX } from 'react';

/** JSX element factory. Reads the live host React. */
export function jsx(
  type: React.ElementType,
  props: Record<string, unknown> | null,
  key?: React.Key,
): ReactJSX.Element {
  // `React.createElement(type, props, ...children)` is the canonical path;
  // React 19's automatic runtime dispatches through createElement too.
  // We unwrap `key` from props (esbuild/swc put it as the 3rd arg).
  return React.createElement(type, { ...props, key }) as ReactJSX.Element;
}

/** Same as `jsx` but for elements with static children (esbuild uses this
 *  for `<parent>{[c1, c2]}</parent>` shapes). */
export function jsxs(
  type: React.ElementType,
  props: Record<string, unknown> | null,
  key?: React.Key,
): ReactJSX.Element {
  return jsx(type, props, key);
}

// React 19 introduced `jsx(…, …, key)` with `key` as 3rd arg; older bundlers
// emit `jsx(type, config, key, isStaticChildren)`. We accept the union shape.
export { Fragment };

// Default export for bundlers that expect `import jsxRuntime from '...'`.
export default { jsx, jsxs, Fragment };
