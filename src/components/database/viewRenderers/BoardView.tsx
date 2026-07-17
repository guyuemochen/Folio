import type { ViewRendererProps } from './types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';

/**
 * STUB. Phase 2 parallel task fills this in.
 *
 * Board (kanban) view: groups rows into columns by a select/status property
 * (defaults to `view.group.propertyId`, falling back to the first select/
 * status property on the schema). Cards are draggable across columns to
 * change the property value. Includes an "uncategorized" column for rows
 * whose value is empty.
 */
export function BoardView({ view }: ViewRendererProps) {
  return <ViewTypePlaceholder view={view} />;
}
