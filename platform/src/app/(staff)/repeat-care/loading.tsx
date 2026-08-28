import { PageShellSkeleton, PageHeaderSkeleton, CardListSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={1080}>
      {/* No primary action on the queue — the work is in the cards. */}
      <PageHeaderSkeleton actions={false} />
      <CardListSkeleton cards={5} height={112} />
    </PageShellSkeleton>
  );
}
