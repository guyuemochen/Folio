/**
 * Slash command catalog. Each entry describes one block type the user can
 * insert via the `/` menu.
 *
 * Source of truth: docs/prd/01-mvp-prd.md §5.1.1 + §5.1.2 + docs/research/02-notion-design-spec.md §5.3
 */

import type { Editor } from '@tiptap/core';
import { api } from '../lib/invoke';
import i18n from '../i18n/config';

/**
 * Slash menu tab. Drives the visible filter on the slash palette (PRD §5.1.2).
 *
 * - `all`       — every category, grouped (default)
 * - `basic`     — text blocks (paragraph/heading/quote/callout/toggle/list/todo/code/divider/equation)
 * - `database`  — `/database`, `/linked-database`, `/table`
 * - `media`     — image / bookmark / embed
 * - `advanced`  — column / sub-page
 */
export type SlashTab = 'all' | 'basic' | 'database' | 'media' | 'advanced';

export interface SlashCommandDef {
  /** Canonical key — fuzzy match against this + aliases. */
  key: string;
  /** Display title in the menu. */
  label: string;
  /** Short description shown next to the title. */
  description: string;
  /** Emoji or short text icon. */
  icon: string;
  /** Keywords used for fuzzy search. */
  aliases: string[];
  /** Category for grouping in the menu UI. Drives tab filter. */
  category: 'basic' | 'database' | 'media' | 'advanced';
  /** Apply the command to the given editor at the current selection. */
  apply: (editor: Editor) => void;
}

/** localStorage persistence key for the "Recent 5 block types" section. */
export const SLASH_RECENT_KEY = 'folio:slash-recent';
export const SLASH_RECENT_MAX = 5;

const setTextBlock = (editor: Editor, type: string, attrs?: Record<string, unknown>) => {
  clearSlashText(editor).setNode(type, attrs).run();
};

const clearSlashAndRun = (editor: Editor, fn: () => void) => {
  // Clear the slash text first so the menu doesn't linger, then defer the
  // action so the editor state settles before side effects (e.g. navigation).
  clearSlashText(editor).run();
  setTimeout(fn, 0);
};

/**
 * Start a command chain by clearing the current textblock's text content.
 *
 * This replaces `deleteCurrentNode()`, which in TipTap v3 only operates on
 * EMPTY nodes (it returns `false` when `content.size > 0`). When the
 * paragraph contains the typed `/query` text, v3's `deleteCurrentNode`
 * silently fails, leaving the slash text behind after a command is applied.
 *
 * Returns a ChainedCommands so callers can continue the chain
 * (`.setNode(...).run()`, `.toggleBulletList().run()`, etc.).
 */
const clearSlashText = (editor: Editor) => {
  const { from } = editor.state.selection;
  const $from = editor.state.doc.resolve(from);
  return editor.chain().focus().deleteRange({ from: $from.start(), to: $from.end() });
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // === Basic ==============================================================
  {
    key: 'paragraph',
    label: i18n.t('editor.slashText'),
    description: i18n.t('editor.slashTextDesc'),
    icon: '📝',
    aliases: ['text', 'paragraph', 'p', 'plain'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'paragraph'),
  },
  {
    key: 'heading1',
    label: i18n.t('editor.slashHeading1'),
    description: i18n.t('editor.slashHeading1Desc'),
    icon: 'H₁',
    aliases: ['h1', 'heading1', 'title', 'big'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'heading', { level: 1 }),
  },
  {
    key: 'heading2',
    label: i18n.t('editor.slashHeading2'),
    description: i18n.t('editor.slashHeading2Desc'),
    icon: 'H₂',
    aliases: ['h2', 'heading2', 'medium'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'heading', { level: 2 }),
  },
  {
    key: 'heading3',
    label: i18n.t('editor.slashHeading3'),
    description: i18n.t('editor.slashHeading3Desc'),
    icon: 'H₃',
    aliases: ['h3', 'heading3', 'small'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'heading', { level: 3 }),
  },
  {
    key: 'bullet-list',
    label: i18n.t('editor.slashBulletedList'),
    description: i18n.t('editor.slashBulletedListDesc'),
    icon: '•',
    aliases: ['bullet', 'ul', 'list', 'unordered'],
    category: 'basic',
    apply: (editor) => clearSlashText(editor).toggleBulletList().run(),
  },
  {
    key: 'numbered-list',
    label: i18n.t('editor.slashNumberedList'),
    description: i18n.t('editor.slashNumberedListDesc'),
    icon: '1.',
    aliases: ['numbered', 'ol', 'ordered', 'list'],
    category: 'basic',
    apply: (editor) => clearSlashText(editor).toggleOrderedList().run(),
  },
  {
    key: 'todo',
    label: i18n.t('editor.slashTodoList'),
    description: i18n.t('editor.slashTodoListDesc'),
    icon: '☐',
    aliases: ['todo', 'task', 'check', 'checklist', 'done'],
    category: 'basic',
    apply: (editor) => clearSlashText(editor).toggleTaskList().run(),
  },
  {
    key: 'quote',
    label: i18n.t('editor.slashQuote'),
    description: i18n.t('editor.slashQuoteDesc'),
    icon: '❝',
    aliases: ['quote', 'blockquote', 'citation'],
    category: 'basic',
    apply: (editor) => clearSlashText(editor).toggleBlockquote().run(),
  },
  {
    key: 'callout',
    label: i18n.t('editor.slashCallout'),
    description: i18n.t('editor.slashCalloutDesc'),
    icon: '💡',
    aliases: ['callout', 'box', 'info', 'tip', 'note', 'highlight'],
    category: 'basic',
    apply: (editor) => {
      clearSlashText(editor).setCallout().run();
    },
  },
  {
    key: 'toggle',
    label: i18n.t('editor.slashToggle'),
    description: i18n.t('editor.slashToggleDesc'),
    icon: '▸',
    aliases: ['toggle', 'collapse', 'expand', 'details', 'accordion', 'spoiler'],
    category: 'basic',
    apply: (editor) => {
      clearSlashText(editor).setToggle().run();
    },
  },
  {
    key: 'code',
    label: i18n.t('editor.slashCode'),
    description: i18n.t('editor.slashCodeDesc'),
    icon: '</>',
    aliases: ['code', 'snippet', 'pre', 'mono', 'syntax'],
    category: 'basic',
    apply: (editor) => clearSlashText(editor).toggleCodeBlock().run(),
  },
  {
    key: 'equation',
    label: i18n.t('editor.slashEquation'),
    description: i18n.t('editor.slashEquationDesc'),
    icon: '∑',
    aliases: ['equation', 'math', 'katex', 'latex', 'tex', 'formula'],
    category: 'basic',
    apply: (editor) => {
      clearSlashText(editor).setEquation().run();
    },
  },
  {
    key: 'inline-math',
    label: i18n.t('editor.slashInlineMath'),
    description: i18n.t('editor.slashInlineMathDesc'),
    icon: 'ƒ',
    aliases: ['inline-math', 'inline', 'inlinemath', 'inline-equation', 'tex-inline', 'imath'],
    category: 'basic',
    apply: (editor) => {
      clearSlashText(editor).setInlineMath().run();
    },
  },
  {
    key: 'divider',
    label: i18n.t('editor.slashDivider'),
    description: i18n.t('editor.slashDividerDesc'),
    icon: '---',
    aliases: ['divider', 'hr', 'line', 'separator', 'rule'],
    category: 'basic',
    apply: (editor) => clearSlashText(editor).setHorizontalRule().run(),
  },

  // === Database ===========================================================
  {
    key: 'database',
    label: i18n.t('editor.slashDatabase'),
    description: i18n.t('editor.slashDatabaseDesc'),
    icon: '📊',
    aliases: ['database', 'table', 'db', 'grid', 'spreadsheet'],
    category: 'database',
    apply: (editor) =>
      clearSlashAndRun(editor, () => {
        window.dispatchEvent(new CustomEvent('folio:create-database'));
      }),
  },
  {
    key: 'linked-database',
    label: i18n.t('editor.slashLinkedDatabase'),
    description: i18n.t('editor.slashLinkedDatabaseDesc'),
    icon: '🔗',
    aliases: ['linked', 'linked-database', 'link', 'reference'],
    category: 'database',
    apply: (editor) =>
      clearSlashAndRun(editor, () => {
        window.dispatchEvent(new CustomEvent('folio:create-linked-database'));
      }),
  },
  {
    key: 'simple-table',
    label: i18n.t('editor.slashTable'),
    description: i18n.t('editor.slashTableDesc'),
    icon: '⊞',
    aliases: ['table', 'grid', 'matrix', 'cells', 'simple'],
    category: 'database',
    apply: (editor) => {
      clearSlashText(editor).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },

  // === Media ==============================================================
  {
    key: 'image',
    label: i18n.t('editor.slashImage'),
    description: i18n.t('editor.slashImageDesc'),
    icon: '🖼',
    aliases: ['image', 'img', 'picture', 'photo', 'upload'],
    category: 'media',
    apply: (editor) => {
      // Insert an empty image node — the NodeView renders an upload "booth"
      // placeholder. The user uploads (or replaces) via the booth button.
      clearSlashText(editor).setImage({ src: '' }).run();
    },
  },
  {
    key: 'bookmark',
    label: i18n.t('editor.slashBookmark'),
    description: i18n.t('editor.slashBookmarkDesc'),
    icon: '🔖',
    aliases: ['bookmark', 'link', 'card', 'web', 'url', 'preview'],
    category: 'media',
    apply: (editor) => {
      const url = window.prompt(i18n.t('editor.pasteLinkPrompt'));
      if (!url) {
        clearSlashText(editor).run();
        return;
      }
      clearSlashText(editor).setBookmark({ url: url.trim() }).run();
    },
  },
  {
    key: 'embed',
    label: i18n.t('editor.slashEmbed'),
    description: i18n.t('editor.slashEmbedDesc'),
    icon: '🎬',
    aliases: ['embed', 'iframe', 'youtube', 'vimeo', 'figma', 'video'],
    category: 'media',
    apply: (editor) => {
      clearSlashText(editor).setEmbed({ src: '' }).run();
    },
  },

  // === Advanced ===========================================================
  {
    key: 'column',
    label: i18n.t('editor.slashColumn'),
    description: i18n.t('editor.slashColumnDesc'),
    icon: '⫴',
    aliases: ['column', 'columns', 'split', 'two-column', 'layout'],
    category: 'advanced',
    apply: (editor) => {
      clearSlashText(editor).setColumns().run();
    },
  },
  {
    key: 'sub-page',
    label: i18n.t('editor.slashSubpage'),
    description: i18n.t('editor.slashSubpageDesc'),
    icon: '📄',
    aliases: ['subpage', 'sub-page', 'child', 'page', 'link-page'],
    category: 'advanced',
    apply: async (editor) => {
      const parentIdAttr = (editor.storage as { folioPageId?: string }).folioPageId;
      const parentId = parentIdAttr ?? null;
      try {
        const page = await api.createPage(
          parentId ? { parentId, parentType: 'page', title: 'Untitled' } : { parentType: 'workspace', title: 'Untitled' },
        );
        clearSlashText(editor).setSubPage({ pageId: page.id, title: page.title || 'Untitled', icon: page.icon }).run();
      } catch (err) {
        console.error('[Folio] slash: sub-page creation failed', err);
        window.dispatchEvent(
          new CustomEvent('folio:toast', { detail: i18n.t('editor.subpageCreateFailed') }),
        );
        clearSlashText(editor).run();
      }
    },
  },
];

/**
 * Read the persisted recent-block-types list (most-recent first, max 5).
 */
export function loadSlashRecent(): string[] {
  try {
    const raw = localStorage.getItem(SLASH_RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return (parsed as string[]).slice(0, SLASH_RECENT_MAX);
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Add a command key to the recent list, dedupe, cap at 5, persist.
 * Returns the new list (most-recent first).
 */
export function recordSlashRecent(key: string): string[] {
  const next = [key, ...loadSlashRecent().filter((k) => k !== key)].slice(0, SLASH_RECENT_MAX);
  try {
    localStorage.setItem(SLASH_RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return next;
}

/** Simple fuzzy filter: matches if every char of `query` appears in order in `target`. */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Filter commands by query across key/label/aliases.
 * If `tab` is set (and not 'all'), only commands of that category are returned.
 */
export function filterCommands(query: string, tab: SlashTab = 'all'): SlashCommandDef[] {
  const base = tab === 'all' ? SLASH_COMMANDS : SLASH_COMMANDS.filter((c) => c.category === tab);
  if (!query) return base;
  const q = query.toLowerCase();
  return base.filter((cmd) => {
    if (fuzzyMatch(q, cmd.key)) return true;
    if (fuzzyMatch(q, cmd.label)) return true;
    return cmd.aliases.some((a) => fuzzyMatch(q, a));
  });
}

/** Resolve a recent-keys array to actual command defs (skipping missing keys). */
export function recentCommands(keys: string[]): SlashCommandDef[] {
  return keys
    .map((k) => SLASH_COMMANDS.find((c) => c.key === k))
    .filter((c): c is SlashCommandDef => !!c);
}
