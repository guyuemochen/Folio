/**
 * Renders a database tab whose `view.type` is a plugin-provided view type
 * (`plugin:<pluginId>:<viewType>`). The view-side counterpart of
 * {@link PluginWidgetRenderer}: widgets render inside a dashboard cell,
 * views render as a full tab (board / calendar / … surface).
 *
 * Lookup flow:
 *   1. Parse `view.type` into `{ pluginId, viewType }` (returns null for
 *      non-plugin types — the caller only reaches us for plugin types).
 *   2. Subscribe to the registry for that plugin + its view contribution.
 *   3. Loaded + enabled + contribution present → wrap in a view error
 *      boundary and call the contribution's component with {@link FolioViewProps}
 *      (the same schema/rows/mutators built-in views receive, plus a `host`).
 *   4. Missing / disabled / errored / contribution gone → render a full-tab
 *      placeholder so the user understands the empty tab.
 *
 * The error boundary is local (NOT {@link PluginErrorBoundary}) because that
 * one wraps its error state in a `WidgetFrame` (cell chrome); views are full
 * tabs and need a full-area error card.
 */

import { Component, createElement, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DatabaseRow, PropertyDef } from '../lib/types';
import type { ViewRendererProps } from '../components/database/viewRenderers/types';
import { usePluginRegistry, parsePluginViewType } from './store';
import type { FolioViewProps } from './types';

export function PluginViewRenderer(props: ViewRendererProps) {
  const { t } = useTranslation();
  const parsed = parsePluginViewType(props.view.type);
  // NonTableViewRenderer only dispatches here for plugin types, so a null
  // parse is unreachable — but defend anyway with the placeholder.
  if (!parsed) {
    return (
      <PluginViewPlaceholder
        title={props.view.name}
        message={t('database.plugins.view.malformedType', { type: props.view.type })}
      />
    );
  }
  const { pluginId, viewType } = parsed;

  const plugin = usePluginRegistry((s) => s.plugins[pluginId]);
  const status = usePluginRegistry((s) => s.statuses[pluginId]);
  const getHost = usePluginRegistry((s) => s.getHost);

  const contribution = plugin?.contributions.views?.find((v) => v.type === viewType);
  const displayName = contribution?.name ?? plugin?.manifest.name ?? viewType;

  // Case 1: plugin not loaded at all (uninstalled / never scanned).
  if (!plugin) {
    const message =
      status?.state === 'disabled'
        ? t('database.plugins.view.disabledHint')
        : status?.state === 'error'
          ? status.error ?? t('database.plugins.view.errorHint')
          : t('database.plugins.view.unavailableHint', { id: pluginId });
    return <PluginViewPlaceholder title={displayName} message={message} />;
  }

  // Case 2: plugin loaded but disabled.
  if (!plugin.enabled || status?.state === 'disabled') {
    return (
      <PluginViewPlaceholder
        title={displayName}
        message={t('database.plugins.view.disabledHint')}
      />
    );
  }

  // Case 3: contribution gone (plugin author removed/renamed the view type).
  if (!contribution || typeof contribution.component !== 'function') {
    return (
      <PluginViewPlaceholder
        title={displayName}
        message={t('database.plugins.view.contributionMissing', { type: viewType })}
      />
    );
  }

  const host = getHost(pluginId);
  if (!host) {
    return (
      <PluginViewPlaceholder
        title={displayName}
        message={t('database.plugins.view.hostMissing')}
      />
    );
  }

  // Map the built-in ViewRendererProps to the SDK's FolioViewProps. Types are
  // intentionally opaque on the SDK side (it doesn't depend on the
  // persistence layer); we cast at this host boundary — the SDK contract
  // documents that plugins cast `unknown` to `DatabaseRow` / `PropertyDef` /
  // `DatabaseWithSchema` at runtime, so the round-trip is type-safe by
  // convention.
  const viewProps: FolioViewProps = {
    view: props.view,
    schema: props.schema,
    rows: props.rows,
    onCellChange: (row, prop, value) =>
      props.onCellChange(
        row as DatabaseRow,
        prop as PropertyDef,
        value,
      ),
    onOpenRow: props.onOpenRow,
    onAddRow: props.onAddRow,
    onChangeGroupProperty: props.onChangeGroupProperty,
    host,
  };

  return (
    <PluginViewErrorBoundary
      key={`${pluginId}:${plugin.revision}`}
      pluginId={pluginId}
      title={displayName}
    >
      {/* createElement because the plugin component is type-erased
          (`(props) => unknown`) and may be any callable. It shares our React
          instance via globalThis.__FOLIO__, so the elements slot into our
          tree cleanly. */}
      {createElement(contribution.component as never, viewProps as never)}
    </PluginViewErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Full-tab placeholder (unavailable / disabled / errored plugin view).
// ---------------------------------------------------------------------------

function PluginViewPlaceholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-3 opacity-60" aria-hidden>
        🧩
      </div>
      <div className="text-sm font-medium text-text-primary mb-1">{title}</div>
      <div className="text-xs text-text-tertiary max-w-sm">{message}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View error boundary — full-tab styled (NOT wrapped in WidgetFrame, since a
// view is a full tab, not a dashboard cell).
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  pluginId: string;
  title: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  attemptKey: number;
}

class PluginViewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, attemptKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[folio:plugins] view plugin "${this.props.pluginId}" threw during render:`,
      error,
      info.componentStack,
    );
  }

  handleReload = (): void => {
    this.setState({ error: null, attemptKey: this.state.attemptKey + 1 });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <PluginViewCrashCard
          title={this.props.title}
          message={this.state.error.message}
          onReload={this.handleReload}
        />
      );
    }
    return (
      <div key={this.state.attemptKey} className="h-full">
        {this.props.children}
      </div>
    );
  }
}

function PluginViewCrashCard({
  title,
  message,
  onReload,
}: {
  title: string;
  message: string;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="text-sm font-medium text-status-red mb-2">
        {t('database.plugins.widget.errorTitle')}
      </div>
      <div className="text-xs text-text-tertiary mb-3">{title}</div>
      <pre className="max-w-2xl w-full overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary bg-bg-section/40 rounded p-3 mb-3">
        {message}
      </pre>
      <button
        type="button"
        onClick={onReload}
        className="px-3 py-1.5 text-xs rounded border border-border-hairline hover:bg-bg-hover text-text-primary transition-colors"
      >
        {t('database.plugins.widget.errorReload')}
      </button>
    </div>
  );
}
