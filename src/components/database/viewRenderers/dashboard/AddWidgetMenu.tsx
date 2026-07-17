import { useTranslation } from 'react-i18next';
import { Popover } from '../../../ui/Popover';
import type { WidgetKind } from './types';
import { WIDGET_KIND_INFO } from './types';

interface AddWidgetMenuProps {
  /** Anchor rect from the "Add widget" trigger button. */
  anchorRect: DOMRect;
  onPick: (kind: WidgetKind) => void;
  onClose: () => void;
}

/**
 * Popover that lists every widget kind the user can drop onto the
 * dashboard. Each entry shows the localized title + one-line description
 * from {@link WIDGET_KIND_INFO}.
 *
 * Adding a new widget kind is one entry in `WIDGET_KIND_INFO` + one branch
 * in `defaultComponentFor` + one case in `DashboardView`'s render switch —
 * this menu updates itself automatically from the kind metadata.
 */
export function AddWidgetMenu({ anchorRect, onPick, onClose }: AddWidgetMenuProps) {
  const { t } = useTranslation();
  const kinds = Object.keys(WIDGET_KIND_INFO) as WidgetKind[];
  return (
    <Popover
      anchorRect={anchorRect}
      placement="bottom-start"
      width={260}
      onClose={onClose}
      ariaLabel={t('database.dashboard.addWidget')}
    >
      <div className="py-1 text-sm text-text-primary">
        <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          {t('database.dashboard.addWidget')}
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
              <span className="text-sm font-medium text-text-primary">
                {t(info.titleKey)}
              </span>
              <span className="text-xs text-text-tertiary">
                {t(info.descriptionKey)}
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
