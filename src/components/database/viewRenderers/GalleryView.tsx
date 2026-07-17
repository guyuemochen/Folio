import type { ViewRendererProps } from './types';
import { ViewTypePlaceholder } from '../ViewTypePlaceholder';

/**
 * STUB. Phase 2 parallel task fills this in.
 *
 * Gallery view: card grid where each card shows a cover (first files/url
 * property), the row title, and a compact list of prominent properties.
 * Cards open the row page on click. Card size adjustable via a slider.
 */
export function GalleryView({ view }: ViewRendererProps) {
  return <ViewTypePlaceholder view={view} />;
}
