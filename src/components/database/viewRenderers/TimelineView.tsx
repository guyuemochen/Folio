import type { ViewRendererProps } from './types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';

/**
 * STUB. Phase 2 parallel task fills this in.
 *
 * Timeline (Gantt) view: rows plot as horizontal bars between a start and
 * end date property (first two `date` properties on the schema). Includes
 * zoom (day/week/month) and horizontal pan. If fewer than two date
 * properties exist, shows a friendly empty state explaining the requirement.
 */
export function TimelineView({ view }: ViewRendererProps) {
  return <ViewTypePlaceholder view={view} />;
}
