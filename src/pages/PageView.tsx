import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/invoke';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Editor } from '../editor/Editor';
import { DatabaseView } from '../components/database/DatabaseView';
import { RowPropertyPanel } from '../components/database/RowPropertyPanel';

/**
 * Single-page view. Routes by `page.type`:
 *   - 'database' → DatabaseView (Table)
 *   - 'page' with parentType='database' → standard editor + sticky RowPropertyPanel (Q5-B)
 *   - 'page' otherwise → standard editor only
 *
 * Title is inline-editable. Cover & icon picker are deferred.
 */
export function PageView({ pageId }: { pageId: string }) {
  const {
    data: pageData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['page', pageId],
    queryFn: () => api.getPage(pageId),
    enabled: !!pageId,
  });

  const renamePageLocally = useWorkspaceStore((s) => s.renamePageLocally);

  const [titleDraft, setTitleDraft] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (pageData) setTitleDraft(pageData.title);
  }, [pageData?.id, pageData?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [titleDraft]);

  if (isLoading) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-page mx-auto px-24 py-12 text-text-tertiary">Loading page…</div>
      </main>
    );
  }

  if (error || !pageData) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-page mx-auto px-24 py-12">
          <p className="text-status-red mb-2">Failed to load page.</p>
          <p className="text-sm text-text-tertiary">{String(error)}</p>
        </div>
      </main>
    );
  }

  const persistTitle = async () => {
    const next = titleDraft.trim();
    if (next === pageData.title) return;
    try {
      // For database rows with a `title` property, also push into the title cell.
      if (pageData.parentType === 'database') {
        const schema = await api.getDatabase(pageData.parentId!);
        const titleProp = schema.properties.find((p) => p.type === 'title');
        if (titleProp) {
          await api.updateCell({
            pageId: pageData.id,
            propertyId: titleProp.id,
            value: next,
          });
        }
      }
      await api.renamePage(pageData.id, next);
      renamePageLocally(pageData.id, next);
    } catch (err) {
      console.error('[Folio] title rename failed', err);
    }
  };

  const isDatabase = pageData.type === 'database';
  const isDatabaseRow = pageData.parentType === 'database';

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-page mx-auto px-20 py-10">
        {/* Icon */}
        <div className="mb-1.5 text-5xl leading-none select-none" aria-label="page icon">
          {pageData.icon ?? (isDatabase ? '🗃️' : '📄')}
        </div>

        {/* Title */}
        <textarea
          ref={titleRef}
          rows={1}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={persistTitle}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              persistTitle();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder={isDatabase ? 'Untitled database' : 'Untitled'}
          className="w-full text-h1 bg-transparent outline-none resize-none placeholder:text-text-tertiary/60 mb-1"
        />

        {/* Breadcrumb */}
        <div className="text-[12px] text-text-tertiary/80 mb-6 mt-1">
          {pageData.parentType === 'workspace'
            ? 'Workspace'
            : pageData.parentId
              ? `Sub-page of ${pageData.parentId.slice(0, 8)}…`
              : 'Workspace'}
          <span className="mx-1.5">·</span>
          <span>Last edited {new Date(pageData.updatedAt).toLocaleString()}</span>
        </div>

        {/* Content */}
        {isDatabase ? (
          <DatabaseView databaseId={pageData.id} />
        ) : (
          <>
            {isDatabaseRow && <RowPropertyPanel rowPageId={pageData.id} databaseId={pageData.parentId!} />}
            <Editor key={pageData.id} pageId={pageData.id} initialDoc={pageData.doc} />
          </>
        )}
      </div>
    </main>
  );
}
