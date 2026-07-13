import { Node, mergeAttributes, InputRule, PasteRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import katex from 'katex';
import { EquationView } from './EquationView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    equation: {
      /** Insert a KaTeX block equation at the current selection. */
      setEquation: (attrs?: { latex?: string }) => ReturnType;
    };
  }
}

export interface EquationOptions {
  HTMLAttributes: Record<string, string>;
  defaultLatex: string;
}

/**
 * Block-level KaTeX equation (Notion "equation" / LaTeX display math).
 *
 * - Stored as a single `latex` string attribute.
 * - Rendered via a React NodeView (EquationView) so KaTeX actually paints.
 * - Empty / unmounted state shows an editable textarea for LaTeX input.
 */
export const Equation = Node.create<EquationOptions>({
  name: 'equation',
  group: 'block',
  atom: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-equation' },
      defaultLatex: 'E = mc^2',
    };
  },

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-latex') ?? '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex as string }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="equation"]' },
      // Backward compat with @tiptap/extension-mathematics
      { tag: 'div[data-type="block-math"]', priority: 60 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'equation' })];
  },

  addCommands() {
    return {
      setEquation:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex: attrs?.latex ?? this.options.defaultLatex },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EquationView);
  },

  addInputRules() {
    return [
      // Typing `$$content$$` (the closing `$` triggers) converts the paragraph
      // into a block equation. Fires only when the paragraph is exactly
      // `$$content$$` — mixed-line math is entered via the slash command.
      // Replaces the paragraph with [equation, empty-paragraph] so the cursor
      // has a valid home after the atom equation.
      new InputRule({
        find: /\$\$([^$\n]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const tr = state.tr;
          const equationType = state.schema.nodes.equation;
          const paragraphType = state.schema.nodes.paragraph;
          if (!equationType || !paragraphType) return null;

          const $start = state.doc.resolve(range.from);
          const para = $start.parent;
          if (para.type.name !== 'paragraph') return null;
          // Only convert when the whole paragraph is the `$$content$$` run.
          if (para.textContent !== match[0]) return null;

          const latex = (match[1] ?? '').trim();
          const paraStart = $start.before(1);
          const equationNode = equationType.create({ latex });
          const newPara = paragraphType.create();

          tr.replaceWith(paraStart, paraStart + para.nodeSize, [equationNode, newPara]);
          // Place the caret inside the new trailing paragraph.
          const caret = paraStart + equationNode.nodeSize + 1;
          tr.setSelection(TextSelection.create(tr.doc, caret));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      // Pasting `$$content$$` as a standalone paragraph converts it to a block
      // equation. Same scope as the InputRule (whole-paragraph match); mixed
      // inline `$$…$$` paste is left as text (use the slash command).
      new PasteRule({
        find: /\$\$([^$\n]+)\$\$/g,
        handler: ({ state, range, match }) => {
          const tr = state.tr;
          const equationType = state.schema.nodes.equation;
          const paragraphType = state.schema.nodes.paragraph;
          if (!equationType || !paragraphType) return null;

          const $start = state.doc.resolve(range.from);
          const para = $start.parent;
          if (para.type.name !== 'paragraph') return null;
          if (para.textContent !== match[0]) return null;

          const latex = (match[1] ?? '').trim();
          const paraStart = $start.before(1);
          const equationNode = equationType.create({ latex });
          const newPara = paragraphType.create();

          tr.replaceWith(paraStart, paraStart + para.nodeSize, [equationNode, newPara]);
          const caret = paraStart + equationNode.nodeSize + 1;
          tr.setSelection(TextSelection.create(tr.doc, caret));
        },
      }),
    ];
  },
});

/**
 * Server-side / headless fallback: render KaTeX to an HTML string.
 * Kept as an export in case the editor ever needs to render equations without React.
 */
export function renderKatex(latex: string, displayMode = true): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false });
  } catch {
    return latex;
  }
}
