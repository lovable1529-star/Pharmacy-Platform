/**
 * A completed consultation.
 *
 * Previously the only way to open a finished record was to download a PDF. That
 * is the wrong artefact for the question people actually ask — "show me what
 * happened here" — and it made the record feel like an export rather than
 * something the system holds.
 *
 * This is the inspection surface: what the patient declared, what the engine
 * decided and why, who administered what from which batch, which declarations
 * they signed, and when the GP was told.
 *
 * Strictly read-only. The answers behind an administered vaccine are part of
 * the clinical record; correcting them afterwards would rewrite the
 * justification for something already done.
 */

import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download, Syringe } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import {
  consultation, patient, service, branch, clinician, batch, product,
  submission, formVersion, ruleEvaluation,
} from '@/lib/db/schema';
import { AnswerReview } from '@/components/clinical/answer-review';
import { getAddenda } from './addendum-actions';
import { AddendaPanel } from './addenda-panel';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import { formatDate } from '@/lib/units';
import type { Answers, FormSchema } from '@/types/form-schema';

export const dynamic = 'force-dynamic';

function stamp(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </dt>
      <dd className="m-0 mt-0.5 text-[14px] text-ink">{value || '—'}</dd>
    </div>
  );
}

export default async function ConsultationRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { actor } = await getStaffContext();

  const [row] = await db
    .select({
      id: consultation.id,
      status: consultation.status,
      completedAt: consultation.completedAt,
      createdAt: consultation.createdAt,
      clinicalData: consultation.clinicalData,
      declarations: consultation.declarationsAccepted,
      identityVerified: consultation.identityVerified,
      notes: consultation.notes,
      submissionId: consultation.submissionId,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      serviceName: service.name,
      branchName: branch.name,
      clinicianName: clinician.fullName,
      gphcNumber: clinician.gphcNumber,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      recalledAt: batch.recalledAt,
      productName: product.name,
    })
    .from(consultation)
    .innerJoin(patient, eq(consultation.patientId, patient.id))
    .innerJoin(service, eq(consultation.serviceId, service.id))
    .innerJoin(branch, eq(consultation.branchId, branch.id))
    .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
    .leftJoin(batch, eq(consultation.batchId, batch.id))
    .leftJoin(product, eq(batch.productId, product.id))
    .where(
      and(
        eq(consultation.id, id),
        // Organisation-scoped, so an id from another tenant is a 404 rather
        // than a readable clinical record.
        eq(consultation.organisationId, actor.organisationId),
      ),
    )
    .limit(1);

  if (!row) notFound();

  // The answers, rendered against the exact form version they were given on.
  let schema: FormSchema | null = null;
  let answers: Answers = {};
  let outcome: string | null = null;
  let advice: string[] = [];

  if (row.submissionId) {
    const [sub] = await db
      .select({ answers: submission.answers, schema: formVersion.schema })
      .from(submission)
      .innerJoin(formVersion, eq(submission.formVersionId, formVersion.id))
      .where(eq(submission.id, row.submissionId))
      .limit(1);

    if (sub) {
      schema = sub.schema as unknown as FormSchema;
      const { _metadata, ...rest } = (sub.answers ?? {}) as Record<string, unknown>;
      void _metadata;
      answers = rest as Answers;
    }

    const [evaluation] = await db
      .select({ outcome: ruleEvaluation.outcome, advice: ruleEvaluation.advice })
      .from(ruleEvaluation)
      .where(eq(ruleEvaluation.submissionId, row.submissionId))
      // The newest evaluation: an amendment writes a fresh row rather than
      // overwriting, so this is the decision that actually stood.
      .orderBy(desc(ruleEvaluation.evaluatedAt))
      .limit(1);

    if (evaluation) {
      outcome = evaluation.outcome;
      advice = evaluation.advice;
    }
  }

  const addenda = await getAddenda(row.id);

  const clinical = (row.clinicalData ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof clinical[key] === 'string' ? (clinical[key] as string) : null;

  return (
    <div className="page-shell mx-auto max-w-[calc(880px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/consultations"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} /> All consultations
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight text-ink">
            {row.firstName} {row.lastName}
          </h1>
          <p className="tabular mt-0.5 font-mono text-[12.5px] text-ink-faint">
            {formatDate(row.dateOfBirth)} · {row.serviceName} · {row.branchName}
          </p>
        </div>
        <a
          href={`/api/consultations/${row.id}/pdf`}
          className="flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
        >
          <Download size={13} strokeWidth={2.2} />
          Download PDF
        </a>
      </div>

      <AddendaPanel consultationId={row.id} addenda={addenda} />

      {/* ── What was given ──────────────────────────────── */}
      <section className="mb-5 overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
        <div className="flex items-center gap-2 border-b border-line bg-sunk px-4 py-2.5">
          <Syringe size={13} strokeWidth={2.2} className="text-ink-faint" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            Administration
          </span>
          {outcome ? (
            <span
              className={`ml-auto rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                outcome === 'RED'
                  ? 'bg-stop-100 text-stop-700'
                  : outcome === 'AMBER'
                    ? 'bg-review-100 text-review-700'
                    : 'bg-safe-100 text-safe-700'
              }`}
            >
              {outcome}
            </span>
          ) : null}
        </div>

        <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Fact label="Completed" value={stamp(row.completedAt ?? row.createdAt)} />
          <Fact
            label="Pharmacist"
            value={
              row.clinicianName
                ? `${row.clinicianName}${row.gphcNumber ? ` · GPhC ${row.gphcNumber}` : ''}`
                : '—'
            }
          />
          <Fact
            label="Product"
            value={
              row.productName
                ? `${row.productName}${row.batchNumber ? ` — ${row.batchNumber}` : ''}`
                : 'None administered'
            }
          />
          <Fact
            label="Batch expiry"
            value={
              row.expiryDate ? (
                <>
                  {formatDate(row.expiryDate)}
                  {row.recalledAt ? (
                    <span className="ml-2 rounded-[5px] bg-stop-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-stop-700">
                      Batch later recalled
                    </span>
                  ) : null}
                </>
              ) : null
            }
          />
          <Fact label="Site of administration" value={text('siteOfAdministration')} />
          <Fact label="Type of injection" value={text('injectionType')} />
          <Fact label="Funded by" value={text('fundedBy')} />
          <Fact
            label="Identity verified"
            value={row.identityVerified ? 'Yes, confirmed with the patient' : 'Not recorded'}
          />
        </dl>

        {row.notes ? (
          <div className="border-t border-line-soft px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[14px] text-ink">{row.notes}</p>
          </div>
        ) : null}
      </section>

      {/* ── Declarations ────────────────────────────────── */}
      {row.declarations.length > 0 ? (
        <section className="mb-5 overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
          <div className="border-b border-line bg-sunk px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            Pharmacist declarations
          </div>
          <ul className="m-0 list-none p-0">
            {row.declarations.map((d) => (
              <li
                key={d}
                className="border-b border-line-soft px-4 py-2 text-[13.5px] text-ink-soft last:border-b-0"
              >
                {d}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {advice.length > 0 ? (
        <section className="mb-5 rounded-panel border border-review-200 bg-review-50 px-4 py-3">
          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-review-700">
            Clinical advice at the time
          </p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[13.5px] text-ink-soft">
            {advice.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </section>
      ) : null}

      {/* ── What the patient declared ───────────────────── */}
      {schema ? (
        <section>
          <h2 className="mb-2.5 font-display text-[15px] font-semibold text-ink">
            What the patient declared
          </h2>
          {/* No onAmend: an administered vaccine's justification is history. */}
          <AnswerReview schema={schema} answers={answers} />
        </section>
      ) : null}
    </div>
  );
}
