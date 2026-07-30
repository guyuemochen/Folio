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
import type { TFunction } from 'i18next';
import { api } from '../lib/invoke';
import { useDialog } from '../lib/dialog';
import type { AiSessionSummary, AiStoredMessage } from '../lib/types';

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

// =============================================================================
// Session helpers
// =============================================================================

/**
 * Convert a stored backend message into a UI Turn, or `null` if the message
 * is not displayable (system / pure-tool-result messages are hidden from
 * the chat bubbles — they still live in conversation memory on the backend).
 *
 * - User messages: text field is the user input.
 * - Assistant messages: concatenate text blocks (skip tool_use / tool_result
 *   blocks — those are surfaced live via the `ai-tool` event during the turn,
 *   and don't need to be replayed as bubbles when reloading an old session).
 */
function storedToTurn(m: AiStoredMessage): Turn | null {
  if (m.role === 'user') {
    const text = m.contentJson.text ?? '';
    return text ? { role: 'user', text } : null;
  }
  if (m.role === 'assistant') {
    // Two storage shapes: { text: "..." } for plain turns, or
    // { blocks: [{type:"text",text:"..."},{type:"tool_use",...}] } for
    // mixed turns. Concatenate text blocks only.
    let text = '';
    if (typeof m.contentJson.text === 'string') {
      text = m.contentJson.text;
    } else if (Array.isArray(m.contentJson.blocks)) {
      for (const b of m.contentJson.blocks) {
        if (typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text') {
          text += (b as { text?: string }).text ?? '';
        }
      }
    }
    return text ? { role: 'assistant', text } : null;
  }
  return null;
}

/**
 * Compact relative-time formatter ("just now" / "5m ago" / "3h ago" /
 * "2d ago" / ISO date for older). Avoids pulling in a date library for one
 * label in a dropdown.
 */
function formatRelativeTime(timestamp: number, t: TFunction): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t('ai.sessionTimeJustNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('ai.sessionTimeMinutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('ai.sessionTimeHoursAgo', { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('ai.sessionTimeDaysAgo', { count: day });
  // Older than a week → ISO date (YYYY-MM-DD).
  return new Date(timestamp).toISOString().slice(0, 10);
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

  // --- Session history state ---------------------------------------------
  // `sessions` is the list shown in the header dropdown. `currentSessionId`
  // is the locally-known id of the active conversation (may lag the backend
  // by one render after a send — the backend lazily creates the session on
  // first send). `currentTitle` is what the header shows.
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Refresh the session list from storage. After a turn, the active session
   *  is the first row (most-recently-touched) — so this also picks up its
   *  freshly-generated title. */
  const refreshSessions = async (): Promise<void> => {
    try {
      const list = await api.aiListSessions();
      setSessions(list);
      // If we have no locally-known session but the backend just created one
      // (first send), adopt the most-recent one as current.
      if (!currentSessionId && list.length > 0 && list[0].messageCount > 0) {
        setCurrentSessionId(list[0].id);
        setCurrentTitle(list[0].title);
      } else {
        const cur = list.find((s) => s.id === currentSessionId);
        if (cur) setCurrentTitle(cur.title);
      }
    } catch (e) {
      console.error('[folio:ai] refreshSessions failed', e);
    }
  };

  // Load session list once on mount so the dropdown is populated.
  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  /** User picked a past session from the dropdown. */
  const handleLoadSession = async (sessionId: string): Promise<void> => {
    if (loading) return; // backend will also refuse, but bail early
    try {
      const loaded = await api.aiLoadSession(sessionId);
      const newTurns: Turn[] = loaded.messages
        .map(storedToTurn)
        .filter((tn): tn is Turn => tn !== null);
      setTurns(newTurns);
      setStreaming('');
      setThinking('');
      setError(null);
      setPermission(null);
      setCurrentSessionId(loaded.id);
      setCurrentTitle(loaded.title);
      setMenuOpen(false);
      // Re-sync the dropdown list (the loaded session is now most-recent).
      void refreshSessions();
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
    }
  };

  /** User clicked "New chat". Clears local state + tells the backend to
   *  drop its current session pointer (it'll lazily create a new one on the
   *  next send). */
  const handleNewSession = async (): Promise<void> => {
    if (loading) return;
    try {
      await api.aiNewSession();
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
      return;
    }
    setTurns([]);
    setStreaming('');
    setThinking('');
    setError(null);
    setPermission(null);
    setCurrentSessionId(null);
    setCurrentTitle('');
    setMenuOpen(false);
  };

  /** User clicked the × next to a session in the dropdown. */
  const handleDeleteSession = async (
    sessionId: string,
    event: React.MouseEvent,
  ): Promise<void> => {
    event.stopPropagation();
    try {
      await api.aiDeleteSession(sessionId);
      // If we deleted the active session, reset local UI state too.
      if (sessionId === currentSessionId) {
        setTurns([]);
        setCurrentSessionId(null);
        setCurrentTitle('');
      }
      void refreshSessions();
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
    }
  };

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

    // Fire all listen() calls concurrently (not sequentially via await) to
    // minimize the registration window. Each resolves to an UnlistenFn.
    const promises = [
      listen<string>('ai-token', (e) => {
        if (!active) return;
        setLoading(false); // first token clears the "waiting" indicator
        streamBufRef.current += e.payload;
      }),
      listen<string>('ai-thought', (e) => {
        if (!active) return;
        thinkBufRef.current += e.payload;
      }),
      listen<void>('ai-done', () => {
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
        // After the turn, the backend has persisted new messages and touched
        // updated_at. Refresh the dropdown so the title (set from the first
        // user message) and ordering are correct.
        void refreshSessions();
      }),
      listen<string>('ai-error', (e) => {
        if (!active) return;
        const raw = e.payload || 'unknown error';
        setError({ kind: classifyError(raw), raw });
        setLoading(false);
      }),
      listen<string>('ai-tool', (e) => {
        if (!active) return;
        setLastTool(e.payload || '');
      }),
      listen<Permission>('ai-permission', (e) => {
        if (!active) return;
        setPermission(e.payload);
      }),
    ];

    promises.forEach((p) =>
      p.then((u) => {
        if (active) unlisteners.push(u);
      }),
    );

    return () => {
      active = false;
      // Unregister listeners that resolved before cleanup.
      unlisteners.forEach((u) => u());
      // Unregister listeners that resolve after cleanup (race: unmount
      // happened while listen() was still pending).
      promises.forEach((p) => p.then((u) => u()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // The backend lazily creates a session on first send. We don't know
      // the new id yet — refresh picks it up via the most-recent row.
      // Defer slightly so the persistence has time to land.
      window.setTimeout(() => void refreshSessions(), 0);
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
      setLoading(false);
    }
  }

  function stop(): void {
    void api.aiStop();
    // Clear buffers so late-arriving tokens don't corrupt the next turn
    // or get appended as a partial assistant message by ai-done.
    streamBufRef.current = '';
    thinkBufRef.current = '';
    setStreaming('');
    setThinking('');
    setLoading(false);
  }

  async function respondPermission(approve: boolean): Promise<void> {
    try {
      await api.aiPermissionRespond(approve);
      setPermission(null);
    } catch (e) {
      setError({ kind: classifyError(String(e)), raw: String(e) });
      // Keep the permission prompt visible on error so the user can retry.
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

        <header className="relative flex h-12 items-center justify-between border-b border-border-hairline px-4">
          {/* Session picker trigger: clicking the title opens a dropdown with
              past sessions + a "New chat" action. Refs handle click-outside. */}
          <div ref={menuRef} className="relative flex items-center min-w-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1 min-w-0 rounded px-1 py-0.5 text-[13px] font-medium text-text-primary hover:bg-bg-hover transition-colors"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('ai.sessionsButtonLabel')}
              title={t('ai.sessionsButtonLabel')}
            >
              <span className="shrink-0 text-text-tertiary text-[12px]">≡</span>
              <span className="truncate max-w-[260px]">
                {currentTitle || t('ai.title')}
              </span>
              <span className="shrink-0 text-text-tertiary text-[10px]">▾</span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute top-[calc(100%+4px)] left-0 z-50 w-[300px] max-w-[90vw] rounded-md border border-border-hairline bg-bg-section shadow-popover py-1 text-[13px]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleNewSession()}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <span className="text-text-tertiary">＋</span>
                  <span>{t('ai.newSession')}</span>
                </button>
                {sessions.length > 0 && (
                  <div className="my-1 border-t border-border-hairline" />
                )}
                <div className="max-h-[300px] overflow-y-auto">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      role="menuitem"
                      tabIndex={0}
                      onClick={() => void handleLoadSession(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleLoadSession(s.id);
                      }}
                      className={`group flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-bg-hover transition-colors ${
                        s.id === currentSessionId ? 'bg-bg-hover/60' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-text-primary">
                          {s.title || t('ai.untitledSession')}
                        </div>
                        <div className="text-[11px] text-text-tertiary">
                          {formatRelativeTime(s.updatedAt, t)}
                          {s.messageCount > 0 && (
                            <span className="ml-1 opacity-70">· {s.messageCount} msg</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => void handleDeleteSession(s.id, e)}
                        aria-label={t('ai.deleteSessionLabel')}
                        title={t('ai.deleteSessionLabel')}
                        className="shrink-0 rounded px-1 text-text-tertiary opacity-0 transition-opacity hover:text-status-red group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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
