import { useTranslation } from 'react-i18next';
import { Popover } from '../../../ui/Popover';
import type { WidgetKind } from './types';
import { WIDGET_KIND_INFO } from './types';
import { selectWidgetContributions, usePluginRegistry } from '../../../../plugins/store';

interface AddWidgetMenuProps {
  /** Anchor rect from the "Add widget" trigger button. */
  anchorRect: DOMRect;
  /** Pick a built-in widget kind. */
  onPick: (kind: WidgetKind) => void;
  /** Pick a plugin widget. Receives both the plugin id and the widget
   *  contribution id (a unified plugin can ship several widgets). Optional —
   *  if omitted (read-only dashboard), the Plugins section is hidden. */
  onPickPlugin?: (pluginId: string, widgetId: string) => void;
  onClose: () => void;
}

/**
 * Popover that lists every widget kind the user can drop onto the
 * dashboard. Each entry shows the localized title + one-line description
 * from {@link WIDGET_KIND_INFO}.
 *
 * Built-in widgets are listed first. When plugins are loaded and enabled
 * in the registry (and the caller passes `onPickPlugin`), a separate
 * "Plugins" section appears below with one entry per widget contribution
 * (flattened across plugins — a unified plugin that ships several widgets
 * shows one row per widget, labelled with the plugin name).
 */
export function AddWidgetMenu({ anchorRect, onPick, onPickPlugin, onClose }: AddWidgetMenuProps) {
  const { t } = useTranslation();
  const kinds = Object.keys(WIDGET_KIND_INFO) as WidgetKind[];
  // `selectWidgetContributions` now returns the cached `state.widgetContributions`
  // array (rebuilt on every `plugins` mutation), so the returned reference is
  // stable across renders. No `useShallow` needed — and using it here used to
  // cause an infinite `useSyncExternalStore` rerender loop because the old
  // selector built fresh entry-object literals on every call.
  const widgetEntries = usePluginRegistry(selectWidgetContributions);
  const showPlugins = !!onPickPlugin;

  return (
    <Popover
      anchorRect={anchorRect}
      placement="bottom-start"
      width={280}
      onClose={onClose}
      ariaLabel={t('database.dashboard.addWidget')}
    >
      <div className="py-1 text-sm text-text-primary max-h-[60vh] overflow-y-auto">
        <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          {t('database.plugins.widget.builtinSection')}
        </div>
        {kinds.map((kind) => {
          const info = WIDGET_KIND_INFO[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              className="w-full text-left px-3 py-2 hover:bg-bg-hover transition-colors flex flex-col gap-0.5"
            >
              <span className="text-sm font-medium text-text-primary">{t(info.titleKey)}</span>
              <span className="text-xs text-text-tertiary">{t(info.descriptionKey)}</span>
            </button>
          );
        })}

        {showPlugins && (
          <>
            <div className="mt-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary border-t border-border-hairline">
              {t('database.plugins.widget.pluginSection')}
            </div>
            {widgetEntries.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-tertiary italic">
                {t('database.plugins.widget.noPlugins')}
              </div>
            ) : (
              widgetEntries.map((entry) => {
                // When a plugin ships more than one widget, label the entry
                // with the plugin name so users can tell them apart; single-
                // widget plugins just show the widget name (cleaner).
                const samePluginCount = widgetEntries.filter(
                  (e) => e.plugin.manifest.id === entry.plugin.manifest.id,
                ).length;
                const showPluginPrefix = samePluginCount > 1;
                return (
                  <button
                    key={`${entry.plugin.manifest.id}:${entry.widgetId}`}
                    type="button"
                    onClick={() => onPickPlugin?.(entry.plugin.manifest.id, entry.widgetId)}
                    className="w-full text-left px-3 py-2 hover:bg-bg-hover transition-colors flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                      {entry.name}
                      <span className="text-[10px] font-normal text-text-tertiary">
                        {entry.plugin.manifest.version}
                      </span>
                    </span>
                    {showPluginPrefix && (
                      <span className="text-[10px] text-text-tertiary">
                        {entry.plugin.manifest.name}
                      </span>
                    )}
                    {entry.description && (
                      <span className="text-xs text-text-tertiary">{entry.description}</span>
                    )}
                  </button>
                );
              })
            )}
          </>
        )}
      </div>
    </Popover>
  );
}
