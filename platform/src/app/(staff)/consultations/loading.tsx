import { PageShellSkeleton, PageHeaderSkeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={1200}>
      <PageHeaderSkeleton />
      <TableSkeleton rows={9} />
    </PageShellSkeleton>
  );
}
