import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Slash command extension for TipTap.
 *
 * Detects when the user types `/` at the start of an empty paragraph (or
 * after whitespace) and emits a callback so React can render the menu.
 *
 * The actual UI lives in `SlashMenu.tsx`; this extension only handles
 * detection and lifecycle.
 */

export interface SlashState {
  active: boolean;
  /** Current query (text typed after `/`). */
  query: string;
  /** Screen coordinates of the caret, for popover anchoring. */
  anchor: { top: number; left: number } | null;
}

export interface SlashCommandOptions {
  /** Called whenever slash state changes (open/close/query update). */
  onChange: (state: SlashState) => void;
}

const slashPluginKey = new PluginKey('slash-command');

/**
 * Compute the slash query from the text *after* the `/` on the current line.
 * Returns null if no active slash.
 */
function computeSlashState(
  doc: import('@tiptap/pm/model').Node,
  pos: number,
  coordsAtPos: (pos: number) => { left: number; top: number; right: number; bottom: number },
): SlashState {
  const $pos = doc.resolve(pos);
  const textFromLineStart = $pos.parent.textContent.slice(0, $pos.parentOffset);

  // Find the last `/` in the line. The query is whatever follows it.
  const slashIdx = textFromLineStart.lastIndexOf('/');
  if (slashIdx === -1) {
    return { active: false, query: '', anchor: null };
  }
  // `/` must be at start of line OR preceded by whitespace
  if (slashIdx > 0 && !/\s/.test(textFromLineStart[slashIdx - 1] ?? '')) {
    return { active: false, query: '', anchor: null };
  }
  // Query must contain no whitespace (closing on space is the standard UX)
  const query = textFromLineStart.slice(slashIdx + 1);
  if (/\s/.test(query)) {
    return { active: false, query: '', anchor: null };
  }

  // Coords of the caret for popover positioning
  const coords = coordsAtPos(pos);
  return {
    active: true,
    query,
    anchor: { top: coords.bottom + 6, left: coords.left },
  };
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      onChange: () => {},
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const onChange = this.options.onChange;

    return [
      new Plugin({
        key: slashPluginKey,
        state: {
          init: (): SlashState => ({ active: false, query: '', anchor: null }),
          apply(tr, _prev, _oldState, newState) {
            if (!tr.docChanged && !tr.selectionSet) {
              return computeSlashState(
                newState.doc,
                newState.selection.from,
                (p) => editor.view.coordsAtPos(p),
              );
            }
            return computeSlashState(
              newState.doc,
              newState.selection.from,
              (p) => editor.view.coordsAtPos(p),
            );
          },
        },
        view() {
          return {
            update: (view) => {
              const state = slashPluginKey.getState(view.state);
              if (state) onChange(state);
            },
          };
        },
      }),
    ];
  },
});
