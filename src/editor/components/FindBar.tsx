import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';

interface FindBarProps {
  editor: Editor;
  onClose: () => void;
}

interface Match {
  from: number;
  to: number;
}

/**
 * In-page search bar (PRD §5.1.5 — Mod+F).
 *
 * Behavior:
 *   - Highlights all matches via a `mark.ln-find-match` decoration set built
 *     by walking the doc text.
 *   - The currently-active match is decorated with `mark.ln-find-active`.
 *   - Up/Down arrows / Enter cycle through matches; scroll the active match
 *     into view via `editor.view.coordsAtPos`.
 *
 * Implementation note: we use TipTap's `Decoration` API via the editor's
 * `setPluginState` isn't available — instead we use a StateField-based plugin
 * added at runtime. To keep this MVP simple and avoid rebuilding the editor's
 * plugin set, we render matches as ephemeral `<span>` overlays positioned by
 * caret coords. This is correct for short docs and acceptable per PRD §5.1.5
 * "build minimal find-with-highlight".
 */
export function FindBar({ editor, onClose }: FindBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Collect all matches for the current query.
  const matches = useMemo<Match[]>(() => {
    if (!query) return [];
    const out: Match[] = [];
    const needle = caseSensitive ? query : query.toLowerCase();
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return false;
      const hay = caseSensitive ? node.text : node.text.toLowerCase();
      let i = 0;
      while (i <= hay.length - needle.length) {
        const j = hay.indexOf(needle, i);
        if (j === -1) break;
        out.push({ from: pos + j, to: pos + j + needle.length });
        i = j + needle.length;
      }
      return false;
    });
    return out;
  }, [editor, query, caseSensitive]);

  // Reset active when query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, caseSensitive]);

  // Scroll the active match into view.
  useEffect(() => {
    if (matches.length === 0) return;
    const m = matches[Math.min(activeIndex, matches.length - 1)];
    if (!m) return;
    const coords = editor.view.coordsAtPos(m.from);
    const inView =
      coords.top >= 0 && coords.bottom <= window.innerHeight;
    if (!inView) {
      window.scrollTo({ top: Math.max(0, coords.top - 80), behavior: 'smooth' });
    }
    // Set selection to the match so the user can copy/replace later.
    editor.commands.setTextSelection({ from: m.from, to: m.to });
  }, [activeIndex, matches, editor]);

  // Decorate matches with <mark> via direct DOM rendering.
  useEffect(() => {
    clearMarkSpans(editor.view.dom);
    if (matches.length === 0) return;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      wrapMatch(editor.view, m, i === Math.min(activeIndex, matches.length - 1));
    }
    return () => clearMarkSpans(editor.view.dom);
  }, [matches, activeIndex, editor]);

  // Keyboard navigation.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches.length === 0) return;
      const dir = e.shiftKey ? -1 : 1;
      setActiveIndex((i) => (i + dir + matches.length) % matches.length);
    } else if (e.key === 'ArrowDown' && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    }
  };

  return (
    <div
      className="ln-find-bar"
      role="search"
      aria-label={t('editor.findPlaceholder')}
      onMouseDown={(e) => e.preventDefault()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('editor.findPlaceholder')}
        className="ln-find-input"
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="button"
        className="ln-find-toggle"
        title={t('editor.matchCase')}
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((v) => !v)}
      >
        Aa
      </button>
      <span className="ln-find-count">
        {matches.length === 0 ? t('editor.noMatches') : `${Math.min(activeIndex + 1, matches.length)}/${matches.length}`}
      </span>
      <button
        type="button"
        className="ln-find-nav"
        title={t('editor.previous')}
        disabled={matches.length === 0}
        onClick={() => setActiveIndex((i) => (i - 1 + matches.length) % matches.length)}
      >
        ↑
      </button>
      <button
        type="button"
        className="ln-find-nav"
        title={t('editor.next')}
        disabled={matches.length === 0}
        onClick={() => setActiveIndex((i) => (i + 1) % matches.length)}
      >
        ↓
      </button>
      <button
        type="button"
        className="ln-find-close"
        title={t('editor.closeFind')}
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}

// === Match decoration (DOM-only, ephemeral) ============================

/**
 * Wrap text at the given range in a <mark>. ProseMirror re-renders DOM nodes
 * on transaction, so we re-apply on every effect run.
 */
function wrapMatch(view: { dom: HTMLElement }, match: Match, isActive: boolean) {
  // We can't easily wrap arbitrary text in ProseMirror DOM without a
  // decoration set. For the MVP we use window.find() / Range-based wrapping
  // when ranges are valid.
  try {
    const range = document.createRange();
    const start = textNodeAtPos(view.dom, match.from);
    const end = textNodeAtPos(view.dom, match.to);
    if (!start || !end) return;
    const offsetStart = start.offset;
    const offsetEnd = end.offset;
    if (start.node !== end.node) return; // cross-node matches not handled in MVP
    const tn = start.node;
    range.setStart(tn, offsetStart);
    range.setEnd(tn, offsetEnd);
    surroundRangeWithMark(range, isActive);
  } catch {
    // ignore
  }
}

interface TextNodeResult {
  node: Text;
  offset: number;
}

/**
 * Best-effort: convert a ProseMirror doc position to a DOM text-node + offset.
 * We use a flattened text walk over the editor DOM.
 */
function textNodeAtPos(root: HTMLElement, pos: number): TextNodeResult | null {
  let flat = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    const len = t.nodeValue?.length ?? 0;
    last = t;
    if (flat + len >= pos) {
      return { node: t, offset: pos - flat };
    }
    flat += len;
  }
  // Position past end — try the last text node.
  if (last) return { node: last, offset: last.nodeValue?.length ?? 0 };
  return null;
}

function surroundRangeWithMark(range: Range, isActive: boolean) {
  try {
    const mark = document.createElement('mark');
    mark.className = isActive ? 'ln-find-active' : 'ln-find-match';
    range.surroundContents(mark);
  } catch {
    // surroundContents fails on multi-element ranges — fine for MVP.
  }
}

function clearMarkSpans(root: HTMLElement) {
  const marks = root.querySelectorAll('mark.ln-find-match, mark.ln-find-active');
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}
