import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { UserManual } from './components/UserManual';
import { perf } from './lib/perf';
import { queryClient } from './lib/queryClient';
import { usePluginRegistry } from './plugins/store';
import { startPluginHotReload } from './plugins/hot-reload';
import './i18n/config';
import './styles/globals.css';
// KaTeX stylesheet — required for the Equation/InlineMath NodeViews to render
// math with the correct fonts and spacing (output:'html' references these
// font families). Vite's manualChunks routes katex to its own vendor chunk.
import 'katex/dist/katex.min.css';
import { initTheme } from './lib/theme';
import { initEditorPrefs } from './lib/editorPrefs';

// Apply the OS color scheme before React renders, to avoid a flash of the
// wrong theme (PRD §10.4 prefers-color-scheme). The runtime listener lives
// in <App/> via useTheme().
initTheme();
// Apply the persisted editor font scale before React renders, so the editor
// paints at the right size on first mount.
initEditorPrefs();

// Expose the host React instance BEFORE any plugin dynamic-import resolves.
// Plugins proxy React through `globalThis.__FOLIO__.react` (see
// `@folio/plugin-sdk/react`) so they share our single React instance — this
// is what avoids "Invalid hook call" / context desync when a plugin widget
// renders. Must run before registry.init() (which dynamic-imports plugins).
(globalThis as unknown as { __FOLIO__: unknown }).__FOLIO__ = {
  react: React,
  reactDOM: ReactDOM,
};

// The manual window reuses this same bundle but is routed by URL hash
// (`#manual`) — see `src/lib/openManual.ts`. It only needs i18n + theme,
// so we skip plugin discovery, query client, router, and the cold-start
// perf mark (those are app-shell-only).
const isManualWindow = window.location.hash === '#manual';

if (!isManualWindow) {
  // Kick off plugin discovery + hot-reload. Both are fire-and-forget — the
  // registry store exposes a `initialized` flag the UI can wait on, and a
  // failure to load plugins must never block the rest of the app.
  void usePluginRegistry.getState().init();
  void startPluginHotReload().catch((e) =>
    console.error('[folio:plugins] failed to start hot-reload listener:', e),
  );

  // M6 perf: start the cold-start timer at JS entry. The matching `end` is
  // emitted from <App/>'s mount effect — together they measure the
  // "cold-start to interactive shell" target from PRD §10.1.
  perf.start('cold-start-shell');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isManualWindow ? (
      <UserManual />
    ) : (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    )}
  </React.StrictMode>,
);
