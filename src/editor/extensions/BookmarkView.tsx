import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';

interface BookmarkNodeData {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  loading: boolean;
}

/**
 * React NodeView for the Bookmark card.
 *
 * Fetches OpenGraph metadata once on mount (best-effort — many sites CORS-block
 * the in-webview fetch, in which case we fall back to URL-only rendering).
 * Once metadata is in, it commits to node attrs via updateAttributes so it
 * persists.
 *
 * Click navigates to the URL in the system browser (handled by App).
 */
export function BookmarkView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as BookmarkNodeData;
  const fetchedRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(attrs.title);

  useEffect(() => {
    if (fetchedRef.current) return;
    if (!attrs.loading) return;
    fetchedRef.current = true;
    void fetchBookmarkMetadata(attrs.url).then((meta) => {
      updateAttributes({ ...meta, loading: false });
    });
  }, [attrs.url, attrs.loading, updateAttributes]);

  // Keep local draft in sync when external edits change the title.
  useEffect(() => {
    setDraftTitle(attrs.title);
  }, [attrs.title]);

  const open = () => {
    if (attrs.url) window.open(attrs.url, '_blank', 'noopener,noreferrer');
  };

  const commitTitle = () => {
    updateAttributes({ title: draftTitle });
    setEditing(false);
  };

  const host = safeHost(attrs.url);

  return (
    <NodeViewWrapper
      className="ln-bookmark-wrapper"
      as="div"
      data-selected={selected ? 'true' : 'false'}
    >
      <div
        className="ln-bookmark-card"
        contentEditable={false}
        onClick={open}
        title={attrs.url}
      >
        <div className="ln-bookmark-text">
          {editing ? (
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-full px-1.5 py-0.5 text-[14px] font-medium border border-accent/40 rounded outline-none bg-bg-page"
            />
          ) : (
            <div
              className="ln-bookmark-title"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              title="Double-click to edit title"
            >
              {attrs.title || attrs.url}
            </div>
          )}
          <div className="ln-bookmark-desc">
            {attrs.description || (attrs.loading ? 'Fetching link preview…' : host)}
          </div>
          <div className="ln-bookmark-meta">
            {attrs.favicon && (
              <img
                src={attrs.favicon}
                alt=""
                className="ln-bookmark-favicon"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <span className="ln-bookmark-host">{host}</span>
          </div>
        </div>
        {attrs.image && (
          <div
            className="ln-bookmark-image"
            style={{ backgroundImage: `url("${attrs.image}")` }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface FetchedMeta {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

/**
 * Best-effort OG metadata fetch. Many sites will CORS-block this in the webview;
 * on failure we return empty strings and the card falls back to URL-only view.
 */
async function fetchBookmarkMetadata(url: string): Promise<FetchedMeta> {
  if (!url) return {};
  try {
    const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return parseOg(html, url);
  } catch {
    // CORS or network failure — fall back to URL-derived info only.
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      // ignore
    }
    return {
      title: host,
      favicon: host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : '',
    };
  }
}

function parseOg(html: string, baseUrl: string): FetchedMeta {
  const pick = (regex: RegExp): string | undefined => {
    const m = html.match(regex);
    return m?.[1]?.trim() || undefined;
  };
  const ogTitle =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<title[^>]*>([^<]+)<\/title>/i);
  const ogDescription =
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  let favicon = pick(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  if (favicon && !/^https?:/i.test(favicon)) {
    try {
      favicon = new URL(favicon, baseUrl).toString();
    } catch {
      // ignore
    }
  }
  let absImage = ogImage;
  if (absImage && !/^https?:/i.test(absImage)) {
    try {
      absImage = new URL(absImage, baseUrl).toString();
    } catch {
      // ignore
    }
  }
  return {
    title: decodeHtmlEntities(ogTitle ?? ''),
    description: decodeHtmlEntities(ogDescription ?? ''),
    image: absImage ?? '',
    favicon: favicon ?? '',
  };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
