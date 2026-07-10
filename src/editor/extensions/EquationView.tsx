import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import katex from 'katex';
import { FormulaPopover } from './FormulaPopover';

/**
 * React NodeView for the Equation node (block-level KaTeX).
 *
 * Preview is always shown; clicking it opens {@link FormulaPopover} where the
 * LaTeX is edited in a textarea with a live preview. The change is persisted
 * only when the user clicks OK (or Ctrl/Cmd+Enter) — Cancel / Escape / outside
 * click discards the draft.
 *
 * KaTeX errors are rendered in-place (throwOnError=false) so broken LaTeX
 * shows a red strikethrough hint instead of crashing the editor.
 */
export function EquationView({ node, updateAttributes }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const latex = (node.attrs.latex as string) ?? '';
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Render the committed LaTeX into the preview.
  useEffect(() => {
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
  }, [latex]);

  const open = (e: React.MouseEvent) => {
    setAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
  };

  return (
    <NodeViewWrapper className="ln-equation-wrapper" as="div">
      {latex === '' ? (
        <div
          className="ln-equation-preview ln-equation-placeholder"
          contentEditable={false}
          onClick={open}
          title={t('editor.clickToEditEquation')}
        >
          {t('editor.equationEmptyHint')}
        </div>
      ) : (
        <div
          ref={previewRef}
          className="ln-equation-preview"
          contentEditable={false}
          onClick={open}
          title={t('editor.clickToEditEquation')}
        />
      )}
      {anchorRect && (
        <FormulaPopover
          anchorRect={anchorRect}
          initialLatex={latex}
          displayMode={true}
          onCommit={(next) => {
            updateAttributes({ latex: next });
            setAnchorRect(null);
          }}
          onCancel={() => setAnchorRect(null)}
        />
      )}
    </NodeViewWrapper>
  );
}
