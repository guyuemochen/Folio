import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Insert a new collapsible toggle at the current selection. */
      setToggle: () => ReturnType;
      /** Lift the toggle's children out and remove the toggle wrapper. */
      unsetToggle: () => ReturnType;
      /** Toggle the open/collapsed state of the toggle containing the selection. */
      toggleToggleOpen: () => ReturnType;
    };
  }
}

export interface ToggleOptions {
  HTMLAttributes: Record<string, string>;
}

export const toggleClickPluginKey = new PluginKey('toggle-click');

/**
 * Collapsible block (Notion "toggle" / HTML `<details><summary>`).
 *
 * Content model: `block+` — the first child is the always-visible summary,
 * subsequent children are body blocks hidden when `data-open="false"`.
 *
 * The chevron is a pure-CSS `::before` on the toggle. A single delegated
 * click handler (attached via addProseMirrorPlugins) flips the `open` attr
 * when the user clicks the chevron area or the summary block.
 */
export const Toggle = Node.create<ToggleOptions>({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: { class: 'ln-toggle' },
    };
  },

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => (el.getAttribute('data-open') ?? 'true') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': String(attrs.open as boolean) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'toggle' }), 0];
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Toggle' }] },
              { type: 'paragraph' },
            ],
          }),
      unsetToggle:
        () =>
        ({ chain }) =>
          // `lift` is TipTap's built-in: pops the current block out of its parent.
          chain().lift(this.name).run(),
      toggleToggleOpen:
        () =>
        ({ state, dispatch, tr }) => {
          const $pos = state.selection.$from;
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === this.name) {
              const from = $pos.before(d);
              if (dispatch) {
                tr.setNodeMarkup(from, undefined, { ...node.attrs, open: !node.attrs.open });
                dispatch(tr);
              }
              return true;
            }
          }
          return false;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: toggleClickPluginKey,
        view: () => ({
          init: () => {
            // Defer to next tick so the editor DOM exists.
            queueMicrotask(() => {
              const dom = editor.view.dom as HTMLElement;
              const handler = (e: MouseEvent) => {
                const target = e.target as HTMLElement | null;
                if (!target) return;
                const toggle = target.closest('.ln-toggle') as HTMLElement | null;
                if (!toggle) return;
                const rect = toggle.getBoundingClientRect();
                const isChevronArea = e.clientX - rect.left < 28;
                const summary = toggle.firstElementChild;
                const isInSummary = !!(summary && summary.contains(target));
                if (!isChevronArea && !isInSummary) return;
                e.preventDefault();
                e.stopPropagation();
                editor.commands.toggleToggleOpen();
              };
              dom.addEventListener('click', handler, true);
            });
          },
          destroy: () => {
            // The editor's view.dom is destroyed by TipTap itself; nothing to clean.
          },
        }),
      }),
    ];
  },
});
