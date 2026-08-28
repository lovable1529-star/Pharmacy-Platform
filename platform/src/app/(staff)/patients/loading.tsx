import { PageShellSkeleton, PageHeaderSkeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShellSkeleton width={1080}>
      <PageHeaderSkeleton />
      <TableSkeleton rows={9} />
    </PageShellSkeleton>
  );
}
