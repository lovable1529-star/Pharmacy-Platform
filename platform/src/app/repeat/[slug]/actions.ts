'use server';

/**
 * The repeat care gate — §4.2.
 *
 * Patients do not enrol themselves. A pharmacist authorises them after an
 * initial consultation and a first follow-up, so this gate exists to make sure
 * a repeat request is never the first time anybody has looked at someone.
 *
 * Both the Repeat Care ID and the email must match an ACTIVE enrolment. Fail
 * and the patient is pointed at the booking pathway, which is what the
 * specification asks for and is also the only honest answer — if we cannot
 * confirm who they are, an appointment is exactly what they need.
 *
 * Success creates the draft and hands back a resume link, so the questionnaire
 * they land on is already bound to their enrolment and their previous supply.
 * That matters: the dose options and the recommendation are both computed from
 * it, and a form that opened unbound would have to ask the patient for facts we
 * already hold.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { service, submission } from '@/lib/db/schema';
import { checkRepeatCareAccess, ACCESS_DENIED_MESSAGE } from '@/lib/repeat-care/access';
import { generateResumeToken, resumeExpiry, buildFormUrl } from '@/lib/forms/draft';
import { resolveAppUrl } from '@/lib/app-url';

export interface RepeatAccessResult {
  ok: boolean;
  formUrl?: string;
  error?: string;
}

export async function startRepeatRequest(
  slug: string,
  repeatCareId: string,
  email: string,
): Promise<RepeatAccessResult> {
  try {
    const [svc] = await db
      .select({
        id: service.id,
        organisationId: service.organisationId,
        publishedFormVersionId: service.publishedFormVersionId,
      })
      .from(service)
      .where(and(eq(service.slug, slug)))
      .limit(1);

    if (!svc || !svc.publishedFormVersionId) {
      return { ok: false, error: 'This service is not currently available.' };
    }

    return await db.transaction(async (tx) => {
      const access = await checkRepeatCareAccess(tx, {
        organisationId: svc.organisationId,
        serviceId: svc.id,
        repeatCareId,
        email,
      });

      // One message for every failure. Telling an unrecognised caller which
      // half they got right would turn this into a tool for finding valid IDs.
      if (!access.allowed) {
        return { ok: false, error: ACCESS_DENIED_MESSAGE };
      }

      const token = generateResumeToken();

      await tx.insert(submission).values({
        organisationId: svc.organisationId,
        serviceId: svc.id,
        formVersionId: svc.publishedFormVersionId!,
        patientId: access.patientId,
        status: 'DRAFT',
        answers: {},
        derived: {},
        resumeToken: token,
        resumeExpiresAt: resumeExpiry(),
      });

      return {
        ok: true,
        formUrl: buildFormUrl(resolveAppUrl(), slug, token),
      };
    });
  } catch (error) {
    console.error('startRepeatRequest failed', error);
    return { ok: false, error: 'Something went wrong. Please try again shortly.' };
  }
}
