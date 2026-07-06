import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { EmbedView } from './EmbedView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** Insert an embed iframe (YouTube / Vimeo / Figma / etc.) at the current selection. */
      setEmbed: (attrs: { src: string; provider?: string; caption?: string }) => ReturnType;
    };
  }
}

export interface EmbedOptions {
  HTMLAttributes: Record<string, string>;
  /**
   * Domains allowed for the iframe `src`. Other URLs are rejected to avoid
   * arbitrary iframe injection. Use hostname suffixes ("youtube.com" allows
   * "www.youtube.com", "m.youtube.com", etc.).
   */
  allowedDomains: string[];
}

/**
 * Embed block: a sandboxed iframe rendered via React NodeView.
 *
 * Provider detection + URL normalization lives in EmbedView so the iframe
 * `src` is rewritten for the embed endpoint of each known provider.
 */
export const Embed = Node.create<EmbedOptions>({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-embed' },
      allowedDomains: [
        'youtube.com',
        'youtu.be',
        'youtube-nocookie.com',
        'vimeo.com',
        'player.vimeo.com',
        'figma.com',
        'gist.github.com',
        'github.com',
        'codepen.io',
        'loom.com',
        'soundcloud.com',
        'spotify.com',
        'wikipedia.org',
        'docs.google.com',
      ],
    };
  },

  addAttributes() {
    return {
      src: { default: '' },
      provider: { default: '' },
      caption: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'embed' })];
  },

  addCommands() {
    return {
      setEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { src: attrs.src, provider: attrs.provider ?? '', caption: attrs.caption ?? '' },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
