'use server';

/**
 * Recording a call with a patient.
 *
 * The remote new-patient journey never meets anybody, so this call is the
 * identity check and the clinical conversation at once. His workflow makes it
 * a gate rather than a note: a request cannot be approved until a completed,
 * identity-verified call exists against it.
 *
 * Written as discrete, attributable events for the same reason review
 * decisions are — the legacy system accumulated everything into one text blob
 * and nobody could say afterwards who had done what. A second attempt is a
 * second row, never an edit of the first, so "we rang three times" is provable.
 */

import { and, desc, eq } from 'drizzle-orm';
import { action, query } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { db } from '@/lib/db/client';
import { clinicalContactEvent, clinician, submission } from '@/lib/db/schema';
import type { VerificationCall } from '@/lib/clinical/new-patient-gate';
// Constants and types live in a plain module: a 'use server' file may export
// nothing but async functions, and an `export const` here fails the production
// build while passing typecheck and tests.
import type { ContactOutcome } from '@/lib/clinical/contact';

export interface RecordContactInput {
  submissionId: string;
  purpose: string;
  outcome: ContactOutcome;
  channel?: string;
  identityVerified: boolean;
  /** What was asked to confirm who they were. */
  verificationData?: Record<string, unknown>;
  clinicalFindings?: string | null;
  adviceGiven?: string | null;
  notes?: string | null;
  followUpRequired?: boolean;
  startedAt?: string | null;
  branchId?: string | null;
  companyId?: string | null;
}

const record = action<RecordContactInput>('repeat_care:edit')
  .scopedTo((input) => ({ branchId: input.branchId ?? null, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    // Scope-checked in the WHERE, not just by the wrapper: the id comes from
    // the client and must not reach another organisation's record.
    const [subject] = await tx
      .select({ patientId: submission.patientId })
      .from(submission)
      .where(
        and(
          eq(submission.id, input.submissionId),
          eq(submission.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!subject) throw new Error('That request no longer exists.');

    // The caller's own registration where they are on the register. A manager
    // recording a call is a real event; it simply is not a clinician's.
    const [caller] = await tx
      .select({ id: clinician.id })
      .from(clinician)
      .where(
        and(
          eq(clinician.userId, actor.userId),
          eq(clinician.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    const completed = input.outcome === 'COMPLETED';

    const [created] = await tx
      .insert(clinicalContactEvent)
      .values({
        organisationId: actor.organisationId,
        submissionId: input.submissionId,
        patientId: subject.patientId,
        clinicianId: caller?.id ?? null,
        createdBy: actor.userId,
        channel: input.channel ?? 'PHONE',
        direction: 'OUTBOUND',
        purpose: input.purpose,
        outcome: input.outcome,
        /*
         * Identity cannot be verified on a call that never happened. The
         * database allows the combination; the workflow does not, and letting
         * it through would unlock the approval gate on a voicemail.
         */
        identityVerified: completed ? input.identityVerified : false,
        verificationData: input.verificationData ?? {},
        clinicalFindings: input.clinicalFindings?.trim() || null,
        adviceGiven: input.adviceGiven?.trim() || null,
        notes: input.notes?.trim() || null,
        followUpRequired: input.followUpRequired ?? false,
        startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
        // Required by a database check constraint whenever the outcome is
        // COMPLETED, and meaningless otherwise.
        completedAt: completed ? new Date() : null,
      })
      .returning({ id: clinicalContactEvent.id });

    if (!created) throw new Error('Could not save that call.');

    return {
      result: { id: created.id },
      audit: {
        action: completed ? 'wm.new.call_completed' : 'wm.new.call_attempted',
        entityType: 'submission',
        entityId: input.submissionId,
        after: {
          purpose: input.purpose,
          outcome: input.outcome,
          identityVerified: completed && input.identityVerified,
          followUpRequired: input.followUpRequired ?? false,
        },
      },
    };
  });

export async function recordContact(input: RecordContactInput) {
  if (input.outcome === 'COMPLETED' && !input.notes?.trim() && !input.clinicalFindings?.trim()) {
    return {
      ok: false as const,
      error: 'Write down what was said. A completed call with no record is not evidence of one.',
    };
  }

  try {
    const result = await record(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('recordContact failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to record calls against this request.'
          : 'Could not save that call. Please try again.',
    };
  }
}

export interface ContactRow extends VerificationCall {
  id: string;
  purpose: string;
  channel: string;
  notes: string | null;
  clinicalFindings: string | null;
  adviceGiven: string | null;
  followUpRequired: boolean;
  createdAt: Date;
  staffName: string | null;
}

/** Every contact recorded against a request, newest first. */
export async function getContacts(submissionId: string): Promise<ContactRow[]> {
  const read = query<{ submissionId: string }>('repeat_care:view')
    .scopedTo(() => ({}))
    .handler(async (input, { actor }) => {
      const rows = await db
        .select({
          id: clinicalContactEvent.id,
          purpose: clinicalContactEvent.purpose,
          channel: clinicalContactEvent.channel,
          outcome: clinicalContactEvent.outcome,
          identityVerified: clinicalContactEvent.identityVerified,
          notes: clinicalContactEvent.notes,
          clinicalFindings: clinicalContactEvent.clinicalFindings,
          adviceGiven: clinicalContactEvent.adviceGiven,
          followUpRequired: clinicalContactEvent.followUpRequired,
          completedAt: clinicalContactEvent.completedAt,
          createdAt: clinicalContactEvent.createdAt,
          staffName: clinician.fullName,
        })
        .from(clinicalContactEvent)
        .leftJoin(clinician, eq(clinicalContactEvent.clinicianId, clinician.id))
        .where(
          and(
            eq(clinicalContactEvent.submissionId, input.submissionId),
            eq(clinicalContactEvent.organisationId, actor.organisationId),
          ),
        )
        .orderBy(desc(clinicalContactEvent.createdAt));

      return rows;
    });

  try {
    return await read({ submissionId });
  } catch (error) {
    console.error('getContacts failed', error);
    return [];
  }
}
