/**
 * Verify, then record — §26.2 and §27.
 *
 * The pharmacist reads back what the patient answered, confirms they are
 * suitable, and records what was given. One screen, in that order, because
 * that is the order it happens in at the counter.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import {
  getVaccinationConsultation, getUsableBatches, getClinicians, getBranches,
} from '@/lib/queries/vaccinations';
import { AnswerReview } from '@/components/clinical/answer-review';
import { PageHeader, Panel, Notice, Tag } from '@/components/ui/primitives';
import { formatDate } from '@/lib/units';
import type { FormSchema } from '@/types/form-schema';
import { AdministerForm } from './administer-form';

export const dynamic = 'force-dynamic';

export default async function VaccinationPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const { actor, activeBranch } = await getStaffContext();

  const consultation = await getVaccinationConsultation(actor.organisationId, submissionId);
  if (!consultation) notFound();

  const branchId = activeBranch?.id ?? null;

  // The three lists the form needs, together — none depends on another.
  const [batches, clinicians, branches] = await Promise.all([
    branchId ? getUsableBatches(actor.organisationId, branchId) : Promise.resolve([]),
    getClinicians(actor.organisationId),
    getBranches(actor.organisationId),
  ]);

  const schema = consultation.schema as unknown as FormSchema;
  const done = consultation.administration;

  return (
    <div className="page-shell mx-auto max-w-[calc(1000px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/vaccinations"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        All vaccinations
      </Link>

      <PageHeader
        title={consultation.patientName}
        subtitle={
          consultation.dateOfBirth
            ? `${formatDate(consultation.dateOfBirth)} · ${consultation.serviceName}`
            : consultation.serviceName
        }
      />

      {done ? (
        <Notice tone="safe" title="Already recorded">
          {done.vaccineName}, batch {done.batchNumber}, given on{' '}
          {formatDate(done.administeredOn)} by {done.clinicianName}. A second record
          cannot be added for the same questionnaire.
        </Notice>
      ) : null}

      {!consultation.consentAccepted && !done ? (
        <Notice tone="review" title="No consent on file">
          This questionnaire has no accepted consent record, so a vaccination cannot
          be recorded against it. If the patient is with you, complete the form with
          them and take consent as part of it.
        </Notice>
      ) : null}

      <Panel className="mb-4 px-5 py-4">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">What they told us</h2>
        <p className="mb-3 text-[13.5px] text-ink-faint">
          Read these back before you give anything. Anything worth a second look is
          marked.
        </p>
        <AnswerReview schema={schema} answers={consultation.answers} />
      </Panel>

      {done ? null : !branchId ? (
        <Notice tone="review" title="No branch selected">
          Choose the branch you are working from before recording a vaccination —
          stock comes out of that branch.
        </Notice>
      ) : !can(actor, 'consultations:add') ? (
        <Notice tone="review" title="Not available to you">
          Recording a vaccination needs clinical access. Speak to an administrator if
          you think that is wrong.
        </Notice>
      ) : (
        <AdministerForm
          submissionId={consultation.submissionId}
          branchId={branchId}
          branches={branches.map((b) => ({ id: b.id, name: b.name, companyId: b.companyId }))}
          clinicians={clinicians}
          batches={batches}
          consentAccepted={consultation.consentAccepted}
        />
      )}

      {done ? (
        <Panel className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="safe">recorded</Tag>
            <span className="tabular font-mono text-[11.5px] text-ink-faint">
              {done.site.toLowerCase().replace(/_/g, ' ')}
            </span>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
