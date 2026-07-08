import { useState } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';

interface EmbedNodeData {
  src: string;
  provider: string;
  caption: string;
}

/**
 * React NodeView for the Embed block.
 *
 * Behavior:
 *   - Empty src → show an inline form to paste a URL.
 *   - Known provider → rewrite URL to embed endpoint (e.g. youtube.com/watch?v=… → youtube-nocookie.com/embed/…).
 *   - Unknown but allow-listed → render iframe as-is.
 *   - Unknown + disallowed → show an "Unsupported embed" hint.
 *
 * The iframe is sandboxed to the minimum needed for video/widgets.
 */
export function EmbedView({ node, updateAttributes, selected, extension }: ReactNodeViewProps) {
  const attrs = node.attrs as EmbedNodeData;
  const allowedDomains = (extension.options as { allowedDomains?: string[] }).allowedDomains ?? [];
  const [draft, setDraft] = useState(attrs.src);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const detected = detectProvider(trimmed);
    const embedUrl = normalizeEmbedUrl(trimmed, detected);
    if (!isAllowed(embedUrl, allowedDomains)) {
      window.dispatchEvent(
        new CustomEvent('folio:toast', { detail: `Embeds from ${safeHost(embedUrl)} are not allowed` }),
      );
      return;
    }
    updateAttributes({ src: embedUrl, provider: detected });
  };

  const open = () => {
    if (attrs.src) window.open(attrs.src, '_blank', 'noopener,noreferrer');
  };

  return (
    <NodeViewWrapper
      className="ln-embed-wrapper"
      as="div"
      data-selected={selected ? 'true' : 'false'}
      data-provider={attrs.provider || 'unknown'}
    >
      {!attrs.src ? (
        <div className="ln-embed-input-row" contentEditable={false}>
          <input
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="Paste a YouTube, Vimeo, Figma, or CodePen URL…"
            className="flex-1 px-3 py-2 text-[13px] border border-border-hairline rounded-md outline-none focus:border-accent bg-bg-page"
          />
          <button
            type="button"
            onClick={commit}
            className="px-3 py-2 text-[13px] rounded-md bg-accent hover:bg-accent-hover text-white"
          >
            Embed
          </button>
        </div>
      ) : (
        <div className="ln-embed-card" contentEditable={false}>
          <iframe
            src={attrs.src}
            title={attrs.caption || `Embed from ${attrs.provider || 'external'}`}
            className="ln-embed-iframe"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
          <button
            type="button"
            onClick={open}
            className="ln-embed-open"
            title="Open original"
          >
            ↗
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

type Provider = 'youtube' | 'vimeo' | 'figma' | 'codepen' | 'gist' | 'loom' | 'spotify' | 'soundcloud' | '';

function detectProvider(url: string): Provider {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('vimeo.com')) return 'vimeo';
  if (host.includes('figma.com')) return 'figma';
  if (host.includes('codepen.io')) return 'codepen';
  if (host.includes('gist.github.com') || host.includes('github.com')) return 'gist';
  if (host.includes('loom.com')) return 'loom';
  if (host.includes('spotify.com')) return 'spotify';
  if (host.includes('soundcloud.com')) return 'soundcloud';
  return '';
}

function normalizeEmbedUrl(url: string, provider: Provider): string {
  try {
    const u = new URL(url);
    switch (provider) {
      case 'youtube': {
        // Watch URL → embed
        const v = u.searchParams.get('v');
        if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
        if (u.pathname.startsWith('/embed/')) return u.toString();
        // youtu.be/<id>
        const id = u.pathname.replace(/^\//, '');
        return `https://www.youtube-nocookie.com/embed/${id}`;
      }
      case 'vimeo': {
        // vimeo.com/<id> → player.vimeo.com/video/<id>
        const m = u.pathname.match(/\/(\d+)/);
        if (m) return `https://player.vimeo.com/video/${m[1]}`;
        return u.toString();
      }
      case 'figma': {
        // Already embeddable via figma.com/embed?embed_host=share&url=…
        return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.toString())}`;
      }
      case 'codepen': {
        // codepen.io/<user>/pen/<id> → codepen.io/<user>/embed/<id>
        const m = u.pathname.match(/\/([^/]+)\/pen\/([^/]+)/);
        if (m) return `https://codepen.io/${m[1]}/embed/${m[2]}`;
        return u.toString();
      }
      case 'gist': {
        // gist URL already works as iframe src in our sandbox
        return u.toString();
      }
      default:
        return u.toString();
    }
  } catch {
    return url;
  }
}

function isAllowed(url: string, allowedDomains: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedDomains.some((d) => host === d || host.endsWith('.' + d));
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
