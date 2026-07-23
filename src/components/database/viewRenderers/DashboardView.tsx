import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactGridLayout, {
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout';
import type {
  DashboardComponent,
  DashboardConfig,
  DashboardLayoutItem,
  DatabaseRow,
} from '../../../lib/types';
import type { ViewRendererProps } from './types';
import { useVisibleRows } from './shared';
import { AddWidgetMenu } from './dashboard/AddWidgetMenu';
import { StatWidget } from './dashboard/StatWidget';
import { RecentRowsWidget } from './dashboard/RecentRowsWidget';
import {
  defaultComponentFor,
  defaultComponentForPlugin,
  emptyDashboardConfig,
  type WidgetKind,
} from './dashboard/types';
import {
  DashboardPluginContext,
  PluginWidgetRenderer,
} from '../../../plugins/PluginWidgetRenderer';
import { PluginManagerModal } from '../../../plugins/PluginManagerModal';
import { usePluginRegistry } from '../../../plugins/store';

// React Grid Layout v2 ships its own CSS — imported once here so callers
// don't have to remember. Vite handles the CSS import as a side effect.
// Note: v2 docs still mention `react-resizable/css/styles.css` but that's
// stale — v2's package.json only exports `./css/styles.css`, and resize
// handle styles are inlined.
import 'react-grid-layout/css/styles.css';

// ============================================================================
// Dashboard view
// ----------------------------------------------------------------------------
// A grid of widgets over the database's rows. Layout + widget configs are
// persisted in `view.dashboard`. The renderer:
//   1. Reads `view.dashboard` (or seeds an empty config on first paint).
//   2. Renders each component inside a `<GridLayout>` cell that the user
//      can drag (reorder) and resize (corner handle).
//   3. Mutates the config through `onChangeDashboard` whenever the user
//      adds / removes / moves / resizes a widget.
//
// MVP scope (see chat decision): two widget kinds (stat + recent_rows), no
// in-widget configuration UI (filter / property picker). The closed loop
// is: add → drag → resize → remove → persists across view switches.
// ============================================================================

/** Grid column count — RGL default. Resizable enough for stat + table. */
const GRID_COLS_COUNT = 12;
/** Pixel height of one grid row. Picked to give stat cards a sensible
 *  default height (~4 rows ≈ 176px) without too much vertical drift. */
const GRID_ROW_HEIGHT = 42;

export function DashboardView({
  view,
  schema,
  rows,
  onOpenRow,
  onChangeDashboard,
}: ViewRendererProps) {
  const visibleRows = useVisibleRows(rows, view);
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  // Config is read from view.dashboard. We never mutate view directly; we
  // build a next-state and hand it to onChangeDashboard.
  const config: DashboardConfig = view.dashboard ?? emptyDashboardConfig();

  // ---------------------------------------------------------------------------
  // Mutators — all build a fresh DashboardConfig and pass it to the parent.
  // Each one is wrapped in useCallback so ReactGridLayout's onLayoutChange
  // (which closes over them) doesn't thrash.
  // ---------------------------------------------------------------------------

  function persist(next: DashboardConfig) {
    onChangeDashboard?.(next);
  }

  function handleAdd(kind: WidgetKind) {
    const { component, layout } = defaultComponentFor(kind);
    persist({
      components: [...config.components, component],
      layout: [...config.layout, layout],
    });
    setAddAnchor(null);
  }

  /** Pick a widget from the AddWidgetMenu → look up the plugin + the specific
   *  widget contribution in the registry, build a fresh
   *  `{ type: 'plugin', pluginId, widgetId, … }` widget + grid layout
   *  (honouring the contribution's `defaultLayout`, then the manifest's),
   *  persist. A unified plugin can ship several widgets, hence the
   *  `(pluginId, widgetId)` pair. */
  function handleAddPlugin(pluginId: string, widgetId: string) {
    const plugin = usePluginRegistry.getState().plugins[pluginId];
    if (!plugin) {
      // Shouldn't happen — menu only lists enabled plugins — but guard
      // against a race where the plugin unloaded between menu open and pick.
      setAddAnchor(null);
      return;
    }
    const contribution = plugin.contributions.widgets?.find(
      (w) => (w.id ?? 'default') === widgetId,
    );
    if (!contribution) {
      setAddAnchor(null);
      return;
    }
    const { component, layout } = defaultComponentForPlugin({
      pluginId,
      widgetId,
      defaultLayout: contribution.defaultLayout,
      manifestLayout: plugin.manifest.defaultLayout,
    });
    persist({
      components: [...config.components, component],
      layout: [...config.layout, layout],
    });
    setAddAnchor(null);
  }

  function handleRemove(id: string) {
    persist({
      components: config.components.filter((c) => c.id !== id),
      layout: config.layout.filter((l) => l.i !== id),
    });
  }

  /**
   * RGL fires onLayoutChange on EVERY drag/resize frame AND on mount (with
   * the current layout). We must NOT persist on the mount callback (would
   * cause an update loop), so we diff against the last known layout and
   * only persist when something actually changed.
   *
   * The comparison is shallow per-item on (x,y,w,h); RGL never reuses item
   * ids so an id-only check is enough to detect add/remove.
   */
  function handleLayoutChange(next: Layout) {
    if (!layoutEqual(config.layout, next)) {
      persist({ ...config, layout: next.map(rglItemToConfig) });
    }
  }

  /** Persist a plugin widget's new opaque config (called when the plugin
   *  invokes `props.onConfigChange(next)`). Builds a new DashboardComponent
   *  with the config replaced and re-persists the whole dashboard. */
  function handleWidgetConfigChange(widgetId: string, next: unknown) {
    persist({
      ...config,
      components: config.components.map((c) =>
        c.id === widgetId && c.type === 'plugin' ? { ...c, config: next } : c,
      ),
    });
  }

  // Context handed to plugin widgets via DashboardPluginContext — keeps the
  // cell layer (DashboardGrid → WidgetHost) free of plugin-only props.
  const pluginContextValue = {
    databaseId: view.databaseId,
    viewId: view.id,
    properties: schema.properties,
    onWidgetConfigChange: handleWidgetConfigChange,
    onOpenManager: () => setManagerOpen(true),
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DashboardPluginContext.Provider value={pluginContextValue}>
      {config.components.length === 0 ? (
        <DashboardEmpty
          canAdd={!!onChangeDashboard}
          onAddClick={(rect) => setAddAnchor(rect)}
        />
      ) : (
        <>
          <DashboardToolbar
            count={visibleRows.length}
            canAdd={!!onChangeDashboard}
            onAddClick={(rect) => setAddAnchor(rect)}
            onOpenPluginManager={onChangeDashboard ? () => setManagerOpen(true) : undefined}
          />
          <DashboardGrid
            config={config}
            components={config.components}
            rows={visibleRows}
            onOpenRow={onOpenRow}
            onLayoutChange={handleLayoutChange}
            onRemove={onChangeDashboard ? handleRemove : undefined}
          />
        </>
      )}

      {addAnchor && (
        <AddWidgetMenu
          anchorRect={addAnchor}
          onPick={handleAdd}
          onPickPlugin={onChangeDashboard ? handleAddPlugin : undefined}
          onClose={() => setAddAnchor(null)}
        />
      )}

      {managerOpen && <PluginManagerModal onClose={() => setManagerOpen(false)} />}
    </DashboardPluginContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// DashboardGrid — owns the RGL v2 container width measurement + render.
// Split out so the empty state branch doesn't pay for the container
// measurement hook (RGL throws when width=0).
// ---------------------------------------------------------------------------

function DashboardGrid({
  config,
  components,
  rows,
  onOpenRow,
  onLayoutChange,
  onRemove,
}: {
  config: DashboardConfig;
  components: DashboardComponent[];
  rows: DatabaseRow[];
  onOpenRow?: (pageId: string) => void;
  onLayoutChange: (next: Layout) => void;
  onRemove?: (id: string) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1000 });
  return (
    <div ref={containerRef} className="p-2">
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={configToRglLayout(config)}
          gridConfig={{ cols: GRID_COLS_COUNT, rowHeight: GRID_ROW_HEIGHT, margin: [8, 8] }}
          dragConfig={{ enabled: true, handle: '.folio-dashboard-drag-handle' }}
          resizeConfig={{ enabled: true }}
          onLayoutChange={onLayoutChange}
        >
          {components.map((component) => (
            <div key={component.id} className="folio-dashboard-cell">
              <WidgetHost
                component={component}
                rows={rows}
                onOpenRow={onOpenRow}
                onRemove={onRemove ? () => onRemove(component.id) : undefined}
              />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WidgetHost — dispatch a config to the right widget component
// ---------------------------------------------------------------------------

function WidgetHost({
  component,
  rows,
  onOpenRow,
  onRemove,
}: {
  component: DashboardComponent;
  rows: DatabaseRow[];
  onOpenRow?: (pageId: string) => void;
  onRemove?: () => void;
}) {
  // The drag handle is the widget header itself (marked with the
  // `folio-dashboard-drag-handle` class inside <WidgetFrame>). RGL matches
  // it via `dragConfig.handle`, so a click on the visible header starts a
  // drag — no transparent overlay needed.
  return (
    <div className="h-full">
      {renderWidgetBody(component, rows, onOpenRow, onRemove)}
    </div>
  );
}

function renderWidgetBody(
  component: DashboardComponent,
  rows: DatabaseRow[],
  onOpenRow?: (pageId: string) => void,
  onRemove?: () => void,
) {
  switch (component.type) {
    case 'stat':
      return (
        <StatWidget
          title={component.title}
          filter={component.filter}
          rows={rows}
          onRemove={onRemove}
        />
      );
    case 'recent_rows':
      return (
        <RecentRowsWidget
          title={component.title}
          filter={component.filter}
          sort={component.sort}
          limit={component.limit}
          rows={rows}
          onOpenRow={onOpenRow}
          onRemove={onRemove}
        />
      );
    case 'plugin':
      // PluginWidgetRenderer pulls databaseId / viewId / properties /
      // onWidgetConfigChange / onOpenManager from DashboardPluginContext
      // (provided by DashboardView below), so we only pass the per-cell bits.
      // isEditing / containerWidth default until per-cell measurement ships.
      return (
        <PluginWidgetRenderer
          component={component}
          rows={rows}
          onOpenRow={onOpenRow}
          onRemove={onRemove}
          isEditing={false}
          containerWidth={0}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Empty state + toolbar
// ---------------------------------------------------------------------------

function DashboardEmpty({
  canAdd,
  onAddClick,
}: {
  canAdd: boolean;
  onAddClick: (rect: DOMRect) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-sm font-medium text-text-primary mb-1">
        {t('database.dashboard.empty')}
      </div>
      <div className="text-xs text-text-tertiary max-w-sm mb-4">
        {t('database.dashboard.emptyHint')}
      </div>
      {canAdd && (
        <button
          type="button"
          onClick={(e) => onAddClick(e.currentTarget.getBoundingClientRect())}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-bg-page border border-border-hairline hover:border-accent/40 hover:bg-bg-hover text-text-primary transition-colors"
        >
          + <span>{t('database.dashboard.addWidget')}</span>
        </button>
      )}
    </div>
  );
}

function DashboardToolbar({
  count,
  canAdd,
  onAddClick,
  onOpenPluginManager,
}: {
  count: number;
  canAdd: boolean;
  onAddClick: (rect: DOMRect) => void;
  onOpenPluginManager?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="h-9 flex-shrink-0 flex items-center justify-between px-3 border-b border-border-hairline">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">
          {count} {count === 1 ? 'row' : 'rows'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {onOpenPluginManager && (
          <button
            type="button"
            onClick={onOpenPluginManager}
            title={t('database.plugins.manager.title')}
            aria-label={t('database.dashboard.pluginsButton')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            {/* Puzzle piece icon — universal "plugin" / "extension" affordance. */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9.5 2.5h-3v1.75a1.75 1.75 0 1 1-3.5 0V2.5H2.5v3.5a1.75 1.75 0 1 0 0 3.5v3.5h3.5a1.75 1.75 0 1 1 3.5 0h3.5v-3.5a1.75 1.75 0 1 1 0-3.5v-3.5h-3.5a1.75 1.75 0 1 0-3.5 0V2.5z" />
            </svg>
            <span>{t('database.dashboard.pluginsButton')}</span>
          </button>
        )}
        {canAdd && (
          <button
            type="button"
            onClick={(e) => onAddClick(e.currentTarget.getBoundingClientRect())}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-bg-page border border-border-hairline hover:border-accent/40 hover:bg-bg-hover text-text-primary transition-colors"
          >
            + <span>{t('database.dashboard.addWidget')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers — translate between RGL's Layout and our DashboardLayoutItem
// ---------------------------------------------------------------------------

/** Convert our config layout to RGL's Layout (structurally identical, but
 *  RGL's type allows extra fields like static/moved that we don't persist). */
function configToRglLayout(config: DashboardConfig): Layout {
  // RGL auto-positions any child that doesn't have a layout entry, so we
  // can pass through only the items we know about. Missing ones get a
  // synthetic layout with x/y=0,w=2,h=4 from RGL itself.
  return config.layout.map((l) => ({ ...l }));
}

/** Convert an RGL Layout item to our persisted shape (drops RGL-only fields). */
function rglItemToConfig(l: LayoutItem): DashboardLayoutItem {
  return {
    i: l.i,
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
    minW: l.minW,
    maxW: l.maxW,
    minH: l.minH,
    maxH: l.maxH,
  };
}

/** True when two layouts are positionally equal. RGL calls onLayoutChange
 *  on mount with the current layout, so without this guard every dashboard
 *  render would re-persist the same data (update loop / extra SQL writes). */
function layoutEqual(a: DashboardConfig['layout'], b: Layout): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((l) => [l.i, l]));
  for (const item of b) {
    const prev = byId.get(item.i);
    if (!prev) return false;
    if (prev.x !== item.x || prev.y !== item.y || prev.w !== item.w || prev.h !== item.h) {
      return false;
    }
  }
  return true;
}
