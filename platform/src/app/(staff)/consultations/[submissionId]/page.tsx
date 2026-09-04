/**
 * Complete a consultation against a submitted form.
 *
 * Everything the pharmacist needs on one screen: who the patient is, what they
 * answered, the clinician-only questions, the administration details, and the
 * declarations — with stock for THIS branch only, so the wrong site's inventory
 * can never be decremented.
 */

import { eq, and, gt } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import {
  submission, service, formVersion, patient, clinician, stockLevel, batch, product,
  branch, allergy,
} from '@/lib/db/schema';
import { getActorOrNull, getBranchesForActor } from '@/lib/auth/actor';
import { can, accessibleBranches } from '@/lib/tenancy/scope';
import type { Answers, FormSchema } from '@/types/form-schema';
import { ConsultationClient } from './consultation-client';

export const dynamic = 'force-dynamic';

export default async function ConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const actor = await getActorOrNull();
  if (!actor) redirect('/sign-in');

  const { submissionId } = await params;
  const { branch: branchParam } = await searchParams;

  /*
   * Three reads that need nothing from each other.
   *
   * The submission, the actor's branches and the clinician list were fetched
   * one after another, which against a database in Seoul is three lots of
   * ~180ms before this screen can start deciding anything. The pharmacist
   * opens this page for every decision they make.
   */
  const cliniciansQ = db
    .select({ id: clinician.id, fullName: clinician.fullName, gphcNumber: clinician.gphcNumber })
    .from(clinician)
    .where(eq(clinician.organisationId, actor.organisationId));

  const branchesQ = getBranchesForActor(actor);

  const rowsQ = db
    .select({
      submissionId: submission.id,
      answers: submission.answers,
      serviceId: service.id,
      serviceName: service.name,
      schema: formVersion.schema,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      addressLine1: patient.addressLine1,
      postcode: patient.postcode,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .innerJoin(formVersion, eq(submission.formVersionId, formVersion.id))
    /*
     * LEFT join, not inner.
     *
     * A submission can legitimately reach a submitted state with no patient
     * attached: the record is only created when the answers carry a first name,
     * a last name AND a valid date of birth, so any service whose form does not
     * collect all three produces exactly this.
     *
     * With an inner join that row vanished and the page called notFound(), so a
     * pharmacist pressing "Start consultation" on a real, arrived patient met a
     * bare 404 with nothing to act on.
     */
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .where(and(eq(submission.id, submissionId), eq(submission.organisationId, actor.organisationId)))
    .limit(1);

  const [rows, allBranches, clinicians] = await Promise.all([
    rowsQ, branchesQ, cliniciansQ,
  ]);

  const row = rows[0];
  if (!row) notFound();
  const permitted = accessibleBranches(actor, allBranches);
  const activeBranch =
    allBranches.find((b) => b.id === branchParam && permitted.includes(b.id)) ??
    allBranches.find((b) => permitted.includes(b.id));

  if (!activeBranch) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">No branch available</h1>
        <p className="text-[14px] text-ink-soft">
          You do not currently hold access at any branch. Speak to an administrator.
        </p>
      </div>
    );
  }

  if (!can(actor, 'consultations:add', { branchId: activeBranch.id, companyId: activeBranch.companyId })) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">
          Recording a consultation needs pharmacist access at {activeBranch.name}.
        </p>
      </div>
    );
  }

  /*
   * No patient record behind this submission.
   *
   * A consultation cannot be recorded against free text — consultation.patientId
   * is NOT NULL, and rightly so. But the honest response is to say which piece
   * is missing and how to supply it, not to pretend the page does not exist.
   */
  /*
   * Built once and guarded as a whole.
   *
   * Narrowing `patientId` alone tells the compiler nothing about the sibling
   * columns, and a left join makes every one of them nullable. Checking what
   * the screen actually needs is both honest and what makes the types work.
   */
  const patientRecord =
    row.patientId && row.firstName && row.lastName && row.dateOfBirth
      ? {
          id: row.patientId,
          fullName: `${row.firstName} ${row.lastName}`,
          dateOfBirth: row.dateOfBirth,
          addressLine1: row.addressLine1,
          postcode: row.postcode,
        }
      : null;

  if (!patientRecord) {
    const answers = (row.answers ?? {}) as Record<string, unknown>;
    const named = [answers.firstName, answers.lastName]
      .filter((v) => typeof v === 'string' && v.trim())
      .join(' ');

    return (
      <div className="mx-auto max-w-[620px] px-6 py-20">
        <div className="rounded-panel border border-review-200 bg-review-50 px-6 py-6">
          <h1 className="mb-2 font-display text-[21px] text-ink">
            No patient record yet
          </h1>
          <p className="text-[14.5px] leading-relaxed text-ink-soft">
            {named
              ? `This form was completed by ${named}, but it is not linked to a patient record.`
              : 'This form is not linked to a patient record.'}{' '}
            A consultation has to be recorded against one, so that comes first.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-faint">
            Bookings made from now on create the record straight away. This one
            predates that, or was made without a date of birth. Adding the patient
            below carries across everything already on the form and attaches it to
            this consultation — you will come straight back here.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={`/patients/new?from=${row.submissionId}`}
              className="rounded-control bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Add this patient
            </Link>
            <Link
              href="/appointments"
              className="rounded-control border border-line bg-surface px-3.5 py-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
            >
              Back to appointments
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /*
   * Two more that depend on what the first wave produced - stock on the active
   * branch, allergies on the matched patient - but not on each other.
   */
  const stockQ = db
    .select({
      id: batch.id,
      productName: product.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: stockLevel.quantity,
      allergens: product.allergens,
    })
    .from(stockLevel)
    .innerJoin(batch, eq(stockLevel.batchId, batch.id))
    .innerJoin(product, eq(batch.productId, product.id))
    .where(and(eq(stockLevel.branchId, activeBranch.id), gt(stockLevel.quantity, 0)))
    .orderBy(batch.expiryDate);

  // What this patient is known to react to — from their record, which is the
  // list the product's allergens are checked against.
  const recordedQ = db
    .select({ substance: allergy.substance })
    .from(allergy)
    .where(eq(allergy.patientId, patientRecord.id));

  const [stock, recorded] = await Promise.all([stockQ, recordedQ]);

  return (
    <ConsultationClient
      patientAllergies={recorded.map((a) => a.substance)}
      submissionId={row.submissionId}
      serviceId={row.serviceId}
      branchId={activeBranch.id}
      companyId={activeBranch.companyId}
      branchName={activeBranch.name}
      patient={patientRecord}
      schema={row.schema as unknown as FormSchema}
      patientAnswers={(row.answers ?? {}) as Answers}
      clinicians={clinicians}
      batches={stock.filter((s) => !s.expiryDate || new Date(s.expiryDate) > new Date())}
    />
  );
}
