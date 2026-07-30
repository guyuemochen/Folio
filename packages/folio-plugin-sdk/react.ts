/**
 * React bridge — re-exports React + hooks from the host-provided global.
 *
 * The host (Folio) exposes its single React instance via `globalThis.__FOLIO__`
 * at app boot, before any plugin is dynamically imported. Plugins MUST NOT
 * bundle their own React (would cause "Invalid hook call" / context
 * desync). Instead, plugins either:
 *
 *   (a) `import { useState, useEffect } from '@folio/plugin-sdk/react'`
 *       (recommended — these re-exports read from the global), or
 *   (b) Configure their bundler to mark `react`/`react-dom` as external and
 *       alias them to the same global (advanced — see README).
 *
 * Type definitions come from `react@19` peer-dep so authors get full typings
 * without bundling the implementation.
 */

/** Shape of the host-provided global. Hosts MUST populate this before any
 *  plugin dynamic-import resolves. */
export interface FolioGlobal {
  react: typeof import('react');
  /** Optional: useful for plugins that need to render into a portal root. */
  reactDOM?: typeof import('react-dom');
}

declare global {
  // eslint-disable-next-line no-var
  var __FOLIO__: FolioGlobal | undefined;
}

/** Read the host React instance, with a friendly error if the host forgot
 *  to set the global before importing the plugin. */
function getReact(): typeof import('react') {
  const g = (globalThis as { __FOLIO__?: FolioGlobal }).__FOLIO__;
  if (!g?.react) {
    throw new Error(
      '@folio/plugin-sdk: globalThis.__FOLIO__.react is not set. ' +
        'The Folio host must assign it before importing plugins. ' +
        'If you are importing this module outside Folio (e.g. in a test), ' +
        'set window.__FOLIO__ = { react: require("react") } first.',
    );
  }
  return g.react;
}

/** Proxied access to React. Each property read fetches the live global, so
 *  hot-reloading the host (which reassigns the global) is picked up. */
export const React = new Proxy(
  {},
  {
    get(_t, prop: string) {
      return Reflect.get(getReact() as object, prop);
    },
  },
) as typeof import('react');

// Re-export the most commonly used React APIs. Each reads through the proxy
// above so the live host React instance is always used.
export const {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  useContext,
  useDebugValue,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  use,
  createContext,
  createElement,
  cloneElement,
  isValidElement,
  Children,
  Fragment,
  Suspense,
  memo,
  forwardRef,
  lazy,
  startTransition,
  Component,
  PureComponent,
  StrictMode,
} = React;
