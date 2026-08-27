/**
 * End-of-day GP notification.
 *
 * One email per surgery with a table of that day's patients — the client's
 * stated preference, and far more welcome in a @gov.im inbox than twenty
 * separate messages.
 *
 * Re-running is safe: already-notified consultations are excluded, so a cron
 * retry never double-sends. Manual resend of a corrected record is a separate,
 * deliberate action.
 */

import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organisation, consultation } from '@/lib/db/schema';
import { buildGpBatches } from '@/lib/communications/batching';
import { getConsultationsToNotify } from '@/lib/queries/notifications';
import { sendGpBatch } from '@/lib/email/send';
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
    const consultations = await getConsultationsToNotify(org.id, today);
    const { batches, unroutable, totalConsultations } = buildGpBatches({ consultations, date: today });

    const sent = [];
    const failed = [];

    for (const batch of batches) {
      const result = await sendGpBatch(batch, today);

      if (result.ok) {
        sent.push({ surgery: batch.gpSurgeryName, patients: batch.consultations.length });

        // Mark them notified so a retry cannot send twice.
        for (const c of batch.consultations) {
          await db
            .update(consultation)
            .set({
              clinicalData: sql`${consultation.clinicalData} || ${JSON.stringify({
                notifiedAt: new Date().toISOString(),
                notificationRef: batch.reference,
              })}::jsonb`,
            })
            .where(eq(consultation.id, c.consultationId));
        }
      } else {
        failed.push({ surgery: batch.gpSurgeryName, error: result.error });
        console.error(`[gp-batch] ${batch.gpSurgeryName} failed: ${result.error}`);
      }
    }

    if (unroutable.length > 0) {
      console.error(
        `[gp-batch] ${unroutable.length} consultation(s) have no usable GP address — these need a human.`,
      );
    }

    report.push({
      organisation: org.name,
      totalConsultations,
      batchesSent: sent.length,
      batchesFailed: failed.length,
      unroutable: unroutable.length,
      sent,
      failed,
    });
  }

  return NextResponse.json({ ok: true, date: today.toISOString(), report });
}
