/**
 * Slash command catalog. Each entry describes one block type the user can
 * insert via the `/` menu.
 *
 * Source of truth: docs/prd/01-mvp-prd.md §5.1.1 + §5.1.2 + docs/research/02-notion-design-spec.md §5.3
 */

import type { Editor } from '@tiptap/core';
import { api } from '../lib/invoke';

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
  editor.chain().focus().deleteCurrentNode().setNode(type, attrs).run();
};

const clearSlashAndRun = (editor: Editor, fn: () => void) => {
  // Clear the slash text first so the menu doesn't linger, then defer the
  // action so the editor state settles before side effects (e.g. navigation).
  editor.chain().focus().deleteCurrentNode().run();
  setTimeout(fn, 0);
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // === Basic ==============================================================
  {
    key: 'paragraph',
    label: 'Text',
    description: 'Plain text paragraph',
    icon: '📝',
    aliases: ['text', 'paragraph', 'p', 'plain'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'paragraph'),
  },
  {
    key: 'heading1',
    label: 'Heading 1',
    description: 'Large section heading',
    icon: 'H₁',
    aliases: ['h1', 'heading1', 'title', 'big'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'heading', { level: 1 }),
  },
  {
    key: 'heading2',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H₂',
    aliases: ['h2', 'heading2', 'medium'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'heading', { level: 2 }),
  },
  {
    key: 'heading3',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: 'H₃',
    aliases: ['h3', 'heading3', 'small'],
    category: 'basic',
    apply: (editor) => setTextBlock(editor, 'heading', { level: 3 }),
  },
  {
    key: 'bullet-list',
    label: 'Bulleted list',
    description: 'Create a simple bulleted list',
    icon: '•',
    aliases: ['bullet', 'ul', 'list', 'unordered'],
    category: 'basic',
    apply: (editor) => editor.chain().focus().deleteCurrentNode().toggleBulletList().run(),
  },
  {
    key: 'numbered-list',
    label: 'Numbered list',
    description: 'Create a numbered list',
    icon: '1.',
    aliases: ['numbered', 'ol', 'ordered', 'list'],
    category: 'basic',
    apply: (editor) => editor.chain().focus().deleteCurrentNode().toggleOrderedList().run(),
  },
  {
    key: 'todo',
    label: 'To-do list',
    description: 'Track tasks with a checkbox',
    icon: '☐',
    aliases: ['todo', 'task', 'check', 'checklist', 'done'],
    category: 'basic',
    apply: (editor) => editor.chain().focus().deleteCurrentNode().toggleTaskList().run(),
  },
  {
    key: 'quote',
    label: 'Quote',
    description: 'Capture a quote',
    icon: '❝',
    aliases: ['quote', 'blockquote', 'citation'],
    category: 'basic',
    apply: (editor) => editor.chain().focus().deleteCurrentNode().toggleBlockquote().run(),
  },
  {
    key: 'callout',
    label: 'Callout',
    description: 'Boxed text with icon — make a point stand out',
    icon: '💡',
    aliases: ['callout', 'box', 'info', 'tip', 'note', 'highlight'],
    category: 'basic',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().setCallout().run();
    },
  },
  {
    key: 'toggle',
    label: 'Toggle',
    description: 'Collapsible section — hide content under a summary',
    icon: '▸',
    aliases: ['toggle', 'collapse', 'expand', 'details', 'accordion', 'spoiler'],
    category: 'basic',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().setToggle().run();
    },
  },
  {
    key: 'code',
    label: 'Code',
    description: 'Code block with syntax highlighting + language selector',
    icon: '</>',
    aliases: ['code', 'snippet', 'pre', 'mono', 'syntax'],
    category: 'basic',
    apply: (editor) => editor.chain().focus().deleteCurrentNode().toggleCodeBlock().run(),
  },
  {
    key: 'equation',
    label: 'Equation',
    description: 'Block math expression (KaTeX)',
    icon: '∑',
    aliases: ['equation', 'math', 'katex', 'latex', 'tex', 'formula'],
    category: 'basic',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().setEquation().run();
    },
  },
  {
    key: 'divider',
    label: 'Divider',
    description: 'Visually divide blocks',
    icon: '---',
    aliases: ['divider', 'hr', 'line', 'separator', 'rule'],
    category: 'basic',
    apply: (editor) => editor.chain().focus().deleteCurrentNode().setHorizontalRule().run(),
  },

  // === Database ===========================================================
  {
    key: 'database',
    label: 'Database',
    description: 'Create a full database (table/board/calendar) at the page root',
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
    label: 'Linked database',
    description: 'Reference an existing database as a linked view',
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
    label: 'Table',
    description: 'Simple table (3×3) — not a database',
    icon: '⊞',
    aliases: ['table', 'grid', 'matrix', 'cells', 'simple'],
    category: 'database',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },

  // === Media ==============================================================
  {
    key: 'image',
    label: 'Image',
    description: 'Embed or upload an image',
    icon: '🖼',
    aliases: ['image', 'img', 'picture', 'photo', 'upload'],
    category: 'media',
    apply: (editor) => {
      // Inline: prompt for URL (file upload hook deferred to M5).
      const url = window.prompt('Image URL:');
      if (url) {
        editor.chain().focus().deleteCurrentNode().setImage({ src: url.trim() }).run();
      } else {
        editor.chain().focus().deleteCurrentNode().run();
      }
    },
  },
  {
    key: 'bookmark',
    label: 'Bookmark',
    description: 'Web link with title + preview',
    icon: '🔖',
    aliases: ['bookmark', 'link', 'card', 'web', 'url', 'preview'],
    category: 'media',
    apply: (editor) => {
      const url = window.prompt('Paste link:');
      if (!url) {
        editor.chain().focus().deleteCurrentNode().run();
        return;
      }
      editor.chain().focus().deleteCurrentNode().setBookmark({ url: url.trim() }).run();
    },
  },
  {
    key: 'embed',
    label: 'Embed',
    description: 'Embed YouTube / Vimeo / Figma / CodePen / etc.',
    icon: '🎬',
    aliases: ['embed', 'iframe', 'youtube', 'vimeo', 'figma', 'video'],
    category: 'media',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().setEmbed({ src: '' }).run();
    },
  },

  // === Advanced ===========================================================
  {
    key: 'column',
    label: 'Column',
    description: 'Two-column layout side-by-side',
    icon: '⫴',
    aliases: ['column', 'columns', 'split', 'two-column', 'layout'],
    category: 'advanced',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().setColumns().run();
    },
  },
  {
    key: 'sub-page',
    label: 'Sub-page',
    description: 'Create a new child page and link to it inline',
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
        editor.chain().focus().setSubPage({ pageId: page.id, title: page.title || 'Untitled', icon: page.icon }).run();
      } catch (err) {
        console.error('[Folio] slash: sub-page creation failed', err);
        window.dispatchEvent(
          new CustomEvent('folio:toast', { detail: 'Could not create sub-page' }),
        );
        editor.chain().focus().deleteCurrentNode().run();
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
