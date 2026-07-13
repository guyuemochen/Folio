import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import katex from 'katex';
import { Popover } from '../../components/ui/Popover';

interface FormulaPopoverProps {
  /** Anchor rectangle of the clicked formula (positions the popover). */
  anchorRect: DOMRect;
  /** LaTeX to start editing from. */
  initialLatex: string;
  /** KaTeX displayMode: true for block equations, false for inline math. */
  displayMode: boolean;
  /** Called with the edited LaTeX when the user clicks OK / Ctrl+Enter. */
  onCommit: (latex: string) => void;
  /** Called on Cancel, Escape, or outside click — no change is saved. */
  onCancel: () => void;
}

/**
 * Floating formula editor shared by the Equation (block) and InlineMath
 * (inline) node views.
 *
 * Unlike the old inline edit-in-place behavior, the LaTeX is edited in a
 * textarea inside a popover with a **live KaTeX preview**, and the change is
 * only persisted when the user clicks OK (or presses Ctrl/Cmd+Enter). Cancel,
 * Escape, or an outside click discards the draft.
 */
export function FormulaPopover({
  anchorRect,
  initialLatex,
  displayMode,
  onCommit,
  onCancel,
}: FormulaPopoverProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialLatex);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the field and place the caret at the end on open.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, []);

  // Live preview: re-render KaTeX on every draft change.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    try {
      katex.render(draft || '\\,', el, {
        displayMode,
        throwOnError: false,
        output: 'html',
      });
    } catch (err) {
      el.textContent = `[KaTeX error] ${(err as Error).message}`;
    }
  }, [draft, displayMode]);

  return (
    <Popover
      anchorRect={anchorRect}
      placement="bottom-start"
      width={520}
      onClose={onCancel}
      ariaLabel={t('editor.equationEditorTitle')}
    >
      <div className="flex flex-col gap-2 p-3">
        <div
          ref={previewRef}
          className="min-h-[3em] overflow-x-auto rounded-md bg-bg-section px-3 py-2 text-center"
        />
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter commits; plain Enter is a newline (textarea).
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onCommit(draft);
            }
          }}
          placeholder={t('editor.equationPlaceholder')}
          rows={3}
          className="w-full resize-y rounded-md border border-border-hairline bg-bg-page px-2 py-1.5 font-mono text-[13px] outline-none focus:border-accent/60"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">{t('editor.equationHint')}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border-hairline px-3 py-1 text-[13px] hover:bg-bg-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => onCommit(draft)}
              className="rounded-md bg-accent px-3 py-1 text-[13px] text-white hover:opacity-90"
            >
              {t('common.ok')}
            </button>
          </div>
        </div>
      </div>
    </Popover>
  );
}
