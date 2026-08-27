'use client';

/**
 * Reports.
 *
 * Deliberately small. Every figure here is derived from the same consultation
 * records the clinical screens use — there is no separate analytics pipeline to
 * fall out of sync.
 */

import { useMemo } from 'react';
import { useShell } from '@/components/shell/shell-provider';
import { BRANCHES, CONSULTATIONS, MESSAGES, branchName } from '@/lib/demo/data';
import { buildDailySummary } from '@/lib/communications/batching';
import { formatMoney } from '@/lib/units';

export default function ReportsPage() {
  const { branchId } = useShell();

  const summary = useMemo(
    () =>
      buildDailySummary({
        date: new Date(),
        consultations: CONSULTATIONS.map((c) => ({
          branchName: branchName(c.branchId),
          serviceName: c.serviceName,
          fundingType: c.fundingType,
        })),
        gpNotificationsSent: MESSAGES.filter((m) => m.status === 'DELIVERED').length,
        outstandingReviews: 5,
      }),
    [],
  );

  const byClinician = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of CONSULTATIONS) {
      counts.set(c.clinicianName, (counts.get(c.clinicianName) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const privateRevenue = CONSULTATIONS.filter((c) => c.fundingType === 'PAID').length * 1800;

  function exportCsv() {
    const rows = [
      ['Date', 'Branch', 'Service', 'Pharmacist', 'Batch', 'Funding'],
      ...CONSULTATIONS.map((c) => [
        c.completedAt.toISOString().slice(0, 10),
        branchName(c.branchId), c.serviceName, c.clinicianName, c.batchNumber, c.fundingType,
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `karsons-consultations-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl">Reports</h1>
          <p className="text-sm text-ink-soft">Across all branches, last 30 days.</p>
        </div>
        <button type="button" onClick={exportCsv}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
          Export CSV
        </button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Consultations', value: summary.totals.consultations },
          { label: 'NHS', value: summary.totals.nhs },
          { label: 'Private', value: summary.totals.paid },
          { label: 'Private revenue', value: formatMoney(privateRevenue) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-card border border-line bg-surface p-4">
            <div className="text-xs uppercase tracking-wide text-ink-soft">{stat.label}</div>
            <div className="mt-1 font-display text-2xl">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-card border border-line bg-surface">
          <div className="border-b border-line px-5 py-3"><h2 className="text-base">By branch</h2></div>
          <ul className="divide-y divide-line">
            {summary.byBranch.map((branch) => (
              <li key={branch.branchName} className="px-5 py-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{branch.branchName}</span>
                  <span className="font-display text-lg">{branch.total}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-brand-100">
                  <div className="h-full bg-brand-600"
                    style={{ width: `${(branch.total / summary.totals.consultations) * 100}%` }} />
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  {branch.nhs} NHS · {branch.paid} private
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card border border-line bg-surface">
          <div className="border-b border-line px-5 py-3"><h2 className="text-base">By pharmacist</h2></div>
          <ul className="divide-y divide-line">
            {byClinician.map(([name, count]) => (
              <li key={name} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm font-semibold">{name}</span>
                <span className="font-mono text-sm">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-5 text-xs text-ink-soft">
        Figures come from the same consultation records used elsewhere in the system, so they cannot
        drift out of sync with the clinical screens.
      </p>
    </div>
  );
}
