import { PageShellSkeleton, PageHeaderSkeleton, CardListSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={980}>
      <PageHeaderSkeleton />
      {/* The day's appointments read as a list of cards, one per slot. */}
      <CardListSkeleton cards={6} height={88} />
    </PageShellSkeleton>
  );
}
