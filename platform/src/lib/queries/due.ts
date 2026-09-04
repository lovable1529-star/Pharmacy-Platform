/**
 * The enrolments behind the due list.
 *
 * One query, deliberately.
 *
 * The obvious shape is two: fetch the active enrolments, then fetch their
 * submissions to learn how long each last supply was meant to last. Against a
 * database in Seoul that second round trip cost roughly 180ms on a screen two
 * different pages load — and once the rest of the Today snapshot was made
 * parallel, this was the leg bounding the whole page.
 *
 * So the supply length and the "already came back" flag are gathered by
 * correlated subqueries instead. Postgres does work it was going to do anyway;
 * the difference is that the answer crosses the world once rather than twice.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { patient, repeatEnrolment, submission } from '@/lib/db/schema';
import { dueList, type DueEnrolment, type DueRow } from '@/lib/repeat-care/due';

/** Statuses that mean the patient has already come back and is waiting on us. */
const OPEN = ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED', 'RESUBMITTED'];

export async function getDueList(
  organisationId: string,
  now = new Date(),
): Promise<DueRow[]> {
  /*
   * Two keys off the latest non-draft request, rather than the whole answers
   * document. A weight-management questionnaire is fifty-odd answers plus
   * uploads; this needs one of them, and dragging the rest across the wire for
   * every enrolled patient was pure waste.
   */
  const latest = (key: string) => sql<string | null>`(
    select s.answers->>${sql.raw(`'${key}'`)}
      from ${submission} s
     where s.patient_id = ${repeatEnrolment.patientId}
       and s.status <> 'DRAFT'
     order by s.created_at desc
     limit 1
  )`;

  const rows = await db
    .select({
      patientId: repeatEnrolment.patientId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      externalRef: repeatEnrolment.externalRef,
      medicine: repeatEnrolment.medicine,
      strength: repeatEnrolment.strength,
      lastSuppliedAt: repeatEnrolment.lastSuppliedAt,

      supplyQuantity: latest('supplyQuantity'),
      supplyDuration: latest('supplyDuration'),

      /* Already in the queue, so not somebody to chase. */
      hasOpenRequest: sql<boolean>`exists (
        select 1 from ${submission} s
         where s.patient_id = ${repeatEnrolment.patientId}
           and s.status::text in ${sql.raw(`('${OPEN.join("','")}')`)}
      )`,
    })
    .from(repeatEnrolment)
    .innerJoin(patient, eq(repeatEnrolment.patientId, patient.id))
    .where(and(
      eq(repeatEnrolment.organisationId, organisationId),
      eq(repeatEnrolment.status, 'ACTIVE'),
    ));

  const input: DueEnrolment[] = rows.map((r) => ({
    patientId: r.patientId,
    patientName: `${r.firstName} ${r.lastName}`.trim(),
    externalRef: r.externalRef,
    medicine: r.medicine,
    strength: r.strength,
    lastSuppliedAt: r.lastSuppliedAt,
    lastAnswers: {
      supplyQuantity: r.supplyQuantity ?? undefined,
      supplyDuration: r.supplyDuration ?? undefined,
    },
    hasOpenRequest: r.hasOpenRequest,
  }));

  return dueList(input, now);
}
