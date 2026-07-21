import { useTranslation } from 'react-i18next';
import type { ViewConfig } from '../../lib/types';

interface ViewTypePlaceholderProps {
  view: ViewConfig;
}

/**
 * Placeholder shown when the active view's `type` is anything other than
 * `table`. Phase 1 of the multi-tab feature only ships the `table` renderer;
 * `board` / `calendar` / `timeline` / `gallery` / `list` land in subsequent
 * feature branches. Until then we still let users create / switch to those
 * tabs so the structure is in place — we just render a clear "coming soon"
 * panel with the view's current filter/sort configuration preserved on the
 * backend (so when the renderer lands, the tab opens with the right config).
 */
export function ViewTypePlaceholder({ view }: ViewTypePlaceholderProps) {
  const { t } = useTranslation();
  const typeLabelKey = `database.viewType.${view.type}`;
  // i18next returns the key itself when the lookup misses; fall back to a
  // generic label so a typo never produces an ugly raw key string.
  const typeLabel = t(typeLabelKey) === typeLabelKey ? view.type : t(typeLabelKey);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-3 opacity-60" aria-hidden>
        🚧
      </div>
      <div className="text-sm font-medium text-text-primary mb-1">
        {t('database.viewTypeComingSoon', { type: typeLabel })}
      </div>
      <div className="text-xs text-text-tertiary max-w-sm">
        {t('database.viewTypeComingSoonHint')}
      </div>
      <div className="mt-3 text-[11px] text-text-tertiary/80">
        {t('database.viewNameLabel')}: <span className="font-medium">{view.name}</span>
      </div>
    </div>
  );
}
