/**
 * Reports.
 *
 * He named the uses himself: internal audits, NHS claims and performance
 * tracking. All three want a filterable table that exports cleanly, plus the
 * few totals somebody actually reads out in a meeting.
 */

import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { getConsultations } from '@/lib/queries/clinical';
import { ReportsView } from './reports-view';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { actor } = await getStaffContext();

  // Last 90 days is the useful default; the table filters within it.
  const from = new Date();
  from.setDate(from.getDate() - 90);

  const rows = await getConsultations(actor.organisationId, { from });
  return <ReportsView rows={rows} canExport={can(actor, 'reports:export')} />;
}
