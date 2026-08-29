/**
 * The public patient form.
 *
 * This is the page a patient reaches from a link on the pharmacy website, a QR
 * code on the counter, or a tablet in the consultation room. No account, no
 * password — a health questionnaire should not require registration.
 *
 * The schema is read from the PUBLISHED version, so editing a form in the
 * Service Designer never changes what a patient is currently filling in.
 *
 * A `?s=` token means the patient is returning to a questionnaire that already
 * exists — booked online, or started earlier and abandoned. Their answers are
 * loaded back and the form opens where they stopped. Without a token this is a
 * cold walk-up: still allowed, because someone standing at the counter without
 * an appointment must be able to fill one in.
 */

import { eq, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import {
  service, formVersion, organisation, submission, appointment, branch,
} from '@/lib/db/schema';
import { isExpired } from '@/lib/forms/draft';
import { loadDoseLadders } from '@/lib/clinical/ladders';
import { loadPreviousSupply } from '@/lib/clinical/previous-supply';
import { deriveValues } from '@/lib/clinical/derived';
import { personaliseRepeatSchema } from '@/lib/clinical/personalise';
import { formatSlotTime, PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import type { FormSchema, Answers } from '@/types/form-schema';
import { PublicForm } from './form-client';

export const dynamic = 'force-dynamic';

function longDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { slug } = await params;
  const { s: token } = await searchParams;

  const rows = await db
    .select({
      serviceName: service.name,
      description: service.description,
      organisationName: organisation.name,
      organisationId: service.organisationId,
      schema: formVersion.schema,
      version: formVersion.version,
    })
    .from(service)
    .innerJoin(organisation, eq(service.organisationId, organisation.id))
    .innerJoin(formVersion, eq(service.publishedFormVersionId, formVersion.id))
    .where(and(eq(service.slug, slug)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const published = row.schema as unknown as FormSchema;

  /*
   * Personalised per patient at render time — §4.3.
   *
   * The dose dropdown and the read-only recommendation are properties of the
   * person filling this in, not of the form, so they cannot live in the
   * published version. A copy is tailored here; the published schema is
   * untouched, because a patient's answers stay bound to it and two people on
   * different strengths must not create two published versions.
   */
  let schema = published;

  // ── Resume, if they arrived with a token ──────────────────
  let saved: Answers | null = null;
  let alreadySubmitted = false;
  let tokenProblem: string | null = null;
  let appointmentInfo: { startsAt: Date; branchName: string; reference: string } | null = null;

  if (token) {
    const [draft] = await db
      .select({
        id: submission.id,
        status: submission.status,
        answers: submission.answers,
        expiresAt: submission.resumeExpiresAt,
        serviceId: submission.serviceId,
        patientId: submission.patientId,
      })
      .from(submission)
      .where(eq(submission.resumeToken, token))
      .limit(1);

    if (!draft) {
      tokenProblem = 'That link is not valid. It may have been mistyped.';
    } else if (isExpired(draft.expiresAt)) {
      tokenProblem =
        'That link has expired. Please call the pharmacy and we will send you a new one.';
    } else if (draft.status !== 'DRAFT') {
      // Already sent. Say so plainly rather than showing an empty form that
      // would silently create a second submission for one appointment.
      alreadySubmitted = true;
    } else {
      const answers = (draft.answers ?? {}) as Record<string, unknown>;
      const { _metadata, ...rest } = answers;
      void _metadata;
      saved = rest as Answers;

      const [appt] = await db
        .select({
          startsAt: appointment.startsAt,
          reference: appointment.reference,
          branchName: branch.name,
        })
        .from(appointment)
        .innerJoin(branch, eq(appointment.branchId, branch.id))
        .where(eq(appointment.submissionId, draft.id))
        .limit(1);

      if (appt) appointmentInfo = appt;

      // Their previous supply is what the dose limit and the suggestion are
      // computed from. A first consultation has none, and personalisation
      // returns the published schema unchanged.
      const ladders = await loadDoseLadders(db, row.organisationId);
      const previous = await loadPreviousSupply(db, {
        organisationId: row.organisationId,
        patientId: draft.patientId,
        serviceId: draft.serviceId,
        ladders,
      });

      const derived = deriveValues({
        answers: saved as Record<string, unknown>,
        previousMedicineValue: previous.previousMedicineValue,
        previousWeightKg: previous.previousWeightKg,
        ladders,
      });

      schema = personaliseRepeatSchema({
        schema: published,
        currentMedicineValue: previous.previousMedicineValue,
        ladders,
        recommendation: {
          appetiteSuppression: saved?.appetiteSuppression as string | null,
          snacking: saved?.snacking as string | null,
          adverseEffects: saved?.adverseEffects as string | null,
          weightLossPercent: derived.weightLossPercent,
          bmi: derived.bmi,
          missedDoses: derived.missedDoses,
          pregnancy: saved?.pregnancy as string | null,
          weeksOnDose: derived.weeksOnDose,
        },
      });
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1000px] items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 font-display text-[14px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-ink">
              {row.organisationName}
            </div>
            <div className="text-[12.5px] text-ink-faint">{row.serviceName}</div>
          </div>
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
            v{row.version}
          </span>
        </div>
      </header>

      {appointmentInfo ? (
        <div className="mx-auto max-w-[1000px] px-5 pt-6">
          <div className="rounded-[9px] border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[13.5px] text-brand-700">
              <span className="font-semibold">
                {longDate(appointmentInfo.startsAt)} at {formatSlotTime(appointmentInfo.startsAt)}
              </span>{' '}
              — {appointmentInfo.branchName} · {appointmentInfo.reference}
            </p>
            <p className="mt-0.5 text-[12.5px] text-brand-600">
              Please finish these questions before you come in. Your answers save
              automatically, so you can stop and return to this link at any time.
            </p>
          </div>
        </div>
      ) : null}

      {alreadySubmitted ? (
        <div className="mx-auto max-w-[640px] px-5 py-20 text-center">
          <h1 className="mb-2 font-display text-[22px] text-ink">
            You have already sent this in
          </h1>
          <p className="text-[14.5px] text-ink-soft">
            Our team has your answers. There is nothing more to do — if you need to
            change something, please call the pharmacy and we will amend it for you.
          </p>
        </div>
      ) : tokenProblem ? (
        <div className="mx-auto max-w-[640px] px-5 py-20 text-center">
          <h1 className="mb-2 font-display text-[22px] text-ink">
            We could not open that form
          </h1>
          <p className="text-[14.5px] text-ink-soft">{tokenProblem}</p>
        </div>
      ) : (
        <PublicForm
          slug={slug}
          schema={schema}
          token={token ?? null}
          savedAnswers={saved}
        />
      )}

      {alreadySubmitted || tokenProblem ? null : (
        <footer className="mx-auto max-w-[1000px] px-5 pb-12 text-center">
          <p className="text-[12.5px] text-ink-faint">
            Your answers are stored securely and shared only with your GP practice, in line with
            data protection law.
          </p>
        </footer>
      )}
    </div>
  );
}
