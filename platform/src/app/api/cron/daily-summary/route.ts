/**
 * Daily summary to the pharmacy team.
 *
 * Totals, NHS versus private, a breakdown per branch and per vaccine — and, when
 * a GP notification failed, a prominent warning. A surgery with no record of a
 * patient we saw today is the failure worth surfacing.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { organisation } from '@/lib/db/schema';
import { buildDailySummary, buildGpBatches } from '@/lib/communications/batching';
import { getConsultationsToNotify, getInternalRecipients } from '@/lib/queries/notifications';
import { sendDailySummary } from '@/lib/email/send';
import { isAuthorisedCron } from '@/lib/cron/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const today = new Date();
  const orgs = await db.select({ id: organisation.id, name: organisation.name }).from(organisation);
  const report = [];

  for (const org of orgs) {
    // Include already-sent, because the summary reports on the whole day.
    const consultations = await getConsultationsToNotify(org.id, today, true);
    const { batches, unroutable } = buildGpBatches({
      consultations, date: today, includeAlreadySent: true,
    });

    const summary = buildDailySummary({
      consultations,
      gpBatchesSent: batches.length,
      deliveryAlerts: unroutable.length,
      date: today,
    });

    const recipients = await getInternalRecipients(org.id);
    const results = recipients.length > 0 ? await sendDailySummary(summary, recipients) : [];

    report.push({
      organisation: org.name,
      total: summary.total,
      recipients: recipients.length,
      delivered: results.filter((r) => r.ok).length,
    });
  }

  return NextResponse.json({ ok: true, date: today.toISOString(), report });
}
