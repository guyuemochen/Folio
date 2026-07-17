import type { ViewRendererProps } from './types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';

/**
 * STUB. Phase 2 parallel task fills this in.
 *
 * Calendar view: month grid with rows grouped by the first `date` property
 * on the schema. Multi-event days stack; events drag across days to change
 * the date. Includes month navigation (prev / next / today).
 */
export function CalendarView({ view }: ViewRendererProps) {
  return <ViewTypePlaceholder view={view} />;
}
