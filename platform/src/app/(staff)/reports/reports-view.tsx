'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/units';
import type { ConsultationRow } from '@/lib/queries/clinical';

export function ReportsView({ rows, canExport }: { rows: ConsultationRow[]; canExport: boolean }) {
  const completed = useMemo(() => rows.filter((r) => r.status === 'COMPLETED'), [rows]);

  const totals = useMemo(() => {
    const byBranch = new Map<string, number>();
    const byProduct = new Map<string, number>();
    let nhs = 0;
    let priv = 0;

    for (const row of completed) {
      byBranch.set(row.branchName, (byBranch.get(row.branchName) ?? 0) + 1);
      if (row.productName) {
        byProduct.set(row.productName, (byProduct.get(row.productName) ?? 0) + 1);
      }
      if (row.fundedBy === 'NHS') nhs += 1;
      if (row.fundedBy === 'Private') priv += 1;
    }

    return {
      total: completed.length,
      nhs,
      priv,
      byBranch: [...byBranch.entries()].sort((a, b) => b[1] - a[1]),
      byProduct: [...byProduct.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [completed]);

  const columns: Column<ConsultationRow>[] = [
    {
      key: 'completedAt',
      header: 'Date',
      numeric: true,
      value: (r) => r.completedAt?.toISOString() ?? '',
      render: (r) => (r.completedAt ? formatDateTime(r.completedAt) : '—'),
    },
    { key: 'patientName', header: 'Patient', value: (r) => r.patientName },
    {
      key: 'dateOfBirth',
      header: 'DOB',
      numeric: true,
      value: (r) => r.dateOfBirth,
      render: (r) => formatDate(r.dateOfBirth),
    },
    { key: 'serviceName', header: 'Service', value: (r) => r.serviceName },
    { key: 'productName', header: 'Product', value: (r) => r.productName },
    { key: 'batchNumber', header: 'Batch', numeric: true, value: (r) => r.batchNumber },
    { key: 'branchName', header: 'Branch', value: (r) => r.branchName },
    { key: 'clinicianName', header: 'Pharmacist', value: (r) => r.clinicianName },
    { key: 'fundedBy', header: 'Funding', value: (r) => r.fundedBy },
  ];

  return (
    <div className="page-shell mx-auto max-w-[calc(1200px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Reports"
        subtitle="The last 90 days. Filter to what you need, then export for claims or audit."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Completed" value={totals.total} />
        <Stat label="NHS" value={totals.nhs} />
        <Stat label="Private" value={totals.priv} />
        <Stat
          label="Not recorded"
          value={totals.total - totals.nhs - totals.priv}
          tone={totals.total - totals.nhs - totals.priv > 0 ? 'review' : undefined}
        />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Breakdown title="By branch" entries={totals.byBranch} />
        <Breakdown title="By product" entries={totals.byProduct} />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchPlaceholder="Filter by patient, batch, branch, pharmacist…"
        emptyTitle="Nothing in this period"
        emptyBody="Consultations from the last 90 days appear here."
        exportName="karsons-report"
        canExport={canExport}
        pageSize={50}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'review' }) {
  return (
    <div className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </div>
      <div
        className={
          tone === 'review'
            ? 'tabular mt-1 font-display text-[26px] font-semibold text-review-700'
            : 'tabular mt-1 font-display text-[26px] font-semibold text-ink'
        }
      >
        {value}
      </div>
    </div>
  );
}

function Breakdown({ title, entries }: { title: string; entries: [string, number][] }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
      <div className="border-b border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        {title}
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-faint">Nothing yet.</p>
      ) : (
        entries.map(([name, count]) => (
          <div
            key={name}
            className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2 last:border-b-0"
          >
            <span className="min-w-0 truncate text-[13.5px] text-ink">{name}</span>
            <span className="tabular shrink-0 font-mono text-[13px] font-medium text-ink">
              {count}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
