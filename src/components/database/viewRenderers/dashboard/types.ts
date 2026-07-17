/**
 * Internal helpers and defaults for the dashboard view renderer.
 *
 * Public types (`DashboardConfig`, `DashboardComponent`, `DashboardLayoutItem`)
 * live in `src/lib/types.ts` so they're on the persistence contract.
 * This file owns renderer-only concerns: id generation, widget-kind metadata,
 * and translating between our config shape and react-grid-layout's `Layout`.
 */
import type {
  DashboardComponent,
  DashboardConfig,
  DashboardLayoutItem,
} from '../../../../lib/types';

/** All widget kinds the renderer knows how to instantiate. Adding a new
 *  kind requires (a) a branch in `defaultComponentFor` and (b) a matching
 *  case in `DashboardView`'s render switch. */
export type WidgetKind = DashboardComponent['type'];

/** Per-kind metadata for the "Add widget" picker: label, description,
 *  default geometry. Centralised here so the picker and the renderer agree
 *  on what each kind looks like. */
export const WIDGET_KIND_INFO: Record<
  WidgetKind,
  {
    /** i18n key under `database.dashboard.*` for the picker title. */
    titleKey: string;
    /** i18n key for the one-line description shown under the title. */
    descriptionKey: string;
    /** Default grid footprint (RGL units; 12 columns wide grid). */
    defaultW: number;
    defaultH: number;
    minW: number;
    minH: number;
  }
> = {
  stat: {
    titleKey: 'database.dashboard.stat',
    descriptionKey: 'database.dashboard.statDescription',
    defaultW: 3,
    defaultH: 4,
    minW: 2,
    minH: 3,
  },
  recent_rows: {
    titleKey: 'database.dashboard.recentRows',
    descriptionKey: 'database.dashboard.recentRowsDescription',
    defaultW: 6,
    defaultH: 8,
    minW: 3,
    minH: 4,
  },
};

/** Random id for a new widget. Uses `crypto.randomUUID` when available,
 *  falls back to a time+random string for older webviews. */
export function genWidgetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a fresh component + matching layout item for the given kind, with
 *  sensible defaults. The position is chosen by auto-placement (RGL fills
 *  gaps); we just emit an `{i}` placeholder that RGL will position on the
 *  first render — but we still set x/y=0,w/h=defaults so a brand-new
 *  dashboard with no existing layout doesn't all stack at (0,0). */
export function defaultComponentFor(kind: WidgetKind): {
  component: DashboardComponent;
  layout: DashboardLayoutItem;
} {
  const id = genWidgetId();
  const info = WIDGET_KIND_INFO[kind];
  switch (kind) {
    case 'stat':
      return {
        component: { id, type: 'stat', title: '', filter: null },
        layout: {
          i: id,
          x: 0,
          y: Infinity, // RGL convention: place at the bottom of the grid
          w: info.defaultW,
          h: info.defaultH,
          minW: info.minW,
          minH: info.minH,
        },
      };
    case 'recent_rows':
      return {
        component: {
          id,
          type: 'recent_rows',
          title: '',
          filter: null,
          sort: null,
          limit: 10,
        },
        layout: {
          i: id,
          x: 0,
          y: Infinity,
          w: info.defaultW,
          h: info.defaultH,
          minW: info.minW,
          minH: info.minH,
        },
      };
  }
}

/** Helper for tests / storybook: an empty (but valid) dashboard config. */
export function emptyDashboardConfig(): DashboardConfig {
  return { components: [], layout: [] };
}
