import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { perf } from './lib/perf';
import './i18n/config';
import './styles/globals.css';
import { initTheme } from './lib/theme';

// Apply the OS color scheme before React renders, to avoid a flash of the
// wrong theme (PRD §10.4 prefers-color-scheme). The runtime listener lives
// in <App/> via useTheme().
initTheme();

// M6 perf: start the cold-start timer at JS entry. The matching `end` is
// emitted from <App/>'s mount effect — together they measure the
// "cold-start to interactive shell" target from PRD §10.1.
perf.start('cold-start-shell');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
