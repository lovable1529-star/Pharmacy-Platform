'use server';

/**
 * Recording a vaccination — §27.
 *
 * Everything happens in one transaction because the pieces are only true
 * together: a vaccination record with no stock movement means the shelf count
 * is wrong, and a stock movement with no record means a dose left the fridge
 * for no documented reason. Either alone is worse than neither.
 *
 * The record is snapshotted rather than joined (§29.5). A batch renumbered next
 * year, a vaccine renamed, a pharmacist who re-registers — none of them may
 * change what this record says happened today.
 */

import { and, eq } from 'drizzle-orm';
import { action } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import {
  submission, patient, clinician, batch, product, stockLevel, stockMovement,
  vaccineAdministration, clinicianDeclaration, gpNotification, consentRecord,
  gpSurgery, consultation,
} from '@/lib/db/schema';
import {
  validateAdministration, normaliseInjectionType, CLINICIAN_DECLARATIONS,
  type AdministrationSite, type InjectionType,
} from '@/lib/vaccination/administration';
import { checkMovement } from '@/lib/inventory/movements';
import { changeSubmissionStatus } from '@/lib/workflow/history';
import { registerDocument } from '@/lib/documents/register';

export interface RecordVaccinationInput {
  submissionId: string;
  branchId: string;
  companyId?: string | null;
  clinicianId: string;
  batchId: string;
  administeredOn: string;
  site: AdministrationSite;
  injectionType: InjectionType | null;
  paymentType: string | null;
  adverseReaction: string | null;
  notes: string | null;
  /** Which declarations the pharmacist actually confirmed. */
  declarationKeys: string[];
  /** §26.3 — the pharmacist has judged the patient suitable. */
  suitabilityConfirmed: boolean;
}

const record = action<RecordVaccinationInput>('consultations:add')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    // ── What we are recording against ──────────────────────
    const [row] = await tx
      .select({
        id: submission.id,
        status: submission.status,
        patientId: submission.patientId,
        consultationId: consultation.id,
        patientFirstName: patient.firstName,
        patientLastName: patient.lastName,
        gpSurgeryId: patient.gpSurgeryId,
      })
      .from(submission)
      .leftJoin(patient, eq(submission.patientId, patient.id))
      .leftJoin(consultation, eq(consultation.submissionId, submission.id))
      .where(
        and(
          eq(submission.id, input.submissionId),
          eq(submission.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That consultation no longer exists.');
    if (!row.patientId) {
      throw new Error('This form is not linked to a patient record yet.');
    }

    // ── The batch, and whether it may be used ──────────────
    const [chosen] = await tx
      .select({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        recalledAt: batch.recalledAt,
        productId: product.id,
        productName: product.name,
        quantity: stockLevel.quantity,
      })
      .from(batch)
      .innerJoin(product, eq(batch.productId, product.id))
      .leftJoin(
        stockLevel,
        and(eq(stockLevel.batchId, batch.id), eq(stockLevel.branchId, input.branchId)),
      )
      .where(and(eq(batch.id, input.batchId), eq(batch.organisationId, actor.organisationId)))
      .limit(1);

    if (!chosen) throw new Error('That batch no longer exists.');

    const [signer] = await tx
      .select({ fullName: clinician.fullName, gphcNumber: clinician.gphcNumber })
      .from(clinician)
      .where(
        and(
          eq(clinician.id, input.clinicianId),
          eq(clinician.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!signer) throw new Error('That pharmacist is not on the register.');

    // Consent is a record now, so this asks the record rather than trusting a
    // flag the caller passed in.
    const [consent] = await tx
      .select({ accepted: consentRecord.accepted })
      .from(consentRecord)
      .where(eq(consentRecord.submissionId, input.submissionId))
      .limit(1);

    // ── §27.5 ──────────────────────────────────────────────
    const issues = validateAdministration({
      patientId: row.patientId,
      clinicianId: input.clinicianId,
      branchId: input.branchId,
      batchId: input.batchId,
      site: input.site,
      injectionType: input.injectionType,
      administeredOn: input.administeredOn,
      consentRecorded: consent?.accepted === true,
      suitabilityConfirmed: input.suitabilityConfirmed,
      declarationsConfirmed:
        input.declarationKeys.length === CLINICIAN_DECLARATIONS.length,
      batchExpiry: chosen.expiryDate,
      batchRecalled: chosen.recalledAt !== null,
      availableQuantity: chosen.quantity ?? 0,
    });

    if (issues.length > 0) {
      throw new Error(issues.map((i) => i.message).join(' '));
    }

    // ── Stock, checked before anything is written ──────────
    const current = chosen.quantity ?? 0;
    const movement = checkMovement('ADMINISTRATION', 1, current);
    if (!movement.ok) throw new Error(movement.error ?? 'That batch has no stock left here.');

    // ── The record ─────────────────────────────────────────
    const [administration] = await tx
      .insert(vaccineAdministration)
      .values({
        organisationId: actor.organisationId,
        submissionId: input.submissionId,
        consultationId: row.consultationId ?? null,
        patientId: row.patientId,
        branchId: input.branchId,
        clinicianId: input.clinicianId,
        productId: chosen.productId,
        batchId: chosen.batchId,
        clinicianNameSnapshot: signer.fullName,
        registrationNumberSnapshot: signer.gphcNumber,
        vaccineNameSnapshot: chosen.productName,
        batchNumberSnapshot: chosen.batchNumber,
        expiryDateSnapshot: chosen.expiryDate,
        administeredOn: input.administeredOn,
        injectionType: normaliseInjectionType(input.site, input.injectionType),
        site: input.site,
        paymentType: input.paymentType,
        adverseReaction: input.adverseReaction?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .returning({ id: vaccineAdministration.id });

    if (!administration) throw new Error('Could not save the vaccination record.');

    // ── §26.4 — one row per declaration, with its wording ──
    for (const declaration of CLINICIAN_DECLARATIONS) {
      await tx.insert(clinicianDeclaration).values({
        organisationId: actor.organisationId,
        submissionId: input.submissionId,
        administrationId: administration.id,
        clinicianId: input.clinicianId,
        declarationKey: declaration.key,
        declarationTextSnapshot: declaration.text,
        confirmed: input.declarationKeys.includes(declaration.key),
      });
    }

    // ── Stock out ──────────────────────────────────────────
    await tx.insert(stockMovement).values({
      organisationId: actor.organisationId,
      branchId: input.branchId,
      batchId: chosen.batchId,
      kind: 'ADMINISTRATION',
      quantity: 1,
      reason: `Administered to ${row.patientFirstName} ${row.patientLastName}`,
      userId: actor.userId,
      reference: administration.id,
    });

    await tx
      .update(stockLevel)
      .set({ quantity: movement.resulting, updatedAt: new Date() })
      .where(
        and(eq(stockLevel.batchId, chosen.batchId), eq(stockLevel.branchId, input.branchId)),
      );

    // ── The GP is told, and we record that we said so ──────
    if (row.gpSurgeryId) {
      const [surgery] = await tx
        .select({ email: gpSurgery.email })
        .from(gpSurgery)
        .where(eq(gpSurgery.id, row.gpSurgeryId))
        .limit(1);

      await tx.insert(gpNotification).values({
        organisationId: actor.organisationId,
        consultationId: row.consultationId ?? null,
        administrationId: administration.id,
        gpSurgeryId: row.gpSurgeryId,
        recipientSnapshot: surgery?.email ?? 'unknown',
        status: 'QUEUED',
      });
    }

    /*
     * §10 — register it.
     *
     * The path is a route that regenerates the record from data that cannot
     * change, not a stored file. Nothing is written to the bucket at this
     * moment, and storing a snapshot now would just be a second copy to keep
     * in step with the first.
     */
    await registerDocument(tx, {
      organisationId: actor.organisationId,
      category: 'VACCINATION_RECORD',
      title: `${chosen.productName} — ${row.patientFirstName} ${row.patientLastName}`,
      storagePath: `/vaccinations/${input.submissionId}`,
      patientId: row.patientId,
      submissionId: input.submissionId,
      consultationId: row.consultationId ?? null,
      mimeType: 'application/pdf',
      createdBy: actor.userId,
    });

    // ── The questionnaire is now clinical history ──────────
    await changeSubmissionStatus(tx, {
      organisationId: actor.organisationId,
      submissionId: input.submissionId,
      to: 'COMPLETED',
      by: { userId: actor.userId, label: actor.fullName },
      reason: `Vaccination recorded — ${chosen.productName}, batch ${chosen.batchNumber}`,
      branchId: input.branchId,
    });

    return {
      result: { administrationId: administration.id, remaining: movement.resulting },
      audit: {
        action: 'vaccination.recorded',
        entityType: 'vaccine_administration',
        entityId: administration.id,
        after: {
          vaccine: chosen.productName,
          batch: chosen.batchNumber,
          site: input.site,
          clinician: signer.fullName,
        },
      },
    };
  });

export async function recordVaccination(input: RecordVaccinationInput) {
  try {
    const result = await record(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('recordVaccination failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to record a vaccination.'
          : error instanceof Error
            ? error.message
            : 'Could not save the vaccination. Please try again.',
    };
  }
}
