/**
 * Shown while the sending record loads.
 *
 * Not decoration. The database is in Seoul, and this screen's queries were
 * measured at about 500ms against it — long enough that without something here the
 * navigation appears to have been ignored, and people click again.
 *
 * Drawn at the real proportions so nothing jumps when the content arrives.
 */

import {
  PageShellSkeleton, PageHeaderSkeleton, StatRowSkeleton, PanelStackSkeleton,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={900}>
      <PageHeaderSkeleton />
      <StatRowSkeleton cards={3} />
      <PanelStackSkeleton panels={1} rows={5} />
    </PageShellSkeleton>
  );
}
