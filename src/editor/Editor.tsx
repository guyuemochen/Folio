import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { ImageBlock } from './extensions/Image';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Typography from '@tiptap/extension-typography';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { EditorView } from '@tiptap/pm/view';
import { DOMParser as PmDOMParser } from '@tiptap/pm/model';

/** Editor-storage additions for our custom extensions (e.g. sub-page slash command). */
declare module '@tiptap/core' {
  interface Storage {
    folioPageId?: string;
  }
}

import { SlashCommand, type SlashState } from './extensions/SlashCommand';
import { Callout } from './extensions/Callout';
import { Toggle } from './extensions/Toggle';
import { Equation } from './extensions/Equation';
import { InlineMath } from './extensions/InlineMath';
import { Bookmark } from './extensions/Bookmark';
import { Embed } from './extensions/Embed';
import { Columns, Column } from './extensions/Column';
import { SubPage } from './extensions/SubPage';
import { KeyboardShortcuts } from './extensions/KeyboardShortcuts';

// Cross-milestone integration: linked-database node is owned by M4 but must be
// registered here (M2 owns Editor.tsx) per the integration contract documented
// in src/components/database/linkedDatabaseNode.ts.
import { linkedDatabaseNode } from '../components/database/linkedDatabaseNode';
import { openLinkedDatabasePicker } from '../components/database/LinkedDatabasePicker';

import { SlashMenu } from './components/SlashMenu';
import { BubbleToolbar } from './components/BubbleToolbar';
import { BlockDragHandle } from './components/BlockDragHandle';
import { FindBar } from './components/FindBar';
import { api } from '../lib/invoke';
import type { PageWithDoc } from '../lib/types';

interface EditorProps {
  pageId: string;
  /** Initial doc JSON string (from backend). */
  initialDoc: string;
  /** Called after the first content render — used by parent to clear "loading" state. */
  onReady?: () => void;
}

// === Lazy-loaded syntax highlighting (lowlight) =========================
// The lowlight engine + common grammars are ~500KB. They are only needed
// once the user creates a code block, so we defer loading until then
// (PRD §10.1: cold-start to input < 1.5s).
//
// TipTap's CodeBlockLowlight needs a synchronous reference at config time,
// so we hand it an empty placeholder; `ensureLowlight()` overlays the real
// instance in place via `Object.assign` once the dynamic import resolves.

/** Minimal structural contract for a lowlight instance. */
interface LowlightApi {
  highlight(language: string, value: string, options?: unknown): unknown;
  highlightAuto(value: string, options?: unknown): unknown;
  listLanguages(): string[];
  register(...args: unknown[]): void;
  registerAlias(...args: unknown[]): void;
  registered(aliasOrName: string): boolean;
}

const EMPTY_HAST_ROOT = { type: 'root', children: [], data: { language: '', relevance: 0 } };

const lowlightInstance: LowlightApi = {
  highlight: () => EMPTY_HAST_ROOT,
  highlightAuto: () => EMPTY_HAST_ROOT,
  listLanguages: () => [],
  register: () => {},
  registerAlias: () => {},
  registered: () => false,
};

let lowlightPromise: Promise<void> | null = null;

/**
 * Load the lowlight engine + common grammars and overlay them onto the shared
 * placeholder instance. Cached: the dynamic import only fires once.
 */
function ensureLowlight(): Promise<void> {
  if (!lowlightPromise) {
    lowlightPromise = import('lowlight').then(({ createLowlight, common }) => {
      Object.assign(lowlightInstance, createLowlight(common));
    });
  }
  return lowlightPromise;
}

/** True when `doc` contains a `codeBlock` node. */
function docHasCodeBlock(editor: TiptapEditor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock') {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Kick off lazy lowlight load (if not already started) and force a no-op
 * transaction once it lands so existing code blocks pick up highlighting.
 */
function triggerLowlightLoad(editor: TiptapEditor): void {
  if (lowlightPromise) return;
  void ensureLowlight().then(() => {
    if (!editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr);
    }
  });
}

/**
 * Page editor with Notion-like behavior (PRD §5.1):
 *   - 20+ block types via slash palette + TipTap extensions
 *   - Selection bubble toolbar (B/I/U/S/code/link)
 *   - Block drag handle (⋮⋮) with drop indicator + nested threshold + multi-select
 *   - Smart paste: URL → link, image binary → img, YouTube → embed, Markdown → blocks, HTML → cleaned blocks
 *   - In-page find bar (Mod+F)
 *   - Debounced 200ms persistence to SQLite via update_page_doc + doc-updated event
 */
export function Editor({ pageId, initialDoc, onReady }: EditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [slashState, setSlashState] = useState<SlashState>({
    active: false,
    query: '',
    anchor: null,
  });
  const [findOpen, setFindOpen] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);

  // Persistence state
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDocRef = useRef<string>(initialDoc);
  const pageIdRef = useRef<string>(pageId);
  // The latest doc that has not yet been flushed to the backend. Captured in
  // onUpdate so the unmount cleanup can fire a final save instead of silently
  // discarding the 200ms debounce timer (which loses linked-block filter /
  // sort / group changes when the user navigates to another page quickly).
  const pendingDocRef = useRef<string | null>(null);

  useEffect(() => {
    pageIdRef.current = pageId;
    // NOTE: do NOT reset lastSavedDocRef here. The baseline is established
    // in onCreate from `editor.getJSON()` (frontend-normalized serialization).
    // Resetting it to the raw `initialDoc` string (backend serde-serialized,
    // different key order / default attrs) would defeat the dedup check in
    // onUpdate and let an init-time normalization transaction overwrite the
    // persisted doc — see the import-disappears bug.
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

  const keyboardShortcutsOptions = useMemo(
    () => ({
      onOpenFind: () => setFindOpen(true),
      onOpenGlobalSearch: () => window.dispatchEvent(new CustomEvent('folio:open-search')),
    }),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Replace built-in CodeBlock with the lowlight-backed one (PRD §5.1.1).
        codeBlock: false,
        // v3: StarterKit bundles Link + Underline by default. Configure them
        // inline here instead of registering separate duplicates (which caused
        // "Duplicate extension names found: ['link', 'underline']" warnings and
        // schema/registration nondeterminism).
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      CodeBlockLowlight.configure({
        lowlight: lowlightInstance,
        HTMLAttributes: { class: 'ln-codeblock' },
      }),
      ImageBlock.configure({
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
        placeholder: t('editor.placeholder'),
      }),
      // === Tables (simple, not database) ===
      Table.configure({ HTMLAttributes: { class: 'ln-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      // === Custom block extensions ===
      Callout,
      Toggle,
      Equation,
      InlineMath,
      Bookmark,
      Embed,
      Columns,
      Column,
      SubPage,
      // === Cross-milestone: M4 linked-database block (PRD §5.3.8) ===
      linkedDatabaseNode,
      // === Slash palette detection + keyboard shortcuts ===
      SlashCommand.configure({ onChange: setSlashState }),
      KeyboardShortcuts.configure(keyboardShortcutsOptions),
    ],
    content: tryParseDoc(initialDoc),
    editorProps: {
      attributes: {
        class: 'prose-mirror',
        spellcheck: 'true',
        role: 'textbox',
        'aria-label': t('editor.regionLabel'),
        'aria-multiline': 'true',
      },
      handlePaste: (view, event) => handlePaste(view, event),
    },
    onCreate: (ctx) => {
      editorRef.current = ctx.editor;
      // Expose the current page id for slash commands that need it (sub-page creation).
      ctx.editor.storage.folioPageId = pageId;
      // Synchronize the dedup baseline with the editor's actual loaded state.
      // TipTap may dispatch a normalization/extension transaction right after
      // mount (see TipTap issues #4649, #2583, #4535), which fires onUpdate.
      // Without this, onUpdate would compare `JSON.stringify(editor.getJSON())`
      // (frontend-normalized) against `initialDoc` (backend serde-serialized —
      // different key order / default attrs), fail the dedup check, and
      // overwrite the persisted doc with a normalized/lossy version. This is
      // the root cause of imported Markdown content disappearing after
      // navigating away and back.
      lastSavedDocRef.current = JSON.stringify(ctx.editor.getJSON());
      onReady?.();
      // If the initial doc already contains code blocks, start loading the
      // highlighting grammars right away.
      if (docHasCodeBlock(ctx.editor)) {
        triggerLowlightLoad(ctx.editor);
      }
    },
    onTransaction: ({ editor: e, transaction }) => {
      // Lazy-load lowlight on first code-block creation.
      if (lowlightPromise) return;
      if (!transaction.docChanged) return;
      if (docHasCodeBlock(e)) {
        triggerLowlightLoad(e);
      }
    },
    onUpdate: ({ editor: e }) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      const doc = JSON.stringify(e.getJSON());
      if (doc === lastSavedDocRef.current) return;

      pendingDocRef.current = doc;
      saveTimerRef.current = setTimeout(async () => {
        const targetPageId = pageIdRef.current;
        try {
          await api.updatePageDoc(targetPageId, doc);
          lastSavedDocRef.current = doc;
          pendingDocRef.current = null;
          // Sync the React Query cache so a remount (navigate away + back)
          // shows the saved doc — without this, linked-block filter / sort
          // changes are lost because the Editor only reads initialDoc on
          // mount and never refreshes from the stale cache.
          queryClient.setQueryData<PageWithDoc>(['page', targetPageId], (old) =>
            old ? { ...old, doc } : old,
          );
          // PageView's DocUpdatedBridge listens to this for snapshot scheduling.
          window.dispatchEvent(
            new CustomEvent('folio:doc-updated', { detail: { pageId: targetPageId, doc } }),
          );
        } catch (err) {
          console.error('[Folio] failed to save page', targetPageId, err);
        }
      }, 200);
    },
  });

  // Sync pageId into editor storage when it changes.
  useEffect(() => {
    if (editor) {
      editor.storage.folioPageId = pageId;
    }
  }, [editor, pageId]);

  // Flush unsaved doc changes on unmount. Without this, the 200ms debounce
  // timer is simply discarded and the last edit (e.g. a linked-database
  // block's filter/sort change made via updateAttributes) is lost forever
  // when the user navigates to another page.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const doc = pendingDocRef.current;
      if (doc && doc !== lastSavedDocRef.current) {
        const targetPageId = pageIdRef.current;
        // Fire-and-forget: the component is unmounting, we cannot await.
        api.updatePageDoc(targetPageId, doc).then(() => {
          lastSavedDocRef.current = doc;
          // Sync the cache so the next mount of this page shows the saved doc.
          queryClient.setQueryData<PageWithDoc>(['page', targetPageId], (old) =>
            old ? { ...old, doc } : old,
          );
        }).catch((err) => {
          console.error('[Folio] failed to flush page save on unmount', targetPageId, err);
        });
      }
    };
  }, []);

  // Listen for folio:open-slash emitted by Mod-/ when there's no slash plugin
  // capturing it (e.g. when fired from outside the editor DOM).
  useEffect(() => {
    if (!editor) return;
    const onOpenSlash = () => {
      const { empty } = editor.state.selection;
      if (empty) {
        // Insert `/` at caret so the SlashCommand plugin opens the palette.
        editor.chain().focus().insertContent('/').run();
      }
    };
    window.addEventListener('folio:open-slash', onOpenSlash);
    return () => window.removeEventListener('folio:open-slash', onOpenSlash);
  }, [editor]);

  // Cross-milestone integration: the `/linked-database` slash command (owned by
  // M4 in slashCommands.ts) emits `folio:create-linked-database`. We open M4's
  // picker here (we own the editor instance), then insert the linkedDatabase
  // node on selection. PRD §5.3.8.
  useEffect(() => {
    if (!editor) return;
    const onCreateLinkedDatabase = async () => {
      const sourceDatabaseId = await openLinkedDatabasePicker();
      if (!sourceDatabaseId) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'linkedDatabase',
          attrs: {
            sourceDatabaseId,
            // Empty local view config — the linked block carries its own
            // filter/sort/group inline (independent of source db's views).
            viewConfig: { filter: null, sort: null, group: null, hiddenProperties: [], columnWidths: {} },
            sourceViewId: null,
          },
        })
        .run();
    };
    window.addEventListener('folio:create-linked-database', onCreateLinkedDatabase);
    return () =>
      window.removeEventListener('folio:create-linked-database', onCreateLinkedDatabase);
  }, [editor]);

  if (!editor) return null;

  return (
    <div ref={editorContainerRef} className="relative">
      <BubbleToolbar editor={editor} />
      <BlockDragHandle editor={editor} containerRef={editorContainerRef} />
      <EditorContent editor={editor} />

      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}

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

// === Smart paste (PRD §5.1.6) ===========================================

/**
 * Multi-format paste handler. Order matters:
 *   1. Shift+Paste → plain-text fallback
 *   2. Image binary → inline image node (M5 will upload)
 *   3. YouTube URL on empty paragraph → embed block
 *   4. Markdown text → blocks (parse via marked + DOMParser)
 *   5. URL on empty paragraph → link-wrapped text (existing behavior)
 *   6. Table HTML → simple table block (falls into the generic HTML path which
 *      preserves <table> thanks to our schema)
 *   7. Other HTML → strip styles, parse via ProseMirror DOMParser
 */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  // ClipboardEvent inherits from Event, not MouseEvent, so shiftKey isn't on
  // the static type — but it IS set in real browsers when shift was held.
  const shiftHeld = (event as Event & { shiftKey?: boolean }).shiftKey === true;
  const data = event.clipboardData;
  if (!data) return false;

  // 1. Shift+Paste → plain text.
  if (shiftHeld) {
    event.preventDefault();
    const text = data.getData('text/plain') ?? '';
    view.pasteText(text);
    return true;
  }

  // 2. Image binary.
  const items = data.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type.startsWith('image/')) {
      const file = it.getAsFile();
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

  const text = data.getData('text/plain') ?? '';
  const trimmed = text.trim();
  const html = data.getData('text/html') ?? '';

  const isEmptyParagraph =
    view.state.selection.empty &&
    view.state.doc.childCount === 1 &&
    view.state.doc.firstChild?.type.name === 'paragraph' &&
    view.state.doc.firstChild?.content.size === 0;

  // 3. YouTube URL on empty paragraph → embed.
  const yt = detectYouTubeEmbed(trimmed);
  if (yt && isEmptyParagraph) {
    event.preventDefault();
    const embed = view.state.schema.nodes.embed?.create({
      src: yt.embedUrl,
      provider: 'youtube',
    });
    if (embed) {
      view.dispatch(view.state.tr.replaceSelectionWith(embed));
      return true;
    }
  }

  // 4. Markdown text → blocks.
  if (trimmed && looksLikeMarkdown(trimmed)) {
    event.preventDefault();
    void insertMarkdownAsHtml(view, trimmed);
    return true;
  }

  // 5. URL → link (existing behavior).
  if (
    trimmed.length > 0 &&
    trimmed.length < 2048 &&
    /^https?:\/\/\S+$/i.test(trimmed) &&
    isEmptyParagraph
  ) {
    event.preventDefault();
    const schema = view.state.schema;
    const linkMark = schema.marks.link?.create({ href: trimmed });
    const textNode = linkMark ? schema.text(trimmed, [linkMark]) : null;
    if (textNode) {
      const paragraph = schema.nodes.paragraph.create(null, textNode);
      const tr = view.state.tr.replaceSelectionWith(paragraph);
      view.dispatch(tr);
      return true;
    }
  }

  // 6/7. Generic HTML (covers table HTML too) → strip styles + parse via PM DOMParser.
  if (html) {
    event.preventDefault();
    insertStrippedHtml(view, html);
    return true;
  }

  return false;
}

interface YtEmbed {
  embedUrl: string;
}

/** Detect YouTube URLs across the common shapes (watch?v=, youtu.be, /embed/, /v/). */
function detectYouTubeEmbed(url: string): YtEmbed | null {
  const re =
    /^(?:(?:https?:)?\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})(?:[?&]\S*)?$/;
  const m = re.exec(url.trim());
  if (!m) return null;
  return { embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}` };
}

/**
 * Heuristic: paste looks like Markdown when at least ~1/3 of non-blank lines
 * start with a Markdown block marker. Conservative — won't fire on prose.
 */
function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  let hits = 0;
  for (const line of lines) {
    if (
      /^#{1,6}\s+\S/.test(line) ||
      /^>\s+\S/.test(line) ||
      /^[-*+]\s+\S/.test(line) ||
      /^\d+\.\s+\S/.test(line) ||
      /^```/.test(line) ||
      /^\[(.+)\]\((.+)\)/.test(line) ||
      /^---+$/.test(line)
    ) {
      hits++;
    }
  }
  return hits >= 1 && hits >= Math.ceil(lines.length / 3);
}

async function insertMarkdownAsHtml(view: EditorView, md: string): Promise<void> {
  // marked → HTML, then parse with ProseMirror DOMParser to keep schema happy.
  // `marked` is loaded lazily — only the markdown-paste path needs it.
  const { marked } = await import('marked');
  const html = marked.parse(md, { async: false }) as string;
  insertStrippedHtml(view, html);
}

/**
 * Strip inline styles/classes from an HTML fragment and insert it as a
 * ProseMirror slice. Preserves structure (tables, lists, headings, code blocks).
 */
function insertStrippedHtml(view: EditorView, html: string) {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>('[style]').forEach((el) => el.removeAttribute('style'));
  container.querySelectorAll<HTMLElement>('[class]').forEach((el) => el.removeAttribute('class'));

  const parser = PmDOMParser.fromSchema(view.state.schema);
  const slice = parser.parseSlice(container);
  const tr = view.state.tr.replaceSelection(slice);
  view.dispatch(tr);
}
