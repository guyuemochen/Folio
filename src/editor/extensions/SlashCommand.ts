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
 * Internal plugin state — pure data derived from doc + selection.
 *
 * NOTE: This intentionally does NOT carry `anchor` coordinates. Reading
 * DOM coordinates (`view.coordsAtPos`) during `Plugin.apply` is illegal:
 * at that moment the view still reflects the OLD state, so positions from
 * `newState.selection` may point past the old doc's end and throw
 * `RangeError: Position N out of range`. Coordinates are computed later
 * in `view().update`, where the view is in sync with the new state.
 */
interface InternalSlashState {
  active: boolean;
  query: string;
  /** Doc position of the caret; coords resolved at view-update time. */
  pos: number;
}

/**
 * Compute the slash query from the text *after* the `/` on the current line.
 * Returns inactive state if no active slash.
 */
function computeSlashState(
  doc: import('@tiptap/pm/model').Node,
  pos: number,
): InternalSlashState {
  const $pos = doc.resolve(pos);
  const textFromLineStart = $pos.parent.textContent.slice(0, $pos.parentOffset);

  // Find the last `/` in the line. The query is whatever follows it.
  const slashIdx = textFromLineStart.lastIndexOf('/');
  if (slashIdx === -1) {
    return { active: false, query: '', pos };
  }
  // `/` must be at start of line OR preceded by whitespace
  if (slashIdx > 0 && !/\s/.test(textFromLineStart[slashIdx - 1] ?? '')) {
    return { active: false, query: '', pos };
  }
  // Query must contain no whitespace (closing on space is the standard UX)
  const query = textFromLineStart.slice(slashIdx + 1);
  if (/\s/.test(query)) {
    return { active: false, query: '', pos };
  }
  return { active: true, query, pos };
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      onChange: () => {},
    };
  },

  addProseMirrorPlugins() {
    const onChange = this.options.onChange;

    return [
      new Plugin({
        key: slashPluginKey,
        state: {
          init: (): InternalSlashState => ({ active: false, query: '', pos: 0 }),
          apply(_tr, _prev, _oldState, newState) {
            // Pure data only — NO `view.coordsAtPos` here. See InternalSlashState.
            return computeSlashState(newState.doc, newState.selection.from);
          },
        },
        view() {
          return {
            update: (view) => {
              const internal = slashPluginKey.getState(view.state) as
                | InternalSlashState
                | undefined;
              if (!internal) return;

              // The view is now in sync with `view.state`, so positions are
              // valid. Still guard against any race (concurrent transactions,
              // external state swaps) so a transient bad position never throws
              // out of the plugin cycle and crashes the editor.
              let anchor: { top: number; left: number } | null = null;
              if (internal.active) {
                try {
                  const maxPos = view.state.doc.content.size;
                  const pos = Math.max(0, Math.min(internal.pos, maxPos));
                  const coords = view.coordsAtPos(pos);
                  anchor = { top: coords.bottom + 6, left: coords.left };
                } catch {
                  anchor = null;
                }
              }
              onChange({ active: internal.active, query: internal.query, anchor });
            },
          };
        },
      }),
    ];
  },
});
