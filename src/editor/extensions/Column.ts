import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Insert a 2-column layout with the current selection in the left column. */
      setColumns: () => ReturnType;
      /** Remove a column layout, lifting its children out. */
      unsetColumns: () => ReturnType;
    };
  }
}

export interface ColumnsOptions {
  HTMLAttributes: Record<string, string>;
}

/**
 * Two-column layout wrapper (Notion "column" MVP).
 *
 * Content model:
 *   columns   := column{2}     (exactly 2)
 *   column    := block+        (arbitrary blocks)
 *
 * MVP: fixed to two columns. PRD allows for "multi-column layout" but the
 * acceptance test is "drag block beside another → blue vertical line → release
 * creates 2-column layout".
 *
 * Adding/removing columns is intentionally out of MVP scope — drag-drop column
 * reshaping is the M5+ drag-handle work.
 */
export const Columns = Node.create<ColumnsOptions>({
  name: 'columns',
  group: 'block',
  content: 'column{2}',
  defining: true,
  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-columns' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'columns' }), 0];
  },

  addCommands() {
    return {
      setColumns:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              { type: 'column', content: [{ type: 'paragraph' }] },
              { type: 'column', content: [{ type: 'paragraph' }] },
            ],
          }),
      unsetColumns:
        () =>
        ({ chain }) =>
          chain().lift(this.name).run(),
    };
  },
});

/**
 * A single column inside a `columns` block. Bare block container.
 */
export const Column = Node.create({
  name: 'column',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'ln-column' }), 0];
  },
});
