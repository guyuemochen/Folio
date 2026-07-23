/**
 * @folio/plugin-sdk — entry point.
 *
 * Plugin authors do:
 *
 *     import { definePlugin, useState } from '@folio/plugin-sdk';
 *
 * Bundler config (Vite example):
 *
 *     export default {
 *       esbuild: { jsx: 'automatic', jsxImportSource: '@folio/plugin-sdk' },
 *       build: { rollupOptions: { external: ['react', 'react-dom'] } }
 *     }
 *
 * The SDK is tiny (~2 KB) and gets bundled INTO the plugin. It does not
 * bundle React — it proxies through `globalThis.__FOLIO__.react`, which
 * the Folio host sets before any plugin loads. This guarantees a single
 * React instance shared between host and plugin (no "Invalid hook call").
 */

// Types — the contract every plugin must satisfy.
export * from './types';
// definePlugin — the only runtime helper.
export { definePlugin } from './define';
