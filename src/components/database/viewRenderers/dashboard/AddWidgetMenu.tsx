import { useTranslation } from 'react-i18next';
import { Popover } from '../../../ui/Popover';
import type { WidgetKind } from './types';
import { WIDGET_KIND_INFO } from './types';
import { selectEnabledPlugins, usePluginRegistry } from '../../../../plugins/store';

interface AddWidgetMenuProps {
  /** Anchor rect from the "Add widget" trigger button. */
  anchorRect: DOMRect;
  /** Pick a built-in widget kind. */
  onPick: (kind: WidgetKind) => void;
  /** Pick a plugin widget. Optional — if omitted (read-only dashboard), the
   *  Plugins section is hidden entirely. */
  onPickPlugin?: (pluginId: string) => void;
  onClose: () => void;
}

/**
 * Popover that lists every widget kind the user can drop onto the
 * dashboard. Each entry shows the localized title + one-line description
 * from {@link WIDGET_KIND_INFO}.
 *
 * Built-in widgets are listed first. When plugins are loaded and enabled
 * in the registry (and the caller passes `onPickPlugin`), a separate
 * "Plugins" section appears below with one entry per plugin.
 */
export function AddWidgetMenu({ anchorRect, onPick, onPickPlugin, onClose }: AddWidgetMenuProps) {
  const { t } = useTranslation();
  const kinds = Object.keys(WIDGET_KIND_INFO) as WidgetKind[];
  const plugins = usePluginRegistry(selectEnabledPlugins);
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
            {plugins.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-tertiary italic">
                {t('database.plugins.widget.noPlugins')}
              </div>
            ) : (
              plugins.map((plugin) => (
                <button
                  key={plugin.manifest.id}
                  type="button"
                  onClick={() => onPickPlugin?.(plugin.manifest.id)}
                  className="w-full text-left px-3 py-2 hover:bg-bg-hover transition-colors flex flex-col gap-0.5"
                >
                  <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                    {plugin.manifest.name}
                    <span className="text-[10px] font-normal text-text-tertiary">
                      {plugin.manifest.version}
                    </span>
                  </span>
                  {plugin.manifest.description && (
                    <span className="text-xs text-text-tertiary">
                      {plugin.manifest.description}
                    </span>
                  )}
                </button>
              ))
            )}
          </>
        )}
      </div>
    </Popover>
  );
}
