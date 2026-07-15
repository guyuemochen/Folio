import { useTranslation } from 'react-i18next';
import type { FilterNode, PropertyDef } from '../../lib/types';
import { flattenTokens, type FilterToken } from './filterEngine';

interface FilterBarProps {
  filter: FilterNode | null;
  properties: PropertyDef[];
  onOpenEditor: () => void;
  onRemoveLeaf: (leafId: string) => void;
}

/**
 * Filter bar (PRD §5.3.4): 36px tall, white bg + border-bottom, sits below the
 * table header. Renders one pill chip per leaf filter with AND/OR connectors
 * and group parentheses so the logical structure is visible:
 *
 *   (Status is "open" AND Priority > 3) OR (Assignee is "me")
 *
 * Each chip has a × to remove; connectors and parens are display-only.
 */
export function FilterBar({ filter, properties, onOpenEditor, onRemoveLeaf }: FilterBarProps) {
  const { t } = useTranslation();
  const tokens = flattenTokens(filter, properties);
  if (tokens.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-hairline bg-bg-page">
        <button
          type="button"
          onClick={onOpenEditor}
          className="text-xs text-accent hover:underline"
        >
          {t('database.addFilter')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 h-9 border-b border-border-hairline bg-bg-page overflow-x-auto">
      {tokens.map((token, i) => (
        <TokenView key={i} token={token} onRemoveLeaf={onRemoveLeaf} />
      ))}
      <button
        type="button"
        onClick={onOpenEditor}
        className="text-xs text-accent hover:underline ml-1"
      >
        {t('database.addFilter')}
      </button>
    </div>
  );
}

function TokenView({
  token,
  onRemoveLeaf,
}: {
  token: FilterToken;
  onRemoveLeaf: (leafId: string) => void;
}) {
  const { t } = useTranslation();

  if (token.kind === 'connector') {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary px-0.5 select-none">
        {token.op === 'and' ? t('database.and') : t('database.or')}
      </span>
    );
  }

  if (token.kind === 'group_open') {
    return <span className="text-text-tertiary text-sm font-medium select-none">{'('}</span>;
  }

  if (token.kind === 'group_close') {
    return <span className="text-text-tertiary text-sm font-medium select-none">{')'}</span>;
  }

  // chip
  return (
    <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-bg-hover text-text-secondary text-[11px] whitespace-nowrap">
      <span className="text-text-tertiary">{token.propertyName}</span>
      <span>{t(token.operatorLabelKey)}</span>
      {token.valueLabel && (
        <span className="font-medium text-text-primary">{token.valueLabel}</span>
      )}
      <button
        type="button"
        onClick={() => onRemoveLeaf(token.leaf.id)}
        className="text-text-tertiary hover:text-status-red leading-none"
        title={t('database.removeFilter')}
      >
        ×
      </button>
    </span>
  );
}
