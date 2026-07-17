import type { ViewRendererProps } from './types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';

/**
 * STUB. Phase 2 parallel task fills this in.
 *
 * List view: one row per record, showing the icon + title + 2-3 prominent
 * properties as flat text. Lighter than table (no headers, no inline cell
 * editing) — click opens the row page. Useful for journal / outline style
 * databases.
 */
export function ListView({ view }: ViewRendererProps) {
  return <ViewTypePlaceholder view={view} />;
}
