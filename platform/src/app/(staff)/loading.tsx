/**
 * Shown while Today loads.
 *
 * Not decoration. The database is in Seoul, and this screen's queries were
 * measured at around 1.2 seconds cold against it — long enough that without something here the
 * navigation appears to have been ignored, and people click again.
 *
 * Drawn at the real proportions so nothing jumps when the content arrives.
 */

import {
  PageShellSkeleton, HeroSkeleton, StatRowSkeleton, PanelStackSkeleton,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={1160}>
      <HeroSkeleton />
      <StatRowSkeleton cards={4} />
      <PanelStackSkeleton panels={2} rows={4} columns={2} />
    </PageShellSkeleton>
  );
}
