/**
 * Placeholder shown when a persisted dashboard widget references a plugin
 * the registry can't satisfy — the plugin is uninstalled, disabled, or
 * currently failing to load.
 *
 * Mutes the widget rather than alarming — the user may have removed the
 * plugin intentionally; the dashboard should remain usable while they
 * decide what to do.
 */

import { useTranslation } from 'react-i18next';
import { WidgetFrame } from '../components/database/viewRenderers/dashboard/WidgetFrame';

interface Props {
  /** Plugin id from the persisted widget config. Shown in the message so the
   *  user can identify which plugin is missing. */
  pluginId: string;
  /** Optional card title (from `DashboardComponent.title`); falls back to
   *  a localized default. */
  title?: string;
  /** Optional status hint from the registry (`error` state surfaces the
   *  error message; `disabled` shows a different hint). */
  statusHint?: 'unavailable' | 'disabled' | 'error';
  /** Error message to display when statusHint === 'error'. */
  errorMessage?: string;
  /** Click handler for "Open plugin manager" — wired by the caller. */
  onOpenManager?: () => void;
}

export function PluginUnavailable({
  pluginId,
  title,
  statusHint = 'unavailable',
  errorMessage,
  onOpenManager,
}: Props) {
  const { t } = useTranslation();
  const headerTitle = title || t('database.plugins.widget.unavailableTitle', { id: pluginId });

  let body: string;
  if (statusHint === 'disabled') {
    body = t('database.plugins.widget.unavailableHint');
  } else if (statusHint === 'error' && errorMessage) {
    body = errorMessage;
  } else {
    body = t('database.plugins.widget.unavailableHint');
  }

  return (
    <WidgetFrame title={headerTitle}>
      <div className="flex flex-col items-start gap-2 h-full px-3 py-2 text-xs">
        <div className="text-text-secondary">{body}</div>
        {onOpenManager && (
          <button
            type="button"
            onClick={onOpenManager}
            className="self-end mt-auto px-2 py-1 text-xs rounded border border-border-hairline hover:bg-bg-hover text-text-primary transition-colors"
          >
            {t('database.plugins.manager.open')}
          </button>
        )}
      </div>
    </WidgetFrame>
  );
}
