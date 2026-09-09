/**
 * Shown while the reports are counted.
 *
 * Not decoration. The database is in Seoul, and this screen's queries were
 * measured at the longest on the system against it — long enough that without something here the
 * navigation appears to have been ignored, and people click again.
 *
 * Drawn at the real proportions so nothing jumps when the content arrives.
 */

import {
  PageShellSkeleton, PageHeaderSkeleton, StatRowSkeleton, PanelStackSkeleton,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={1200}>
      <PageHeaderSkeleton />
      <StatRowSkeleton cards={4} />
      <PanelStackSkeleton panels={2} rows={5} />
    </PageShellSkeleton>
  );
}
