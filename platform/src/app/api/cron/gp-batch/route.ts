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
import { and, inArray, isNull, sql } from 'drizzle-orm';
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
      /*
       * Claim before sending, not after.
       *
       * This used to select, send, then mark. Two overlapping runs — a retry, a
       * manual trigger landing on a scheduled one — both selected the same
       * consultations and both emailed the practice. A GP surgery receiving the
       * same vaccination record twice has to work out which is real.
       *
       * The conditional UPDATE is the claim: only rows still unnotified come
       * back, and only this run owns them. If the send then fails the stamp is
       * released, so the next run picks them up rather than losing them.
       */
      const ids = batch.consultations.map((c) => c.consultationId);

      const claimed = await db
        .update(consultation)
        .set({
          gpNotifiedAt: new Date(),
          gpNotifyCount: sql`${consultation.gpNotifyCount} + 1`,
        })
        .where(and(inArray(consultation.id, ids), isNull(consultation.gpNotifiedAt)))
        .returning({ id: consultation.id });

      if (claimed.length === 0) {
        // Another run got there first. Not an error.
        continue;
      }

      const result = await sendGpBatch(batch, today);

      if (result.ok) {
        sent.push({ surgery: batch.gpSurgeryName, patients: claimed.length });
      } else {
        // Release the claim so the next run retries rather than the record
        // being marked sent when nothing left the building.
        await db
          .update(consultation)
          .set({
            gpNotifiedAt: null,
            gpNotifyCount: sql`greatest(${consultation.gpNotifyCount} - 1, 0)`,
          })
          .where(inArray(consultation.id, claimed.map((c) => c.id)));

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
