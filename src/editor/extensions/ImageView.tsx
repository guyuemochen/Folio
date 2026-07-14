import { useRef, useState } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useTranslation } from 'react-i18next';

interface ImageNodeData {
  src: string | null;
  alt: string | null;
  title: string | null;
}

/**
 * React NodeView for the editor Image block.
 *
 * Two states:
 *   - Empty `src` → a dashed "booth" placeholder with an upload button.
 *     Clicking the booth (or button) opens the native file picker.
 *   - Non-empty `src` → the rendered `<img>` with a hover "change" button
 *     to replace the image.
 *
 * Uploaded files are read as base64 data URLs, consistent with the existing
 * smart-paste behavior in `Editor.tsx` (no backend round-trip needed).
 */
export function ImageView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const attrs = node.attrs as ImageNodeData;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const readFile = (file: File) => {
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      updateAttributes({ src: reader.result as string, alt: file.name });
      setBusy(false);
    };
    reader.onerror = () => {
      console.error('[Folio] image upload failed', reader.error);
      setBusy(false);
    };
    reader.readAsDataURL(file);
  };

  const triggerPick = () => {
    if (!busy) inputRef.current?.click();
  };

  return (
    <NodeViewWrapper
      className="ln-image-wrapper"
      as="div"
      data-selected={selected ? 'true' : 'false'}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="ln-image-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) readFile(file);
          // Reset so picking the same file again still fires onChange.
          e.target.value = '';
        }}
      />
      {attrs.src ? (
        <figure className="ln-image-figure" contentEditable={false}>
          <img
            src={attrs.src}
            alt={attrs.alt ?? ''}
            title={attrs.title ?? undefined}
            className="ln-image"
          />
          <div className="ln-image-toolbar">
            <button
              type="button"
              onClick={triggerPick}
              className="ln-image-btn"
              title={t('editor.imageChange')}
            >
              {busy ? '…' : t('editor.imageChange')}
            </button>
          </div>
        </figure>
      ) : (
        <div
          className="ln-image-booth"
          contentEditable={false}
          onClick={triggerPick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              triggerPick();
            }
          }}
        >
          <span className="ln-image-booth-icon" aria-hidden="true">🖼</span>
          <span className="ln-image-booth-hint">
            {busy ? '…' : t('editor.imageBoothHint')}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerPick();
            }}
            className="ln-image-btn ln-image-btn--accent"
          >
            {busy ? '…' : t('editor.imageUpload')}
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
