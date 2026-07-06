import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { BookmarkView } from './BookmarkView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      /** Insert a bookmark card at the current selection. */
      setBookmark: (attrs: { url: string; title?: string; description?: string; image?: string; favicon?: string }) => ReturnType;
    };
  }
}

export interface BookmarkOptions {
  HTMLAttributes: Record<string, string>;
}

export interface BookmarkAttrs {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  /** True while OG metadata is being fetched (used for the loading UI). */
  loading: boolean;
}

/**
 * Link-preview card (Notion "bookmark"). Stored as a single URL plus the
 * OpenGraph metadata we managed to fetch (title/description/favicon/image).
 *
 * Metadata is fetched lazily inside BookmarkView; we deliberately accept that
 * some sites CORS-block the fetch in the Tauri webview, in which case the
 * card falls back to showing just the URL.
 */
export const Bookmark = Node.create<BookmarkOptions>({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-bookmark' },
    };
  },

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      image: { default: '' },
      favicon: { default: '' },
      loading: { default: true },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'bookmark' })];
  },

  addCommands() {
    return {
      setBookmark:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              url: attrs.url,
              title: attrs.title ?? '',
              description: attrs.description ?? '',
              image: attrs.image ?? '',
              favicon: attrs.favicon ?? '',
              loading: !attrs.title && !attrs.description,
            },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});
