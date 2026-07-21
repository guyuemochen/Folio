/**
 * Registry of non-table view renderers. DatabaseView dispatches on
 * `view.type` — `table` is rendered inline (legacy, ~1700 lines, not moving
 * out in Phase 2); every other type maps to a component here.
 *
 * Add new view types by creating `<Name>View.tsx` and registering it below.
 * The dispatcher falls back to <ViewTypePlaceholder> for any unmapped type
 * (which currently means all of them until the Phase 2 parallel tasks land).
 */
import type { ViewConfig } from '../../../lib/types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';
import type { ViewRenderer, ViewRendererProps } from './types';
import { BoardView } from './BoardView';
import { DashboardView } from './DashboardView';
import { GalleryView } from './GalleryView';
import { CalendarView } from './CalendarView';
import { ListView } from './ListView';
import { TimelineView } from './TimelineView';

export const VIEW_RENDERERS: Partial<Record<ViewConfig['type'], ViewRenderer>> = {
  board: BoardView,
  dashboard: DashboardView,
  gallery: GalleryView,
  calendar: CalendarView,
  list: ListView,
  timeline: TimelineView,
};

/** True when a non-table renderer is registered for this type. `table` is
 *  always handled inline by DatabaseView and is NOT in this map. */
export function hasAltRenderer(type: ViewConfig['type']): boolean {
  return type !== 'table' && Object.prototype.hasOwnProperty.call(VIEW_RENDERERS, type);
}

/**
 * Dispatch component DatabaseView uses for any `view.type !== 'table'`.
 * Looks up the renderer in `VIEW_RENDERERS`; falls back to the placeholder
 * if no renderer is registered yet (so stubs ship safely).
 */
export function NonTableViewRenderer(props: ViewRendererProps) {
  const Renderer = VIEW_RENDERERS[props.view.type];
  if (!Renderer) return <ViewTypePlaceholder view={props.view} />;
  return <Renderer {...props} />;
}

export type { ViewRendererProps, ViewRenderer } from './types';
