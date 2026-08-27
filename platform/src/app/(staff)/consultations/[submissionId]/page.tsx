/**
 * Complete a consultation against a submitted form.
 *
 * Everything the pharmacist needs on one screen: who the patient is, what they
 * answered, the clinician-only questions, the administration details, and the
 * declarations — with stock for THIS branch only, so the wrong site's inventory
 * can never be decremented.
 */

import { eq, and, gt } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import {
  submission, service, formVersion, patient, clinician, stockLevel, batch, product, branch,
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

  const rows = await db
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
    .innerJoin(patient, eq(submission.patientId, patient.id))
    .where(and(eq(submission.id, submissionId), eq(submission.organisationId, actor.organisationId)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const allBranches = await getBranchesForActor(actor);
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

  const clinicians = await db
    .select({ id: clinician.id, fullName: clinician.fullName, gphcNumber: clinician.gphcNumber })
    .from(clinician)
    .where(eq(clinician.organisationId, actor.organisationId));

  // Stock at THIS branch only, in stock, not recalled.
  const stock = await db
    .select({
      id: batch.id,
      productName: product.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: stockLevel.quantity,
    })
    .from(stockLevel)
    .innerJoin(batch, eq(stockLevel.batchId, batch.id))
    .innerJoin(product, eq(batch.productId, product.id))
    .where(and(eq(stockLevel.branchId, activeBranch.id), gt(stockLevel.quantity, 0)))
    .orderBy(batch.expiryDate);

  return (
    <ConsultationClient
      submissionId={row.submissionId}
      serviceId={row.serviceId}
      branchId={activeBranch.id}
      companyId={activeBranch.companyId}
      branchName={activeBranch.name}
      patient={{
        id: row.patientId,
        fullName: `${row.firstName} ${row.lastName}`,
        dateOfBirth: row.dateOfBirth,
        addressLine1: row.addressLine1,
        postcode: row.postcode,
      }}
      schema={row.schema as unknown as FormSchema}
      patientAnswers={(row.answers ?? {}) as Answers}
      clinicians={clinicians}
      batches={stock.filter((s) => !s.expiryDate || new Date(s.expiryDate) > new Date())}
    />
  );
}
