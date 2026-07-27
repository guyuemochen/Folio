/**
 * M10 AI assistant panel.
 *
 * Renders streamed assistant output as Markdown, shows reasoning/thinking
 * tokens (agent_thought_chunk) in a collapsible section, and surfaces
 * permission requests (session/request_permission) for write tool calls.
 *
 * Event contract (from src-tauri/src/opencode.rs):
 *   ai-token      (String)  — incremental assistant text
 *   ai-thought    (String)  — incremental reasoning text (kept separate)
 *   ai-tool       (String)  — tool-call title (e.g. "list_pages")
 *   ai-done       (())      — turn finished
 *   ai-error      (String)  — protocol/transport error
 *   ai-stderr     (String)  — opencode stderr (bootstrap / provider logs)
 *   ai-permission ({title,description}) — agent requests approval for a tool
 */

import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../lib/invoke';

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

export default function AiPanel({ onClose }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState('');
  const [thinking, setThinking] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootLog, setBootLog] = useState('');
  const [lastTool, setLastTool] = useState('');
  const [permission, setPermission] = useState<Permission | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Refs mirror the streamed state so the `ai-done` handler can flush without
  // nesting setState calls inside a setState updater.
  const streamingRef = useRef('');
  const thinkingRef = useRef('');

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    (async () => {
      const u1 = await listen<string>('ai-token', (e) => {
        if (!active) return;
        setLoading(false);
        setStreaming((s) => {
          const next = s + e.payload;
          streamingRef.current = next;
          return next;
        });
      });
      unlisteners.push(() => u1());

      const u2 = await listen<string>('ai-thought', (e) => {
        if (!active) return;
        setThinking((s) => {
          const next = s + e.payload;
          thinkingRef.current = next;
          return next;
        });
      });
      unlisteners.push(() => u2());

      const u3 = await listen<void>('ai-done', () => {
        if (!active) return;
        const finalText = streamingRef.current;
        const finalThought = thinkingRef.current;
        if (finalText || finalThought) {
          setTurns((t) => [
            ...t,
            { role: 'assistant', text: finalText, ...(finalThought ? { thinking: finalThought } : {}) },
          ]);
        }
        streamingRef.current = '';
        thinkingRef.current = '';
        setStreaming('');
        setThinking('');
        setLoading(false);
      });
      unlisteners.push(() => u3());

      const u4 = await listen<string>('ai-error', (e) => {
        if (!active) return;
        setError(e.payload || 'unknown error');
        setLoading(false);
      });
      unlisteners.push(() => u4());

      const u5 = await listen<string>('ai-stderr', (e) => {
        if (!active) return;
        const last = e.payload.split('\n').filter(Boolean).pop();
        if (last) setBootLog(last.slice(0, 200));
      });
      unlisteners.push(() => u5());

      const u6 = await listen<string>('ai-tool', (e) => {
        if (!active) return;
        setLastTool(e.payload || '');
      });
      unlisteners.push(() => u6());

      const u7 = await listen<Permission>('ai-permission', (e) => {
        if (!active) return;
        setPermission(e.payload);
      });
      unlisteners.push(() => u7());
    })();

    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming, thinking, loading, permission]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(): Promise<void> {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setError(null);
    setBootLog('');
    setLastTool('');
    streamingRef.current = '';
    thinkingRef.current = '';
    setStreaming('');
    setThinking('');
    setTurns((t) => [...t, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      await api.aiSend(msg);
    } catch (e) {
      setError(String(e));
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
      setError(String(e));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside className="relative flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border-hairline bg-bg-page shadow-popover">
        {/* Scoped styles for rendered assistant Markdown (Folio has no typography plugin). */}
        <style>{AI_MD_CSS}</style>

        <header className="flex h-12 items-center justify-between border-b border-border-hairline px-4">
          <span className="text-[13px] font-medium text-text-primary">AI 助手</span>
          <button
            onClick={onClose}
            aria-label="close"
            className="text-text-tertiary transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
          {turns.length === 0 && !streaming && !thinking && !loading && (
            <p className="text-text-tertiary">
              输入消息开始对话（Enter 发送，Shift+Enter 换行，Esc 关闭）。
            </p>
          )}

          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i}>
                <div className="mb-1 text-[11px] text-text-tertiary">你</div>
                <div className="whitespace-pre-wrap break-words text-text-primary">{t.text}</div>
              </div>
            ) : (
              <div key={i} className="rounded-md bg-bg-section px-3 py-2">
                <div className="mb-1 text-[11px] text-text-tertiary">AI</div>
                {t.thinking && (
                  <details className="mb-1">
                    <summary className="cursor-pointer text-[11px] text-text-tertiary">思考过程</summary>
                    <div className="mt-1 whitespace-pre-wrap border-l-2 border-border-hairline pl-2 text-[12px] italic text-text-tertiary">
                      {t.thinking}
                    </div>
                  </details>
                )}
                {t.text ? <Markdown text={t.text} /> : <span className="text-text-tertiary">（无文本输出）</span>}
              </div>
            ),
          )}

          {/* Live in-flight turn: thinking (collapsed) above the streaming answer. */}
          {(thinking || streaming) && (
            <div className="rounded-md bg-bg-section px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-text-tertiary">
                <span>AI</span>
                {lastTool && <span className="opacity-70">🔧 {lastTool}</span>}
              </div>
              {thinking && (
                <details open={!streaming} className="mb-1">
                  <summary className="cursor-pointer text-[11px] text-text-tertiary">思考过程</summary>
                  <div className="mt-1 whitespace-pre-wrap border-l-2 border-border-hairline pl-2 text-[12px] italic text-text-tertiary">
                    {thinking}
                  </div>
                </details>
              )}
              {streaming && <Markdown text={streaming} />}
            </div>
          )}

          {loading && !thinking && !streaming && (
            <div className="text-[12px] text-text-tertiary">{bootLog || '正在启动 AI 引擎…（首次约 7 秒）'}</div>
          )}

          {permission && (
            <div className="my-1 rounded-md border border-border-hairline bg-bg-section px-3 py-2">
              <div className="mb-0.5 text-[12px] font-medium text-text-primary">{permission.title}</div>
              {permission.description && (
                <div className="mb-2 text-[11px] text-text-tertiary">{permission.description}</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => void respondPermission(true)}
                  className="rounded bg-text-primary px-3 py-1 text-[12px] text-bg-page"
                >
                  允许
                </button>
                <button
                  onClick={() => void respondPermission(false)}
                  className="rounded border border-border-hairline px-3 py-1 text-[12px] text-text-secondary"
                >
                  拒绝
                </button>
              </div>
            </div>
          )}

          {error && <div className="text-[12px] text-red-500">{error}</div>}
        </div>

        <footer className="border-t border-border-hairline p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="给 AI 发消息…"
              className="flex-1 resize-none rounded-md border border-border-hairline bg-bg-section px-3 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-text-placeholder focus:outline-none"
            />
            {loading ? (
              <button
                onClick={stop}
                className="rounded-md border border-border-hairline px-3 py-2 text-[13px] text-text-secondary"
              >
                停止
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!input.trim()}
                className="rounded-md bg-text-primary px-3 py-2 text-[13px] text-bg-page disabled:opacity-40"
              >
                发送
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
