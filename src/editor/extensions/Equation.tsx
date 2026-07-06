import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
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
