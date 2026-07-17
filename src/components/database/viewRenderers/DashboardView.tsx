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
  emptyDashboardConfig,
  type WidgetKind,
} from './dashboard/types';

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
  rows,
  onOpenRow,
  onChangeDashboard,
}: ViewRendererProps) {
  const visibleRows = useVisibleRows(rows, view);
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);

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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (config.components.length === 0) {
    return (
      <DashboardEmpty
        canAdd={!!onChangeDashboard}
        onAddClick={(rect) => setAddAnchor(rect)}
      />
    );
  }

  return (
    <>
      <DashboardToolbar
        count={visibleRows.length}
        canAdd={!!onChangeDashboard}
        onAddClick={(rect) => setAddAnchor(rect)}
      />
      <DashboardGrid
        config={config}
        components={config.components}
        rows={visibleRows}
        onOpenRow={onOpenRow}
        onLayoutChange={handleLayoutChange}
        onRemove={onChangeDashboard ? handleRemove : undefined}
      />

      {addAnchor && (
        <AddWidgetMenu
          anchorRect={addAnchor}
          onPick={handleAdd}
          onClose={() => setAddAnchor(null)}
        />
      )}
    </>
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
  // The drag handle is a thin strip at the top of each cell. RGL uses the
  // CSS class via `draggableHandle` so only this strip starts a drag —
  // the rest of the widget stays interactive (buttons, scroll, links).
  return (
    <div className="relative h-full">
      {onRemove && (
        <div className="folio-dashboard-drag-handle absolute inset-x-0 top-0 h-5 cursor-grab active:cursor-grabbing" aria-hidden />
      )}
      <div className="h-full pt-5">
        {renderWidgetBody(component, rows, onOpenRow)}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove widget"
          title="Remove widget"
          className="absolute top-0.5 right-1 text-text-tertiary hover:text-status-red text-xs leading-none px-1 z-10"
        >
          ×
        </button>
      )}
    </div>
  );
}

function renderWidgetBody(
  component: DashboardComponent,
  rows: DatabaseRow[],
  onOpenRow?: (pageId: string) => void,
) {
  switch (component.type) {
    case 'stat':
      return <StatWidget title={component.title} filter={component.filter} rows={rows} />;
    case 'recent_rows':
      return (
        <RecentRowsWidget
          title={component.title}
          filter={component.filter}
          sort={component.sort}
          limit={component.limit}
          rows={rows}
          onOpenRow={onOpenRow}
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
}: {
  count: number;
  canAdd: boolean;
  onAddClick: (rect: DOMRect) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="h-9 flex-shrink-0 flex items-center justify-between px-3 border-b border-border-hairline">
      <span className="text-xs text-text-secondary">
        {count} {count === 1 ? 'row' : 'rows'}
      </span>
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
