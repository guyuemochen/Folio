/**
 * Slash command catalog. Each entry describes one block type the user can
 * insert via the `/` menu.
 *
 * Source of truth: docs/prd/01-mvp-prd.md §5.1.2 + docs/research/02-notion-design-spec.md §5.3
 */

import type { Editor } from '@tiptap/core';

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
  /** Category for grouping in the menu UI. */
  category: 'basic' | 'list' | 'advanced';
  /** Apply the command to the given editor at the current selection. */
  apply: (editor: Editor) => void;
}

const setTextBlock = (editor: Editor, type: string, attrs?: Record<string, unknown>) => {
  editor.chain().focus().deleteCurrentNode().setNode(type, attrs).run();
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
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
    category: 'list',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().toggleBulletList().run();
    },
  },
  {
    key: 'numbered-list',
    label: 'Numbered list',
    description: 'Create a numbered list',
    icon: '1.',
    aliases: ['numbered', 'ol', 'ordered', 'list'],
    category: 'list',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().toggleOrderedList().run();
    },
  },
  {
    key: 'todo',
    label: 'To-do list',
    description: 'Track tasks with a checkbox',
    icon: '☐',
    aliases: ['todo', 'task', 'check', 'checklist', 'done'],
    category: 'list',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().toggleTaskList().run();
    },
  },
  {
    key: 'quote',
    label: 'Quote',
    description: 'Capture a quote',
    icon: '❝',
    aliases: ['quote', 'blockquote', 'citation'],
    category: 'basic',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().toggleBlockquote().run();
    },
  },
  {
    key: 'code',
    label: 'Code',
    description: 'Capture a code snippet',
    icon: '</>',
    aliases: ['code', 'snippet', 'pre', 'mono'],
    category: 'advanced',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().toggleCodeBlock().run();
    },
  },
  {
    key: 'divider',
    label: 'Divider',
    description: 'Visually divide blocks',
    icon: '---',
    aliases: ['divider', 'hr', 'line', 'separator', 'rule'],
    category: 'advanced',
    apply: (editor) => {
      editor.chain().focus().deleteCurrentNode().setHorizontalRule().run();
    },
  },
  {
    key: 'database',
    label: 'Database',
    description: 'Create a table database (in workspace root)',
    icon: '📊',
    aliases: ['database', 'table', 'db', 'grid', 'spreadsheet'],
    category: 'advanced',
    apply: (editor) => {
      // Clear the slash text first, then defer to global event so App.tsx
      // can call api.createDatabase + navigate.
      editor.chain().focus().deleteCurrentNode().run();
      // Use setTimeout to ensure the editor state settles before navigation
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('folio:create-database'));
      }, 0);
    },
  },
];

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

/** Filter commands by query across key/label/aliases. */
export function filterCommands(query: string): SlashCommandDef[] {
  if (!query) return SLASH_COMMANDS;
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => {
    if (fuzzyMatch(q, cmd.key)) return true;
    if (fuzzyMatch(q, cmd.label)) return true;
    return cmd.aliases.some((a) => fuzzyMatch(q, a));
  });
}
