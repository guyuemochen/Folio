/**
 * Registry of non-table view renderers. DatabaseView dispatches on
 * `view.type` — `table` is rendered inline (legacy, ~1700 lines, not moving
 * out in Phase 2); every other type maps to a component here OR, for
 * plugin-provided view types (`plugin:<pluginId>:<type>`), to
 * {@link PluginViewRenderer}.
 *
 * Add new BUILT-IN view types by creating `<Name>View.tsx` and registering it
 * in `VIEW_RENDERERS` below. Plugin view types don't need an entry here —
 * they're resolved at runtime from the plugin registry.
 */
import type { ViewConfig } from '../../../lib/types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';
import { PluginViewRenderer } from '../../../plugins/PluginViewRenderer';
import { parsePluginViewType } from '../../../plugins/store';
import type { ViewRenderer, ViewRendererProps } from './types';
import { BoardView } from './BoardView';
import { DashboardView } from './DashboardView';
import { GalleryView } from './GalleryView';
import { CalendarView } from './CalendarView';
import { ListView } from './ListView';
import { TimelineView } from './TimelineView';

/** Built-in renderers keyed by their built-in view type. Plugin view types
 *  (namespaced `plugin:…`) are NOT here — they're resolved at runtime. */
export const VIEW_RENDERERS: Partial<Record<string, ViewRenderer>> = {
  board: BoardView,
  dashboard: DashboardView,
  gallery: GalleryView,
  calendar: CalendarView,
  list: ListView,
  timeline: TimelineView,
};

/** True when a non-table renderer is registered for this type. `table` is
 *  always handled inline by DatabaseView and is NOT in this map. Plugin view
 *  types are always considered to have a renderer (resolved dynamically by
 *  {@link PluginViewRenderer}, which itself falls back to a placeholder when
 *  the plugin is missing). */
export function hasAltRenderer(type: ViewConfig['type']): boolean {
  if (type === 'table') return false;
  if (parsePluginViewType(type)) return true;
  return Object.prototype.hasOwnProperty.call(VIEW_RENDERERS, type);
}

/**
 * Dispatch component DatabaseView uses for any `view.type !== 'table'`.
 *  - Built-in types → looked up in `VIEW_RENDERERS`.
 *  - Plugin view types (`plugin:<pluginId>:<type>`) → {@link PluginViewRenderer},
 *    which resolves the contribution from the registry (with unavailable /
 *    disabled / error fallbacks).
 *  - Anything else unmapped → {@link ViewTypePlaceholder}.
 */
export function NonTableViewRenderer(props: ViewRendererProps) {
  // Plugin-provided view type → delegate to the plugin view renderer (it owns
  // the registry lookup + unavailable/crash handling).
  if (parsePluginViewType(props.view.type)) {
    return <PluginViewRenderer {...props} />;
  }
  const Renderer = VIEW_RENDERERS[props.view.type];
  if (!Renderer) return <ViewTypePlaceholder view={props.view} />;
  return <Renderer {...props} />;
}

export type { ViewRendererProps, ViewRenderer } from './types';
