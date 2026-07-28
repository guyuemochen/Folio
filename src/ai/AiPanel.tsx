/**
 * M10 AI assistant panel (v2 — built-in agent).
 *
 * Renders streamed assistant output as Markdown, shows reasoning/thinking
 * tokens (agent_thought_chunk) in a collapsible section, surfaces
 * permission requests for write tool calls, and classifies provider
 * errors into typed user-friendly messages.
 *
 * Event contract (from src-tauri/src/agent/mod.rs):
 *   ai-token      (String)  — incremental assistant text
 *   ai-thought    (String)  — incremental reasoning text (thinking models)
 *   ai-tool       (String)  — tool-call title (e.g. "list_pages")
 *   ai-done       (())      — turn finished
 *   ai-error      (String)  — protocol/transport error (classified here)
 *   ai-permission ({title,description}) — write-tool approval prompt
 *
 * Accessibility: uses the shared `useDialog()` hook (role=dialog, aria-modal,
 * Escape to close, Tab/Shift+Tab focus trap, focus restore, scroll lock).
 *
 * Performance: token deltas are buffered into a ref and flushed to state on
 * a ~50ms interval (≈20fps) while a turn is in flight. Without batching,
 * a fast model streaming hundreds of tokens/sec would re-render the Markdown
 * tree on every token and thrash the main thread.
 */

import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/invoke';
import { useDialog } from '../lib/dialog';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
}

interface Permission {
  title: string;
  description: string;
}

interface Props {
  onClose: () => void;
}

type ErrorKind = 'auth' | 'rateLimit' | 'network' | 'server' | 'stream' | 'toolRejected' | 'generic';

interface ClassifiedError {
  kind: ErrorKind;
  raw: string;
}

/**
 * Classify a raw error string (from `ProviderError::to_string()` on the
 * backend) into a typed kind we can render with a friendly message. The
 * backend already categorizes HTTP status into `ProviderError::Auth` /
 * `RateLimited` / `Api` / `Network` / `Stream`; their `Display` impls emit
 * distinguishing phrases we match on here. Frontend classification is
 * string-based because the Tauri event channel only carries String — we
 * can't ship a typed enum across it without adding a serialization layer.
 */
function classifyError(raw: string): ErrorKind {
  const s = raw.toLowerCase();
  if (s.includes('user rejected')) return 'toolRejected';
  if (s.includes('auth failed') || /\bhttp 40[13]\b/.test(s)) return 'auth';
  if (s.includes('rate limited') || /\bhttp 429\b/.test(s)) return 'rateLimit';
  if (s.includes('network') || s.includes('connection') || s.includes('dns') || s.includes('tls')) {
    return 'network';
  }
  if (/\bhttp 5\d\d\b/.test(s)) return 'server';
  if (s.includes('stream')) return 'stream';
  return 'generic';
}

// --- lazy marked loader (keep it out of the cold-start bundle) ---
type MarkedFn = typeof import('marked')['marked'];
let markedPromise: Promise<MarkedFn> | null = null;
function loadMarked(): Promise<MarkedFn> {
  if (!markedPromise) markedPromise = import('marked').then((m) => m.marked);
  return markedPromise;
}

/** Render Markdown text to styled HTML (lazy-loads `marked` on first use). */
function Markdown({ text }: { text: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let active = true;
    loadMarked()
      .then((marked) => {
        if (!active) return;
        try {
          setHtml(marked.parse(text, { breaks: true }) as string);
        } catch {
          setHtml('');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [text]);
  // While marked loads (first chunk only), fall back to plain text so the user
  // sees content immediately rather than a blank bubble.
  if (!html) return <div className="whitespace-pre-wrap break-words">{text}</div>;
  return <div className="ai-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Compact red error card with a "Technical details" disclosure for the raw message. */
function ErrorCard({ error, onDismiss }: { error: ClassifiedError; onDismiss: () => void }) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  const text = (() => {
    switch (error.kind) {
      case 'auth':
        return t('ai.errorAuth');
      case 'rateLimit':
        return t('ai.errorRateLimit');
      case 'network':
        return t('ai.errorNetwork');
      case 'server':
        return t('ai.errorServer');
      case 'stream':
        return t('ai.errorStream');
      case 'toolRejected':
        return t('ai.errorToolRejected');
      default:
        return t('ai.errorGeneric', { message: error.raw.slice(0, 200) });
    }
  })();

  return (
    <div className="my-1 rounded-md border border-red-300/40 bg-red-50/60 px-3 py-2 text-[12px] dark:bg-red-950/20">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-red-700 dark:text-red-300">⚠ {text}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('ai.errorDismiss')}
          className="text-red-700/60 transition-opacity hover:opacity-100 dark:text-red-300/60"
        >
          ✕
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="mt-1 text-[11px] text-red-700/70 underline dark:text-red-300/70"
      >
        {t('ai.errorDetails')}
      </button>
      {showDetails && (
        <pre className="mt-1 max-h-[150px] overflow-y-auto whitespace-pre-wrap rounded bg-red-100/40 p-2 text-[11px] text-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error.raw}
        </pre>
      )}
    </div>
  );
}

export default function AiPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const dialog = useDialog({ onClose, label: t('ai.title'), initialFocusSelector: 'textarea' });

  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState('');
  const [thinking, setThinking] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [lastTool, setLastTool] = useState('');
  const [permission, setPermission] = useState<Permission | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Token / thought buffers. The event listeners write into refs (cheap,
  // synchronous, no re-render); a ~50ms interval flushes them to state so
  // React only re-renders ~20×/sec even when the model is streaming
  // hundreds of tokens/sec.
  const streamBufRef = useRef('');
  const thinkBufRef = useRef('');

  // Buffer flush interval — only runs while a turn is in flight.
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setStreaming(streamBufRef.current);
      setThinking(thinkBufRef.current);
    }, 50);
    return () => window.clearInterval(id);
  }, [loading]);

  // Event listeners (mounted once).
  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    (async () => {
      const u1 = await listen<string>('ai-token', (e) => {
        if (!active) return;
        setLoading(false); // first token clears the "waiting" indicator
        streamBufRef.current += e.payload;
      });
      unlisteners.push(() => u1());

      const u2 = await listen<string>('ai-thought', (e) => {
        if (!active) return;
        thinkBufRef.current += e.payload;
      });
      unlisteners.push(() => u2());

      const u3 = await listen<void>('ai-done', () => {
        if (!active) return;
        const finalText = streamBufRef.current;
        const finalThought = thinkBufRef.current;
        if (finalText || finalThought) {
          setTurns((ts) => [
            ...ts,
            {
              role: 'assistant',
              text: finalText,
              ...(finalThought ? { thinking: finalThought } : {}),
            },
          ]);
        }
        streamBufRef.current = '';
        thinkBufRef.current = '';
        setStreaming('');
        setThinking('');
        setLoading(false);
      });
      unlisteners.push(() => u3());

      const u4 = await listen<string>('ai-error', (e) => {
        if (!active) return;
        const raw = e.payload || 'unknown error';
        setError({ kind: classifyError(raw), raw });
        setLoading(false);
      });
      unlisteners.push(() => u4());

      const u5 = await listen<string>('ai-tool', (e) => {
        if (!active) return;
        setLastTool(e.payload || '');
      });
      unlisteners.push(() => u5());

      const u6 = await listen<Permission>('ai-permission', (e) => {
        if (!active) return;
        setPermission(e.payload);
      });
      unlisteners.push(() => u6());
    })();

    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming, thinking, loading, permission, error]);

  async function send(): Promise<void> {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setError(null);
    setLastTool('');
    streamBufRef.current = '';
    thinkBufRef.current = '';
    setStreaming('');
    setThinking('');
    setTurns((ts) => [...ts, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      await api.aiSend(msg);
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
      setLoading(false);
    }
  }

  function stop(): void {
    void api.aiStop();
    setLoading(false);
  }

  async function respondPermission(approve: boolean): Promise<void> {
    setPermission(null);
    try {
      await api.aiPermissionRespond(approve);
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const empty = turns.length === 0 && !streaming && !thinking && !loading && !error;

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} aria-hidden="true" />
      <aside
        {...dialog.containerProps}
        className="relative flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border-hairline bg-bg-page shadow-popover"
      >
        {/* Scoped styles for rendered assistant Markdown (Folio has no typography plugin). */}
        <style>{AI_MD_CSS}</style>

        <header className="flex h-12 items-center justify-between border-b border-border-hairline px-4">
          <span className="text-[13px] font-medium text-text-primary">{t('ai.title')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ai.closeLabel')}
            className="text-text-tertiary transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed"
        >
          {empty && <p className="text-text-tertiary">{t('ai.emptyHint')}</p>}

          {turns.map((tn, i) =>
            tn.role === 'user' ? (
              <div key={i}>
                <div className="mb-1 text-[11px] text-text-tertiary">{t('ai.you')}</div>
                <div className="whitespace-pre-wrap break-words text-text-primary">{tn.text}</div>
              </div>
            ) : (
              <div key={i} className="rounded-md bg-bg-section px-3 py-2">
                <div className="mb-1 text-[11px] text-text-tertiary">{t('ai.assistant')}</div>
                {tn.thinking && (
                  <details className="mb-1">
                    <summary className="cursor-pointer text-[11px] text-text-tertiary">
                      {t('ai.thinking')}
                    </summary>
                    <div className="mt-1 whitespace-pre-wrap border-l-2 border-border-hairline pl-2 text-[12px] italic text-text-tertiary">
                      {tn.thinking}
                    </div>
                  </details>
                )}
                {tn.text ? (
                  <Markdown text={tn.text} />
                ) : (
                  <span className="text-text-tertiary">{t('ai.noOutput')}</span>
                )}
              </div>
            ),
          )}

          {/* Live in-flight turn: thinking (collapsed) above the streaming answer. */}
          {(thinking || streaming) && (
            <div className="rounded-md bg-bg-section px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-text-tertiary">
                <span>{t('ai.assistant')}</span>
                {lastTool && <span className="opacity-70">🔧 {lastTool}</span>}
              </div>
              {thinking && (
                <details open={!streaming} className="mb-1">
                  <summary className="cursor-pointer text-[11px] text-text-tertiary">
                    {t('ai.thinking')}
                  </summary>
                  <div className="mt-1 whitespace-pre-wrap border-l-2 border-border-hairline pl-2 text-[12px] italic text-text-tertiary">
                    {thinking}
                  </div>
                </details>
              )}
              {streaming && <Markdown text={streaming} />}
            </div>
          )}

          {loading && !thinking && !streaming && (
            <div className="text-[12px] text-text-tertiary">{t('ai.waiting')}</div>
          )}

          {permission && (
            <div className="my-1 rounded-md border border-border-hairline bg-bg-section px-3 py-2">
              <div className="mb-0.5 text-[12px] font-medium text-text-primary">
                {permission.title}
              </div>
              {permission.description && (
                <div className="mb-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded bg-bg-page/50 p-2 font-mono text-[11px] text-text-tertiary">
                  {permission.description}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void respondPermission(true)}
                  className="rounded bg-text-primary px-3 py-1 text-[12px] text-bg-page"
                >
                  {t('ai.allow')}
                </button>
                <button
                  type="button"
                  onClick={() => void respondPermission(false)}
                  className="rounded border border-border-hairline px-3 py-1 text-[12px] text-text-secondary"
                >
                  {t('ai.reject')}
                </button>
              </div>
            </div>
          )}

          {error && <ErrorCard error={error} onDismiss={() => setError(null)} />}
        </div>

        <footer className="border-t border-border-hairline p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={t('ai.inputPlaceholder')}
              className="flex-1 resize-none rounded-md border border-border-hairline bg-bg-section px-3 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-text-placeholder focus:outline-none"
            />
            {loading ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-md border border-border-hairline px-3 py-2 text-[13px] text-text-secondary"
              >
                {t('ai.stop')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim()}
                className="rounded-md bg-text-primary px-3 py-2 text-[13px] text-bg-page disabled:opacity-40"
              >
                {t('ai.send')}
              </button>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}

// Markdown styles scoped to `.ai-md` (rendered via dangerouslySetInnerHTML).
// Uses Folio's @theme CSS variables so it adapts to light/dark themes.
const AI_MD_CSS = `
.ai-md { color: var(--color-text-primary); font-size: 13px; line-height: 1.6; }
.ai-md > *:first-child { margin-top: 0; }
.ai-md > *:last-child { margin-bottom: 0; }
.ai-md h1, .ai-md h2, .ai-md h3, .ai-md h4 { font-weight: 600; line-height: 1.3; margin: 0.6em 0 0.3em; }
.ai-md h1 { font-size: 1.25em; }
.ai-md h2 { font-size: 1.12em; }
.ai-md h3 { font-size: 1.02em; }
.ai-md p { margin: 0.4em 0; }
.ai-md ul, .ai-md ol { margin: 0.4em 0; padding-left: 1.4em; }
.ai-md li { margin: 0.15em 0; }
.ai-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; background: var(--color-bg-hover, rgba(127,127,127,0.15)); padding: 0.1em 0.35em; border-radius: 3px; }
.ai-md pre { background: var(--color-bg-hover, rgba(127,127,127,0.15)); padding: 0.6em 0.8em; border-radius: 6px; overflow-x: auto; margin: 0.5em 0; }
.ai-md pre code { background: none; padding: 0; font-size: 0.85em; }
.ai-md blockquote { border-left: 3px solid var(--color-border-hairline); padding-left: 0.8em; margin: 0.5em 0; color: var(--color-text-secondary); }
.ai-md a { color: var(--color-text-link, #3b82f6); text-decoration: underline; }
.ai-md table { border-collapse: collapse; margin: 0.5em 0; font-size: 0.92em; display: block; overflow-x: auto; }
.ai-md th, .ai-md td { border: 1px solid var(--color-border-hairline); padding: 0.3em 0.6em; text-align: left; }
.ai-md hr { border: none; border-top: 1px solid var(--color-border-hairline); margin: 0.7em 0; }
.ai-md strong { font-weight: 600; }
`;
