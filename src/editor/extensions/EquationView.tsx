import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import katex from 'katex';

/**
 * React NodeView for the Equation node.
 *
 * Two modes:
 *   - Preview: shows rendered KaTeX. Click to switch to editing.
 *   - Edit: shows a textarea bound to `latex`; blur commits and returns to preview.
 *
 * KaTeX errors are rendered in-place (throwOnError=false) so broken LaTeX
 * shows a red strikethrough hint instead of crashing the editor.
 */
export function EquationView({ node, updateAttributes }: ReactNodeViewProps) {
  const latex = (node.attrs.latex as string) ?? '';
  const [editing, setEditing] = useState(latex === '');
  const [draft, setDraft] = useState(latex);
  const previewRef = useRef<HTMLDivElement>(null);

  // Re-render KaTeX on every latex change (preview mode).
  useEffect(() => {
    if (editing) return;
    const el = previewRef.current;
    if (!el) return;
    try {
      katex.render(latex || '\\,', el, {
        displayMode: true,
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
      className="ln-equation-wrapper"
      as="div"
      data-equation-editing={editing ? 'true' : 'false'}
    >
      {editing ? (
        <div className="ln-equation-editor" contentEditable={false}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(latex);
                setEditing(false);
              }
            }}
            placeholder="LaTeX — e.g. \int_0^\infty e^{-x^2} dx"
            rows={2}
            autoFocus
            className="w-full px-3 py-2 font-mono text-[13px] rounded-md border border-accent/40 bg-bg-page outline-none"
          />
          <div className="mt-1 text-[10px] text-text-tertiary">
            Enter to save · Esc to cancel
          </div>
        </div>
      ) : (
        <div
          ref={previewRef}
          className="ln-equation-preview"
          contentEditable={false}
          onClick={() => setEditing(true)}
          title="Click to edit LaTeX"
        />
      )}
    </NodeViewWrapper>
  );
}
