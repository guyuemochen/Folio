import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vite serves raw ESM to the browser/webview; it does NOT provide a
  // `process` global. react-draggable (used by react-grid-layout) reads
  // `process.env.DRAGGABLE_DEBUG` at the top of its `log()` helper, and
  // `log()` is called on every `handleDragStart`. Without this define the
  // read throws `ReferenceError: process is not defined` inside the
  // mousedown handler — which silently aborts the drag before it ever
  // starts. Replace the access at build time so the runtime never touches
  // `process`.
  define: {
    'process.env.DRAGGABLE_DEBUG': JSON.stringify(false),
  },
  // Tauri expects a fixed port; if not available, fail fast
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // Don't trigger reloads when Rust rebuilds
      ignored: ['**/src-tauri/**'],
    },
  },
  // Env vars starting with VITE_ or TAURI_ENV_ are exposed to the frontend
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022',
    // Produce sourcemaps in debug builds for better stack traces.
    // Vite 8 deprecated `transformWithEsbuild`; the default minifier (Oxc)
    // takes over when `minify` is left unspecified.
    minify: !process.env.TAURI_ENV_DEBUG ? true : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // M6 perf: split vendor code so the cold-start bundle only carries what
    // the editor shell actually needs at T0. Lazy-loaded routes (Database/
    // Import/Export/etc.) pull their deps on demand.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'vendor-router';
            if (id.includes('@tanstack')) return 'vendor-tanstack';
            if (id.includes('zustand')) return 'vendor-zustand';
            if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-tiptap';
            if (id.includes('lowlight') || id.includes('highlight.js')) return 'vendor-lowlight';
            if (id.includes('marked')) return 'vendor-marked';
            if (id.includes('katex')) return 'vendor-katex';
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
          }
          return undefined;
        },
      },
    },
  },
});
