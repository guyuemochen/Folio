import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageView } from './ImageView';

/**
 * Folio Image extension — wraps `@tiptap/extension-image` with a React
 * NodeView (`ImageView`) that renders an upload "booth" placeholder when
 * `src` is empty and a hover "change" button once an image is present.
 *
 * All stock configuration (`inline`, `allowBase64`, `HTMLAttributes`) still
 * flows through `.configure()`, so `Editor.tsx` usage is unchanged beyond the
 * import name.
 */
export const ImageBlock = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
