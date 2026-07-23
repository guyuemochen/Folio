/**
 * Error boundary for plugin widgets — catches render errors so a buggy
 * plugin doesn't crash the entire dashboard.
 *
 * Render-phase errors (thrown during the plugin component's render or any
 * child render) are caught and replaced with a red "Plugin crashed" card
 * showing the error message and a Reload button. The Reload button bumps
 * a local `attemptKey` which forces React to remount the plugin subtree
 * (giving it another chance after, e.g., the user has fixed and saved the
 * plugin file — though hot-reload already handles that case automatically).
 *
 * Errors are also logged to the console for developer debugging.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WidgetFrame } from '../components/database/viewRenderers/dashboard/WidgetFrame';

interface Props {
  /** Plugin id — used in the error log so devs can grep for the source. */
  pluginId: string;
  /** Card title for the WidgetFrame chrome around the error card. */
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Bumped on "Reload" to force a remount of `children`. */
  attemptKey: number;
}

export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attemptKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[folio:plugins] plugin "${this.props.pluginId}" threw during render:`,
      error,
      info.componentStack,
    );
  }

  handleReload = (): void => {
    // Reset the error + bump the key → React discards the old subtree and
    // mounts fresh. The plugin's latest module is whatever was last imported
    // (hot-reload keeps the registry current).
    this.setState({ error: null, attemptKey: this.state.attemptKey + 1 });
  };

  render(): ReactNode {
    if (this.state.error) {
      return <PluginCrashCard title={this.props.title} message={this.state.error.message} onReload={this.handleReload} />;
    }
    // `key` on the wrapper ensures children remount on reload (clears their
    // internal state, hooks, and any half-rendered output).
    return <div key={this.state.attemptKey} className="h-full">{this.props.children}</div>;
  }
}

function PluginCrashCard({
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
    <WidgetFrame title={title}>
      <div className="flex flex-col items-start gap-2 h-full px-3 py-2 text-xs">
        <div className="font-medium text-status-red">
          {t('database.plugins.widget.errorTitle')}
        </div>
        <pre className="flex-1 w-full overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary bg-bg-section/40 rounded p-2">
          {message}
        </pre>
        <button
          type="button"
          onClick={onReload}
          className="self-end px-2 py-1 text-xs rounded border border-border-hairline hover:bg-bg-hover text-text-primary transition-colors"
        >
          {t('database.plugins.widget.errorReload')}
        </button>
      </div>
    </WidgetFrame>
  );
}
