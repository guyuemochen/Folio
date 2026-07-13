import { Node, mergeAttributes, InputRule, PasteRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { InlineMathView } from './InlineMathView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineMath: {
      /** Insert an inline KaTeX math expression at the current selection. */
      setInlineMath: (attrs?: { latex?: string }) => ReturnType;
    };
  }
}

export interface InlineMathOptions {
  HTMLAttributes: Record<string, string>;
  defaultLatex: string;
}

/**
 * Inline KaTeX math (Notion "inline equation" / LaTeX `$...$` inline math).
 *
 * - Stored as a single `latex` string attribute.
 * - Rendered via a React NodeView (InlineMathView) so KaTeX actually paints
 *   inside a line of text.
 * - An `addInputRules()` hook converts `$...$` typed delimiters into this
 *   node automatically (see the end of this file).
 *
 * Mirrors Equation (block) but with `group:'inline'` + `inline:true`, the
 * same pattern SubPage uses for inline atoms.
 */
export const InlineMath = Node.create<InlineMathOptions>({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-inlinemath' },
      defaultLatex: 'x^2',
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
      { tag: 'span[data-type="inlineMath"]' },
      // NOTE: external KaTeX HTML (`.katex`) round-trips through the Rust HTML
      // importer (annotation extraction), not here — matching it in the editor
      // would produce empty-latex nodes since `data-latex` is absent.
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'inlineMath' })];
  },

  addCommands() {
    return {
      setInlineMath:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex: attrs?.latex ?? this.options.defaultLatex },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },

  addInputRules() {
    return [
      // Typing `$content$` (the closing `$` triggers) converts the run into an
      // inline math node. The negative lookbehind prevents matching `$$…$$`
      // (the block-math prefix handled by Equation); `[^$\n]+` ensures a lone
      // `$` like "costs $5" never matches (no closing `$` on the same line).
      new InputRule({
        find: /(?<!\$)\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const tr = state.tr;
          const latex = match[1] ?? '';
          const node = state.schema.nodes.inlineMath?.create({ latex });
          if (!node) return null;
          tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      // Pasting `$content$` converts each match to an inline math node.
      // `(?<!\S)` requires the opening `$` at a word boundary (start or after
      // whitespace) and `[^\s$\n]+` requires space-free content — together
      // these avoid false positives like "costs $5 or $10".
      new PasteRule({
        find: /(?<!\S)\$([^\s$\n]+)\$/g,
        handler: ({ state, range, match }) => {
          const tr = state.tr;
          const latex = match[1] ?? '';
          const node = state.schema.nodes.inlineMath?.create({ latex });
          if (!node) return null;
          tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});
