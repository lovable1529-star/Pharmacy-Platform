/**
 * A completed form, read only.
 *
 * A receptionist fielding “what did I put down?” across the counter had no way
 * to look. The only route to the answers was the consultation screen, which is
 * further away and carries controls to CHANGE them — so looking something up
 * risked editing it.
 *
 * This lives in the staff area rather than on the public form route, because
 * that is what makes it safe: the normal permission checks apply, opening it is
 * an ordinary staff action, and there is no token in the URL that could be
 * forwarded to somebody outside the pharmacy.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { ArrowLeft, Lock } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import { submission, formVersion, service, patient, appointment } from '@/lib/db/schema';
import { AnswerReview } from '@/components/clinical/answer-review';
import { PageHeader, Panel, Tag } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/units';
import type { FormSchema } from '@/types/form-schema';

export const dynamic = 'force-dynamic';

export default async function FormViewPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const { actor } = await getStaffContext();

  if (!can(actor, 'consultations:view')) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">Reading a form needs clinical access.</p>
      </div>
    );
  }

  const [row] = await db
    .select({
      id: submission.id,
      status: submission.status,
      answers: submission.answers,
      submittedAt: submission.submittedAt,
      schema: formVersion.schema,
      version: formVersion.version,
      serviceName: service.name,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      bookedName: appointment.bookedName,
      reference: appointment.reference,
    })
    .from(submission)
    .innerJoin(formVersion, eq(submission.formVersionId, formVersion.id))
    .innerJoin(service, eq(submission.serviceId, service.id))
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .leftJoin(appointment, eq(appointment.submissionId, submission.id))
    .where(
      and(
        eq(submission.id, submissionId),
        eq(submission.organisationId, actor.organisationId),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const schema = row.schema as unknown as FormSchema;
  const name = row.firstName && row.lastName
    ? `${row.firstName} ${row.lastName}`
    : row.bookedName ?? 'Unnamed patient';

  return (
    <div className="page-shell mx-auto max-w-[calc(900px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/appointments"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        Appointments
      </Link>

      <PageHeader
        title={name}
        subtitle={`${row.serviceName}${row.reference ? ` · ${row.reference}` : ''}`}
      />

      <Panel className="mb-4 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Said plainly, so nobody hunts for an edit button that is not here. */}
          <span className="flex items-center gap-1.5 rounded-control bg-sunk px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">
            <Lock size={11} strokeWidth={2.2} />
            Read only
          </span>
          <Tag tone="neutral">form v{row.version}</Tag>
          {row.dateOfBirth ? (
            <span className="tabular font-mono text-[11.5px] text-ink-faint">
              born {formatDate(row.dateOfBirth)}
            </span>
          ) : null}
          {row.submittedAt ? (
            <span className="tabular font-mono text-[11.5px] text-ink-faint">
              sent {formatDateTime(row.submittedAt)}
            </span>
          ) : null}

          {/* The way through to the editable view, for whoever actually needs it. */}
          <Link
            href={`/consultations/${row.id}`}
            className="ml-auto rounded-control border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            Open consultation
          </Link>
        </div>
      </Panel>

      <Panel className="px-5 py-4">
        {/* No `onAmend`, so the component renders without any way to change it. */}
        <AnswerReview
          schema={schema}
          answers={(row.answers ?? {}) as Record<string, unknown>}
        />
      </Panel>
    </div>
  );
}
