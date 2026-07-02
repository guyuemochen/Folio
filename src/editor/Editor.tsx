import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Typography from '@tiptap/extension-typography';

import { SlashCommand, type SlashState } from './extensions/SlashCommand';
import { SlashMenu } from './components/SlashMenu';
import { BubbleToolbar } from './components/BubbleToolbar';
import { BlockDragHandle } from './components/BlockDragHandle';
import { api } from '../lib/invoke';

interface EditorProps {
  pageId: string;
  /** Initial doc JSON string (from backend). */
  initialDoc: string;
  /** Called after the first content render — used by parent to clear "loading" state. */
  onReady?: () => void;
}

/**
 * Page editor with Notion-like behavior:
 *   - Slash command palette (10 block types) via custom extension
 *   - Selection bubble toolbar (B/I/U/S/code/link)
 *   - Block drag handle (⋮⋮) on left edge: hover-aware, click for menu, drag to move
 *   - Smart paste: URL → bookmark, image binary → placeholder, Markdown auto
 *   - Debounced 200ms persistence to SQLite via update_page_doc
 */
export function Editor({ pageId, initialDoc, onReady }: EditorProps) {
  const [slashState, setSlashState] = useState<SlashState>({
    active: false,
    query: '',
    anchor: null,
  });
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Persistence state
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDocRef = useRef<string>(initialDoc);
  const pageIdRef = useRef<string>(pageId);

  // Track which page we're saving to (in case the prop changes)
  useEffect(() => {
    pageIdRef.current = pageId;
    lastSavedDocRef.current = initialDoc;
  }, [pageId, initialDoc]);

  const handleSlashClose = (editor: TiptapEditor) => {
    const { from } = editor.state.selection;
    const lineStart = from - (slashState.query.length + 1);
    if (lineStart >= 0) {
      editor.chain().focus().deleteRange({ from: lineStart, to: from }).run();
    } else {
      editor.chain().focus().run();
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'ln-codeblock' } },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'ln-image' },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      Placeholder.configure({
        placeholder: "Press '/' for commands, or just start typing...",
      }),
      SlashCommand.configure({ onChange: setSlashState }),
    ],
    content: tryParseDoc(initialDoc),
    editorProps: {
      attributes: {
        class: 'prose-mirror',
        spellcheck: 'true',
      },
      handlePaste: (view, event) => {
        // Shift+Paste → plain-text fallback (Notion behavior).
        const shiftHeld = (event as Event & { shiftKey?: boolean }).shiftKey === true;
        const data = event.clipboardData;
        if (!data) return false;

        if (shiftHeld) {
          event.preventDefault();
          const text = data.getData('text/plain') ?? '';
          view.pasteText(text);
          return true;
        }

        // Image binary paste → insert placeholder (M5+ will upload).
        const items = data.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                const schema = view.state.schema;
                const imageNode = schema.nodes.image?.create({ src: dataUrl, alt: file.name });
                if (imageNode) {
                  const tr = view.state.tr.replaceSelectionWith(imageNode);
                  view.dispatch(tr);
                }
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
        }

        // URL-only paste into an empty paragraph → wrap as link on the
        // inserted text (closest to "URL → bookmark" without OG fetching yet).
        const text = data.getData('text/plain') ?? '';
        const trimmed = text.trim();
        const isEmptyParagraph =
          view.state.selection.empty &&
          view.state.doc.childCount === 1 &&
          view.state.doc.firstChild?.type.name === 'paragraph' &&
          view.state.doc.firstChild?.content.size === 0;
        if (
          trimmed.length > 0 &&
          trimmed.length < 2048 &&
          /^https?:\/\/\S+$/i.test(trimmed) &&
          isEmptyParagraph
        ) {
          event.preventDefault();
          const schema = view.state.schema;
          const textNode = schema.text(trimmed, [
            schema.marks.link?.create({ href: trimmed }),
          ].filter(Boolean));
          if (textNode) {
            const paragraph = schema.nodes.paragraph.create(null, textNode);
            const tr = view.state.tr.replaceSelectionWith(paragraph);
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },
    onCreate: () => {
      onReady?.();
    },
    onUpdate: ({ editor: e }) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      const doc = JSON.stringify(e.getJSON());
      if (doc === lastSavedDocRef.current) return;

      saveTimerRef.current = setTimeout(async () => {
        const targetPageId = pageIdRef.current;
        try {
          await api.updatePageDoc(targetPageId, doc);
          lastSavedDocRef.current = doc;
        } catch (err) {
          console.error('[Folio] failed to save page', targetPageId, err);
        }
      }, 200);
    },
  });

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  if (!editor) return null;

  return (
    <div ref={editorContainerRef} className="relative">
      <BubbleToolbar editor={editor} />
      <BlockDragHandle editor={editor} containerRef={editorContainerRef} />
      <EditorContent editor={editor} />

      {slashState.active && slashState.anchor && (
        <SlashMenu
          editor={editor}
          query={slashState.query}
          anchor={slashState.anchor}
          onClose={() => handleSlashClose(editor)}
        />
      )}
    </div>
  );
}

function tryParseDoc(initialDoc: string): Record<string, unknown> {
  try {
    return JSON.parse(initialDoc);
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
}
