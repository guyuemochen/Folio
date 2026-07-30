/**
 * Renders one plugin widget cell — the integration point between the
 * dashboard grid and the loaded plugin component.
 *
 * Lookup flow:
 *   1. Subscribe to `usePluginRegistry` for the plugin with `component.pluginId`.
 *   2. If the plugin is loaded + enabled → wrap in {@link PluginErrorBoundary}
 *      + {@link WidgetFrame}, then call the plugin's component via
 *      `React.createElement`. The plugin uses the host's React (via
 *      `globalThis.__FOLIO__`), so elements flow through cleanly.
 *   3. If the plugin is missing / disabled / errored → render
 *      {@link PluginUnavailable} with the right hint.
 *
 * Hot reload integration: the registry bumps `plugin.revision` on every
 * successful reload; we mirror it into the `key` on the boundary wrapper so
 * React discards the old subtree and remounts fresh (otherwise stale hooks
 * and closures from the previous module linger).
 *
 * Context: the dashboard-wide bits (databaseId, viewId, properties, the
 * `onWidgetConfigChange` mutator, the `onOpenManager` callback) come from
 * {@link DashboardPluginContext} — see {@link DashboardView} for the provider.
 * This keeps `WidgetHost`'s prop list small and avoids threading plugin-only
 * concerns through the ReactGridLayout cell layer.
 */

import { createElement, createContext, useContext } from 'react';
import { WidgetFrame } from '../components/database/viewRenderers/dashboard/WidgetFrame';
import { usePluginRegistry } from './store';
import { PluginErrorBoundary } from './PluginErrorBoundary';
import { PluginUnavailable } from './PluginUnavailable';
import type {
  DatabaseRow,
  PropertyDef,
} from '../lib/types';
import type { FolioWidgetProps } from './types';

/** Dashboard-wide context the renderer pulls from. Provided by DashboardView
 *  so the cell layer (DashboardGrid → WidgetHost) doesn't need to know about
 *  plugin-only concerns. */
export interface DashboardPluginContextValue {
  databaseId: string;
  viewId: string;
  properties: PropertyDef[];
  /** Persist a widget's new opaque config (host writes it into the dashboard
   *  component immediately, parent persists to SQLite via onChangeDashboard). */
  onWidgetConfigChange: (widgetId: string, next: unknown) => void;
  /** Open the plugin manager modal. */
  onOpenManager: () => void;
}

export const DashboardPluginContext = createContext<DashboardPluginContextValue | null>(null);

export interface PluginWidgetRendererProps {
  /** The persisted widget config (id, pluginId, widgetId, title, config). */
  component: {
    id: string;
    type: 'plugin';
    pluginId: string;
    /** Which widget contribution within the plugin. Optional for dashboards
     *  saved against legacy single-`component` plugins (resolved to the
     *  plugin's only widget). */
    widgetId?: string;
    title?: string;
    config?: unknown;
  };
  /** Visible rows in the view (post-filter/sort). */
  rows: DatabaseRow[];
  /** Open a row in the page editor. */
  onOpenRow?: (pageId: string) => void;
  /** × button handler. */
  onRemove?: () => void;
  /** True while the dashboard is in edit / layout mode. */
  isEditing: boolean;
  /** Current pixel width of the widget cell. */
  containerWidth: number;
}

export function PluginWidgetRenderer(props: PluginWidgetRendererProps) {
  const { component } = props;
  const plugin = usePluginRegistry((s) => s.plugins[component.pluginId]);
  const status = usePluginRegistry((s) => s.statuses[component.pluginId]);
  const getHost = usePluginRegistry((s) => s.getHost);
  const ctx = useContext(DashboardPluginContext);

  // Resolve the specific widget contribution this cell renders. A unified
  // plugin may ship several widgets; `component.widgetId` disambiguates
  // (legacy single-widget plugins leave it undefined → first widget).
  const widget = plugin?.contributions.widgets?.find(
    (w) => (w.id ?? 'default') === (component.widgetId ?? 'default'),
  );

  // Resolve display title: explicit override → contribution name → manifest
  // name → synthetic. Falls through the chain so old dashboards (no widgetId,
  // no contribution name) keep their pre-refactor title.
  const title =
    component.title ||
    widget?.name ||
    plugin?.manifest.name ||
    component.pluginId;

  // Case 1: plugin not loaded at all (uninstalled, never scanned).
  if (!plugin) {
    const hint: 'unavailable' | 'disabled' | 'error' =
      status?.state === 'disabled'
        ? 'disabled'
        : status?.state === 'error'
          ? 'error'
          : 'unavailable';
    return (
      <PluginUnavailable
        pluginId={component.pluginId}
        title={title}
        statusHint={hint}
        errorMessage={status?.error}
        onOpenManager={ctx?.onOpenManager}
      />
    );
  }

  // Case 2: plugin loaded but disabled via manager — still show unavailable
  // (so the user knows why the widget isn't rendering).
  if (!plugin.enabled || status?.state === 'disabled') {
    return (
      <PluginUnavailable
        pluginId={component.pluginId}
        title={title}
        statusHint="disabled"
        onOpenManager={ctx?.onOpenManager}
      />
    );
  }

  // Case 3: plugin loaded + enabled but the specific widget contribution is
  // gone (plugin author removed/renamed it). Show unavailable so the user
  // understands the empty cell rather than seeing a silent blank.
  if (!widget || typeof widget.component !== 'function') {
    return (
      <PluginUnavailable
        pluginId={component.pluginId}
        title={title}
        statusHint="error"
        errorMessage={
          component.widgetId
            ? `Widget "${component.widgetId}" not found in this plugin.`
            : 'This plugin has no widget to render.'
        }
        onOpenManager={ctx?.onOpenManager}
      />
    );
  }

  const host = getHost(component.pluginId);
  if (!host || !ctx) {
    // Should be unreachable (host is built alongside the plugin in the store;
    // ctx is provided by DashboardView) but defend against drift.
    return (
      <PluginUnavailable
        pluginId={component.pluginId}
        title={title}
        statusHint="error"
        errorMessage={!ctx ? 'Dashboard context missing.' : 'Plugin host not initialized.'}
        onOpenManager={ctx?.onOpenManager}
      />
    );
  }

  const widgetProps: FolioWidgetProps = {
    config: component.config,
    onConfigChange: (next: unknown) => ctx.onWidgetConfigChange(component.id, next),
    host,
    context: {
      databaseId: ctx.databaseId,
      viewId: ctx.viewId,
      rows: props.rows,
      properties: ctx.properties,
    },
    onOpenRow: props.onOpenRow,
    isEditing: props.isEditing,
    containerWidth: props.containerWidth,
  };

  return (
    <PluginErrorBoundary
      // `key` includes the plugin's revision counter so hot-reload (which
      // bumps revision) forces React to discard the old subtree and remount
      // fresh. Without this, the plugin's previous closures/hooks survive
      // the reload and produce confusing stale-behavior bugs.
      key={`${component.pluginId}:${plugin.revision}`}
      pluginId={component.pluginId}
      title={title}
    >
      {/* No WidgetFrame here — the ErrorBoundary's happy-path renders
          <div key=...>{children}</div>, and we render the WidgetFrame as
          the child so the boundary's crash card owns its own chrome. */}
      <WidgetFrame title={title} onRemove={props.onRemove}>
        {/* createElement rather than JSX because the plugin component is
            type-erased (`(props) => unknown`) and may be any callable. The
            plugin's own React (read from globalThis.__FOLIO__) is the same
            instance as ours, so the produced elements slot into our tree. */}
        {createElement(widget.component as never, widgetProps as never)}
      </WidgetFrame>
    </PluginErrorBoundary>
  );
}

