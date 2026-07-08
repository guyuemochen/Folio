import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { SubPageView } from './SubPageView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    subPage: {
      /** Insert an inline sub-page reference. */
      setSubPage: (attrs: { pageId: string; title: string; icon?: string | null }) => ReturnType;
    };
  }
}

export interface SubPageOptions {
  HTMLAttributes: Record<string, string>;
}

/**
 * Inline reference to a child page (Notion "sub-page" block).
 *
 * Stored as `{ pageId, title, icon }` so it survives doc persistence. The
 * React NodeView renders as a clickable chip — clicking dispatches
 * `folio:navigate-page` which App.tsx listens to (or fails silently if no
 * listener has been attached yet, which keeps M2 self-contained).
 */
export const SubPage = Node.create<SubPageOptions>({
  name: 'subPage',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-subpage' },
    };
  },

  addAttributes() {
    return {
      pageId: { default: '' },
      title: { default: 'Untitled' },
      icon: { default: '📄' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="subpage"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'subpage' })];
  },

  addCommands() {
    return {
      setSubPage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { pageId: attrs.pageId, title: attrs.title, icon: attrs.icon ?? '📄' },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageView);
  },
});
