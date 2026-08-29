'use client';

/**
 * Reports — §21's ten, plus the row-level table that exports.
 *
 * The figures at the top are counted by the database. The table underneath is
 * the detail somebody exports for an NHS claim. Keeping them visibly separate
 * matters: the table is capped, the totals are not, and a screen that presented
 * both as one thing would invite reading the cap as the total.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState, PageHeader, Panel, Tag } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/units';
import type { ConsultationRow } from '@/lib/queries/clinical';
import type { ReportBundle, Counted } from '@/lib/queries/reports';

/** A count list, shown as bars so relative size reads without arithmetic. */
function Breakdown({ title, rows, empty }: { title: string; rows: Counted[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <Panel className="px-5 py-4">
      <h3 className="mb-3 text-[14px] font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-faint">{empty}</p>
      ) : (
        <div className="grid gap-2">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="mb-1 truncate text-[13px] text-ink-soft">
                  {row.label.toLowerCase().replace(/_/g, ' ')}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.round((row.total / max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="tabular font-mono text-[13px] font-medium text-ink">
                {row.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ReportsView({
  reports,
  rows,
  canExport,
  from,
  to,
  branchName,
}: {
  reports: ReportBundle;
  rows: ConsultationRow[];
  canExport: boolean;
  from: string;
  to: string;
  branchName: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  function apply() {
    router.push(`/reports?from=${fromDate}&to=${toDate}`);
  }

  const columns: Column<ConsultationRow>[] = useMemo(
    () => [
      { key: 'patientName', header: 'Patient', value: (r) => r.patientName },
      { key: 'serviceName', header: 'Service', value: (r) => r.serviceName },
      { key: 'branchName', header: 'Branch', value: (r) => r.branchName },
      {
        key: 'status',
        header: 'Status',
        value: (r) => r.status,
        render: (r) => <Tag tone="neutral">{r.status.toLowerCase().replace(/_/g, ' ')}</Tag>,
      },
      {
        key: 'completedAt',
        header: 'Completed',
        value: (r) => (r.completedAt ? formatDateTime(r.completedAt) : ''),
      },
    ],
    [],
  );

  const peak = reports.byDay.reduce<Counted | null>(
    (best, day) => (!best || day.total > best.total ? day : best),
    null,
  );

  return (
    <div className="page-shell mx-auto max-w-[calc(1200px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Reports"
        subtitle={`${branchName} · ${formatDate(from)} to ${formatDate(to)}`}
      />

      {/* Range */}
      <Panel className="mb-5 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <CalendarRange size={16} strokeWidth={2} className="mb-2 text-ink-faint" />
          <div>
            <label htmlFor="from" className="mb-1 block text-[11.5px] font-medium text-ink-soft">From</label>
            <input
              id="from" type="date" value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-control border border-line bg-surface px-3 py-1.5 text-[13.5px] text-ink outline-none focus:border-brand-300"
            />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-[11.5px] font-medium text-ink-soft">To</label>
            <input
              id="to" type="date" value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-control border border-line bg-surface px-3 py-1.5 text-[13.5px] text-ink outline-none focus:border-brand-300"
            />
          </div>
          <button
            type="button" onClick={apply}
            className="rounded-control bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Apply
          </button>
        </div>
      </Panel>

      {/* Headline figures — counted by the database, not capped. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Consultations', value: reports.total },
          {
            label: 'Prescriptions',
            value: reports.prescriptions.reduce((n, r) => n + r.total, 0),
          },
          {
            label: 'Vaccinations',
            value: reports.vaccinations.reduce((n, r) => n + r.total, 0),
          },
          { label: 'Rejected', value: reports.rejected.length },
        ].map((stat) => (
          <Panel key={stat.label} className="px-5 py-4">
            <div className="tabular font-mono text-[26px] font-semibold leading-none text-ink">
              {stat.value}
            </div>
            <div className="mt-1.5 text-[12.5px] text-ink-faint">{stat.label}</div>
          </Panel>
        ))}
      </div>

      {peak ? (
        <p className="mb-5 text-[13px] text-ink-faint">
          Busiest day in this period: <strong className="text-ink-soft">{formatDate(peak.label)}</strong>
          {' '}with {peak.total}.
        </p>
      ) : null}

      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <Breakdown title="By status" rows={reports.byStatus} empty="Nothing in this period." />
        <Breakdown title="By service" rows={reports.byService} empty="Nothing in this period." />
        <Breakdown title="Pharmacist activity" rows={reports.byPharmacist} empty="No consultations attributed to a pharmacist." />
        <Breakdown title="Prescriptions by state" rows={reports.prescriptions} empty="None raised." />
        <Breakdown title="Medicine usage" rows={reports.medicines} empty="None prescribed." />
        <Breakdown title="Vaccines given" rows={reports.vaccinations} empty="None given." />
        <Breakdown title="Stock movement" rows={reports.stock} empty="No movements." />
      </div>

      {/* Rejections, with reasons — a count alone teaches nothing. */}
      <Panel className="mb-5 px-5 py-4">
        <h3 className="mb-3 text-[14px] font-semibold text-ink">Rejected cases</h3>
        {reports.rejected.length === 0 ? (
          <p className="text-[13px] text-ink-faint">Nothing was rejected in this period.</p>
        ) : (
          <div className="grid gap-2">
            {reports.rejected.slice(0, 12).map((row) => (
              <div key={row.submissionId} className="border-b border-line-soft pb-2 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-[13.5px] font-medium text-ink">
                    {row.patientName ?? 'Unmatched patient'}
                  </span>
                  <span className="text-[12px] text-ink-faint">{row.serviceName}</span>
                  <span className="tabular ml-auto font-mono text-[11.5px] text-ink-faint">
                    {formatDate(row.decidedAt)}
                  </span>
                </div>
                {row.reason ? (
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">{row.reason}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Weight and BMI progress */}
      <Panel className="mb-5 px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingDown size={15} strokeWidth={2} className="text-safe-600" />
          <h3 className="text-[14px] font-semibold text-ink">Weight and BMI progress</h3>
        </div>
        {reports.progress.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            No measured questionnaires in this period.
          </p>
        ) : (
          <div className="grid gap-1.5">
            {reports.progress.slice(0, 15).map((row, i) => (
              <div key={`${row.patientId}-${i}`} className="flex flex-wrap items-baseline gap-x-3">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                  {row.patientName ?? 'Unmatched patient'}
                </span>
                {row.bmi != null ? (
                  <span className="tabular font-mono text-[12px] text-ink-faint">
                    BMI {row.bmi.toFixed(1)}
                  </span>
                ) : null}
                {row.weightLossPercent != null ? (
                  <span
                    className={cn(
                      'tabular font-mono text-[12px]',
                      row.weightLossPercent >= 2 ? 'text-safe-700' : 'text-review-700',
                    )}
                  >
                    {row.weightLossPercent.toFixed(1)}% lost
                  </span>
                ) : null}
                {row.submittedAt ? (
                  <span className="tabular font-mono text-[11.5px] text-ink-faint">
                    {formatDate(row.submittedAt)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* The detail, which is what gets exported. */}
      <div className="mb-2 flex items-baseline gap-2.5">
        <h3 className="text-[14px] font-semibold text-ink">Consultation detail</h3>
        <span className="text-[12px] text-ink-faint">
          The most recent {rows.length}. Totals above cover the whole period.
        </span>
      </div>

      {rows.length === 0 ? (
        <Panel>
          <EmptyState title="Nothing to show" body="No consultations in this period." />
        </Panel>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          searchPlaceholder="Search consultations"
          exportName="karsons-report"
          canExport={canExport}
        />
      )}
    </div>
  );
}
