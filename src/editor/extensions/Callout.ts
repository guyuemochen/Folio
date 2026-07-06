import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current selection in a callout. */
      setCallout: (attrs?: { variant?: string; icon?: string }) => ReturnType;
    };
  }
}

export interface CalloutOptions {
  HTMLAttributes: Record<string, string>;
  defaultVariant: string;
  defaultIcon: string;
}

/**
 * Notion-style callout box: colored background + leading icon + free text.
 *
 * Variants map to the 9 Notion semantic colors (see globals.css `.ln-callout[data-variant="…"]`).
 */
export const Callout = Node.create<CalloutOptions>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-callout' },
      defaultVariant: 'blue',
      defaultIcon: '💡',
    };
  },

  addAttributes() {
    return {
      variant: {
        default: this.options.defaultVariant,
        parseHTML: (el) => el.getAttribute('data-variant') ?? this.options.defaultVariant,
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant as string }),
      },
      icon: {
        default: this.options.defaultIcon,
        parseHTML: (el) => el.getAttribute('data-icon') ?? this.options.defaultIcon,
        renderHTML: (attrs) => ({ 'data-icon': attrs.icon as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...this.options.HTMLAttributes, ...HTMLAttributes, 'data-type': 'callout' }, 0];
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands, state }) => {
          // If the current block is an empty textblock, replace it with a fresh
          // callout (otherwise wrapIn would create an empty paragraph the callout
          // wraps, but the user expects the callout itself to be editable).
          const { selection } = state;
          const $from = selection.$from;
          const parent = $from.parent;
          if (
            selection.empty &&
            parent.isTextblock &&
            parent.content.size === 0 &&
            parent.type.name !== this.name
          ) {
            return commands.insertContent({
              type: this.name,
              attrs: attrs ?? {},
              content: [{ type: 'paragraph' }],
            });
          }
          // Otherwise wrap the current selection.
          return commands.wrapIn(this.name, attrs ?? {});
        },
    };
  },
});
