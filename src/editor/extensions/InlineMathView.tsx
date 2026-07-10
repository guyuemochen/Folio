import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import katex from 'katex';

/**
 * React NodeView for the InlineMath node.
 *
 * Mirrors EquationView but renders inline (displayMode:false) and uses a
 * `span` wrapper so the math sits inside a line of text. Two modes:
 *   - Preview: shows rendered KaTeX. Click to switch to editing.
 *   - Edit: shows an inline text input bound to `latex`; Enter/blur commits.
 *
 * KaTeX errors are rendered in-place (throwOnError:false) so broken LaTeX
 * shows a red strikethrough hint instead of crashing the editor.
 */
export function InlineMathView({ node, updateAttributes }: ReactNodeViewProps) {
  const latex = (node.attrs.latex as string) ?? '';
  const [editing, setEditing] = useState(latex === '');
  const [draft, setDraft] = useState(latex);
  const previewRef = useRef<HTMLSpanElement>(null);

  // Re-render KaTeX on every latex change (preview mode).
  useEffect(() => {
    if (editing) return;
    const el = previewRef.current;
    if (!el) return;
    try {
      katex.render(latex || '\\,', el, {
        displayMode: false,
        throwOnError: false,
        output: 'html',
      });
    } catch (err) {
      el.textContent = `[KaTeX error] ${(err as Error).message}`;
    }
  }, [latex, editing]);

  // Keep draft in sync when external edits change the node attrs.
  useEffect(() => {
    if (latex !== draft) setDraft(latex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex]);

  const commit = () => {
    updateAttributes({ latex: draft });
    setEditing(false);
  };

  return (
    <NodeViewWrapper
      className="ln-inlinemath-wrapper"
      as="span"
      contentEditable={false}
      data-inlinemath-editing={editing ? 'true' : 'false'}
    >
      {editing ? (
        <span className="ln-inlinemath-editor">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(latex);
                setEditing(false);
              }
            }}
            placeholder="LaTeX — e.g. \int_0^\infty e^{-x^2} dx"
            autoFocus
            className="ln-inlinemath-input font-mono text-[13px] rounded border border-accent/40 bg-bg-page outline-none px-1"
          />
        </span>
      ) : (
        <span
          ref={previewRef}
          className="ln-inlinemath-preview"
          onClick={() => setEditing(true)}
          title="Click to edit LaTeX"
        />
      )}
    </NodeViewWrapper>
  );
}
