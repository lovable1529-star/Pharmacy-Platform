/**
 * Reports — §21.
 *
 * He named the uses himself: internal audits, NHS claims and performance
 * tracking. All three are the kind where being quietly short by a few hundred
 * matters, which is why every figure on this page is counted by the database
 * rather than by fetching rows and counting them here.
 *
 * The date range lives in the URL so a particular period is a link somebody
 * can send, and so refreshing does not silently move it.
 */

import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { getConsultations } from '@/lib/queries/clinical';
import { buildReports } from '@/lib/queries/reports';
import { ReportsView } from './reports-view';

export const dynamic = 'force-dynamic';

/** Midday, so parsing cannot land on the wrong side of midnight. */
function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { actor, activeBranch } = await getStaffContext();

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 90);

  const from = parseDate(params.from, defaultFrom);
  const to = parseDate(params.to, new Date());

  // Whole days at both ends. A range typed as two dates means "including both",
  // and stopping at midday on the last one would quietly drop that afternoon.
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  const range = { organisationId: actor.organisationId, from, to };

  const [reports, rows] = await Promise.all([
    buildReports(range),
    // The detail table keeps its own query — the totals above are aggregated
    // and this is the row-level export.
    getConsultations(actor.organisationId, { from }),
  ]);

  return (
    <ReportsView
      reports={reports}
      rows={rows}
      canExport={can(actor, 'reports:export')}
      from={from.toISOString().slice(0, 10)}
      to={to.toISOString().slice(0, 10)}
      branchName={activeBranch?.name ?? 'All branches'}
    />
  );
}
