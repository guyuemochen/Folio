import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

interface BubbleToolbarProps {
  editor: Editor;
}

/**
 * Selection bubble toolbar — appears above the current text selection.
 *
 * TipTap 3 removed the `<BubbleMenu>` React component, so we render this
 * manually by listening to editor transactions and computing the popover
 * rectangle from the ProseMirror selection coords.
 */
export function BubbleToolbar({ editor }: BubbleToolbarProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isEditable) {
        if (!showLinkInput) setRect(null);
        return;
      }
      const startCoords = editor.view.coordsAtPos(from);
      const endCoords = editor.view.coordsAtPos(to);
      const next = new DOMRect(
        Math.min(startCoords.left, endCoords.left),
        Math.min(startCoords.top, endCoords.top),
        Math.abs(endCoords.right - startCoords.left),
        Math.max(startCoords.bottom, endCoords.bottom) -
          Math.min(startCoords.top, endCoords.top),
      );
      setRect(next);
    };

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', () => {
      if (!showLinkInput) setRect(null);
    });
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('focus', update);
    };
  }, [editor, showLinkInput]);

  useEffect(() => {
    if (editor.isActive('link')) {
      const attrs = editor.getAttributes('link') as { href?: string };
      setLinkUrl(attrs.href ?? '');
    } else {
      setLinkUrl('');
      setShowLinkInput(false);
    }
  }, [editor.state.selection.from, editor.state.selection.to, editor]);

  const applyLink = () => {
    const trimmed = linkUrl.trim();
    if (trimmed) {
      editor.chain().focus().setLink({ href: trimmed }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setShowLinkInput(false);
  };

  if (!rect) return null;

  const centerX = rect.left + rect.width / 2;
  const top = rect.top - 8;

  return (
    <div
      className="fixed z-[1500] -translate-x-1/2 -translate-y-full"
      style={{ left: centerX, top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-border-hairline bg-bg-page shadow-popover">
        <ToolButton
          title="Bold (Ctrl+B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong className="text-[13px]">B</strong>
        </ToolButton>
        <ToolButton
          title="Italic (Ctrl+I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em className="text-[13px]">I</em>
        </ToolButton>
        <ToolButton
          title="Underline (Ctrl+U)"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span className="text-[13px] underline">U</span>
        </ToolButton>
        <ToolButton
          title="Strikethrough (Ctrl+Shift+S)"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <span className="text-[13px] line-through">S</span>
        </ToolButton>
        <div className="w-px h-4 bg-border-hairline mx-0.5" />
        <ToolButton
          title="Code (Ctrl+E)"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <code className="text-[11px]">{'</>'}</code>
        </ToolButton>
        <ToolButton
          title="Link (Ctrl+K)"
          active={editor.isActive('link')}
          onClick={() => setShowLinkInput((v) => !v)}
        >
          <span className="text-[13px]">🔗</span>
        </ToolButton>

        {showLinkInput && (
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                setShowLinkInput(false);
              }
            }}
            onBlur={applyLink}
            placeholder="https://"
            className="ml-1 w-48 px-2 py-0.5 text-[12px] border border-border-hairline rounded outline-none focus:border-accent bg-bg-page"
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        'w-6 h-6 flex items-center justify-center rounded text-[13px] transition-colors',
        active ? 'bg-bg-active text-accent' : 'text-text-primary hover:bg-bg-hover',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
