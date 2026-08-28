'use client';

/**
 * Every consultation, filterable and exportable.
 *
 * He named the uses himself: internal audits, NHS claims and performance
 * tracking. All three want the same thing — a spreadsheet-shaped view with
 * date, branch, vaccine, batch and funding, that exports cleanly.
 */

import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DataTable, PageHeader, type Column } from '@/components/ui/data-table';
import { formatDate, formatDateTime } from '@/lib/units';
import type { ConsultationRow } from '@/lib/queries/clinical';

export function ConsultationsTable({ rows }: { rows: ConsultationRow[] }) {
  const router = useRouter();
  const columns: Column<ConsultationRow>[] = [
    {
      key: 'completedAt',
      header: 'When',
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
    { key: 'productName', header: 'Given', value: (r) => r.productName },
    { key: 'batchNumber', header: 'Batch', numeric: true, value: (r) => r.batchNumber },
    { key: 'clinicianName', header: 'Pharmacist', value: (r) => r.clinicianName },
    { key: 'branchName', header: 'Branch', value: (r) => r.branchName },
    {
      key: 'fundedBy',
      header: 'Funding',
      value: (r) => r.fundedBy,
      render: (r) =>
        r.fundedBy ? (
          <span className="rounded-[5px] bg-sunk px-2 py-0.5 font-mono text-[10px] uppercase text-ink-faint">
            {r.fundedBy}
          </span>
        ) : '—',
    },
    {
      key: 'pdf',
      header: '',
      align: 'right',
      value: () => null,
      // He asked for this: a copy of the completed consultation to give or email
      // to a patient who requests one.
      render: (r) => (
        <a
          href={`/api/consultations/${r.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
        >
          <FileText size={12} strokeWidth={2} />
          PDF
        </a>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        title="Consultations"
        subtitle="Everything recorded across the group. Filter, then export for claims or audit."
      />
      <DataTable
        onRowClick={(r) => router.push(`/consultations/record/${r.id}`)}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchPlaceholder="Filter by patient, batch, pharmacist…"
        emptyTitle="No consultations recorded"
        emptyBody="They appear here as soon as a pharmacist completes one."
        exportName="karsons-consultations"
      />
    </div>
  );
}
