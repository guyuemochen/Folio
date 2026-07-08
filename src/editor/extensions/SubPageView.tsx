import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';

interface SubPageNodeData {
  pageId: string;
  title: string;
  icon: string;
}

/**
 * Inline chip rendering a sub-page reference. Clicking dispatches
 * `folio:navigate-page` with the page id; App.tsx or PageView may listen.
 */
export function SubPageView({ node }: ReactNodeViewProps) {
  const attrs = node.attrs as SubPageNodeData;
  const navigate = () => {
    if (attrs.pageId) {
      window.dispatchEvent(new CustomEvent('folio:navigate-page', { detail: attrs.pageId }));
    }
  };
  return (
    <NodeViewWrapper
      className="ln-subpage-wrapper"
      as="span"
      contentEditable={false}
    >
      <button
        type="button"
        onClick={navigate}
        className="ln-subpage-chip"
        title={`Open ${attrs.title}`}
        contentEditable={false}
      >
        <span className="ln-subpage-icon">{attrs.icon || '📄'}</span>
        <span className="ln-subpage-title">{attrs.title || 'Untitled'}</span>
      </button>
    </NodeViewWrapper>
  );
}
