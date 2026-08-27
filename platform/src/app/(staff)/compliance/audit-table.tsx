'use client';

import { DataTable, type Column } from '@/components/ui/data-table';
import { formatDateTime } from '@/lib/units';

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string | null;
  branchName: string | null;
  occurredAt: Date;
  hash: string;
  previousHash: string | null;
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const columns: Column<AuditRow>[] = [
    {
      key: 'occurredAt',
      header: 'When',
      numeric: true,
      value: (r) => r.occurredAt.toISOString(),
      render: (r) => formatDateTime(r.occurredAt),
    },
    {
      key: 'action',
      header: 'Action',
      value: (r) => r.action,
      render: (r) => <span className="font-mono text-[12px]">{r.action}</span>,
    },
    { key: 'entityType', header: 'Record', value: (r) => r.entityType },
    {
      key: 'userName',
      header: 'By',
      value: (r) => r.userName ?? 'Patient (public form)',
      render: (r) =>
        r.userName ?? <span className="text-ink-faint">Patient (public form)</span>,
    },
    { key: 'branchName', header: 'Branch', value: (r) => r.branchName },
    {
      key: 'hash',
      header: 'Hash',
      numeric: true,
      value: (r) => r.hash,
      render: (r) => <span title={r.hash}>{r.hash.slice(0, 12)}…</span>,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      searchPlaceholder="Filter the audit trail…"
      emptyTitle="No audit entries yet"
      emptyBody="Every mutation writes one — they appear as soon as anything is recorded."
      exportName="karsons-audit-trail"
      pageSize={50}
    />
  );
}
