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

/** Built-in widget kinds only (the closed set this file knows about).
 *
 *  NOTE: deliberately NOT derived from `DashboardComponent['type']` anymore.
 *  The persistence union now also has a `'plugin'` variant, but plugins are
 *  open-ended (loaded at runtime from disk) so they cannot live in the
 *  static `WIDGET_KIND_INFO` record or the `defaultComponentFor` switch.
 *  Plugin widgets take a separate code path:
 *    - `defaultComponentForPlugin(manifest)` builds their initial config.
 *    - `AddWidgetMenu` lists them under a separate "Plugins" section.
 *    - `renderWidgetBody` handles `'plugin'` via `PluginWidgetRenderer`.
 */
export type WidgetKind = 'stat' | 'recent_rows';

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

/** Default grid footprint for a plugin widget whose contribution omits
 *  `defaultLayout` (and whose manifest omits it too). Picked to fit both
 *  compact stat-style and small list-style plugins without dominating the
 *  dashboard. */
const PLUGIN_DEFAULT_LAYOUT = { w: 6, h: 6, minW: 2, minH: 2 } as const;

/** Input shape for {@link defaultComponentForPlugin}. Mirrors the relevant
 *  fields of a loaded widget contribution + the plugin manifest (so callers
 *  can pass either without pulling SDK types into this persistence-shape
 *  file). Resolution order for each field: contribution → manifest. */
export interface PluginWidgetSpec {
  pluginId: string;
  /** Contribution id within the plugin. Written to the persisted component's
   *  `widgetId` so the renderer can pick the right widget from a unified
   *  plugin. Omitted here only for legacy single-widget plugins (normalized
   *  to `'default'` by the loader). */
  widgetId?: string;
  /** Per-contribution default grid footprint; falls back to `manifestLayout`. */
  defaultLayout?: {
    w: number;
    h: number;
    minW?: number;
    maxW?: number;
    minH?: number;
    maxH?: number;
  };
  /** Manifest-level default grid footprint (used when the contribution omits
   *  its own). */
  manifestLayout?: {
    w: number;
    h: number;
    minW?: number;
    maxW?: number;
    minH?: number;
    maxH?: number;
  };
}

/** Build a fresh plugin component + matching layout item, honouring the
 *  widget contribution's `defaultLayout` (then the manifest's) when present.
 *
 *  The persisted component carries both `pluginId` and `widgetId` so a unified
 *  plugin with multiple widgets can be disambiguated at render time. */
export function defaultComponentForPlugin(spec: PluginWidgetSpec): {
  component: DashboardComponent;
  layout: DashboardLayoutItem;
} {
  const widgetId = genWidgetId();
  const dl = spec.defaultLayout ?? spec.manifestLayout;
  const w = dl?.w ?? PLUGIN_DEFAULT_LAYOUT.w;
  const h = dl?.h ?? PLUGIN_DEFAULT_LAYOUT.h;
  return {
    component: {
      id: widgetId,
      type: 'plugin',
      pluginId: spec.pluginId,
      // Persist the contribution id when it's meaningful (i.e. not the
      // 'default' shorthand the loader synthesizes for legacy plugins —
      // leaving it undefined keeps old dashboards byte-compatible).
      widgetId: spec.widgetId && spec.widgetId !== 'default' ? spec.widgetId : undefined,
      // Title intentionally left undefined so the renderer falls back to
      // the contribution's / manifest's `name`. Users can override via the
      // widget header (once header editing ships; for now this stays opaque).
      title: undefined,
      config: undefined,
    },
    layout: {
      i: widgetId,
      x: 0,
      y: Infinity, // RGL convention: place at the bottom of the grid
      w,
      h,
      minW: dl?.minW ?? PLUGIN_DEFAULT_LAYOUT.minW,
      minH: dl?.minH ?? PLUGIN_DEFAULT_LAYOUT.minH,
      maxW: dl?.maxW,
      maxH: dl?.maxH,
    },
  };
}
