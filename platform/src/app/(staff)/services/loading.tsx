import { PageShellSkeleton, PageHeaderSkeleton, CardListSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={1000}>
      <PageHeaderSkeleton />
      {/* Services are cards, not rows, and taller than the default. */}
      <CardListSkeleton cards={4} height={104} />
    </PageShellSkeleton>
  );
}
