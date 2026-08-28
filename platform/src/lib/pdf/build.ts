/**
 * Assembles the data a consultation PDF needs.
 *
 * Kept apart from rendering so the shape can be tested without producing a
 * document, and so the query is reviewable on its own — this pulls patient
 * identifiers and clinical detail together in one place, which is exactly the
 * sort of thing worth being able to read at a glance.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  consultation, patient, service, branch, company, clinician, batch, product,
  submission, formVersion, ruleEvaluation,
} from '@/lib/db/schema';
import { allocatePrescriptionNumber } from './numbering';
import { visibleFields } from '@/lib/forms/runtime';
import { formatMoney } from '@/lib/units';
import type { PrescriptionData } from './prescription';
import type { Answers, FormField, FormSchema } from '@/types/form-schema';

/** Renders one answer as the short string a dispensing pharmacist can scan. */
function present(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';

  if (typeof value === 'object' && 'si' in (value as object)) {
    const si = (value as { si: number | null }).si;
    if (si === null) return '—';
    return field.measurementKind === 'weight' ? `${si} kg` : `${si} cm`;
  }

  if (Array.isArray(value)) {
    return value
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
      .join(', ');
  }

  if (value === true) return 'Agreed';
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'na') return 'N/A';

  return field.options?.find((o) => o.value === value)?.label ?? String(value);
}

export async function buildPrescriptionData(
  organisationId: string,
  consultationId: string,
): Promise<PrescriptionData | null> {
  const rows = await db
    .select({
      consultationId: consultation.id,
      completedAt: consultation.completedAt,
      createdAt: consultation.createdAt,
      clinicalData: consultation.clinicalData,
      notes: consultation.notes,
      submissionId: consultation.submissionId,

      serviceName: service.name,
      priceMinor: service.priceMinor,

      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      addressLine1: patient.addressLine1,
      town: patient.town,
      postcode: patient.postcode,
      phone: patient.phone,
      email: patient.email,

      branchName: branch.name,
      branchCode: branch.code,
      branchPhone: branch.phone,

      companyName: company.name,
      companyGphc: company.gphcNumber,
      companyAddress: company.addressLine1,
      companyTown: company.town,
      companyPostcode: company.postcode,

      clinicianName: clinician.fullName,
      clinicianGphc: clinician.gphcNumber,
      clinicianSignature: clinician.signatureUrl,

      productName: product.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
    })
    .from(consultation)
    .innerJoin(patient, eq(consultation.patientId, patient.id))
    .innerJoin(service, eq(consultation.serviceId, service.id))
    .innerJoin(branch, eq(consultation.branchId, branch.id))
    .innerJoin(company, eq(consultation.companyId, company.id))
    .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
    .leftJoin(batch, eq(consultation.batchId, batch.id))
    .leftJoin(product, eq(batch.productId, product.id))
    .where(
      and(
        eq(consultation.id, consultationId),
        eq(consultation.organisationId, organisationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const clinical = (row.clinicalData ?? {}) as Record<string, unknown>;

  // The consultation summary on the reverse: what the patient answered, plus
  // what the clinician recorded on the day.
  const summary: { label: string; value: string }[] = [];
  let advice: string[] = [];
  let alert: string | null = null;

  if (row.submissionId) {
    const subRows = await db
      .select({
        answers: submission.answers,
        schema: formVersion.schema,
      })
      .from(submission)
      .innerJoin(formVersion, eq(submission.formVersionId, formVersion.id))
      .where(eq(submission.id, row.submissionId))
      .limit(1);

    const sub = subRows[0];
    if (sub) {
      const schema = sub.schema as unknown as FormSchema;
      const answers = (sub.answers ?? {}) as Answers;

      for (const field of visibleFields(schema, answers, { includeClinicianOnly: true })) {
        if (field.type === 'infoBlock' || field.type === 'signature') continue;
        summary.push({ label: field.label, value: present(field, answers[field.id]) });
      }

      // A question from the patient must reach whoever hands the medicine over.
      const question = answers.questionsForPharmacist;
      if (typeof question === 'string' && question.trim()) {
        alert = `The patient asked: “${question.trim()}”`;
      }
    }

    const evaluation = await db
      .select({ advice: ruleEvaluation.advice, outcome: ruleEvaluation.outcome })
      .from(ruleEvaluation)
      .where(eq(ruleEvaluation.submissionId, row.submissionId))
      .limit(1);

    advice = (evaluation[0]?.advice as string[] | undefined) ?? [];
  }

  for (const [key, label] of [
    ['siteOfAdministration', 'Site of administration'],
    ['injectionType', 'Type of injection'],
    ['fundedBy', 'Funded by'],
  ] as const) {
    if (typeof clinical[key] === 'string') {
      summary.push({ label, value: clinical[key] as string });
    }
  }
  if (row.notes) summary.push({ label: 'Notes', value: row.notes });

  const issuedAt = row.completedAt ?? row.createdAt;

  /*
   * Allocated by the database, not computed here.
   *
   * The previous version took digits out of the consultation UUID and reduced
   * them modulo a million, which collides. Two supplies sharing a prescription
   * number is a real operational problem: it is the reference a practice quotes
   * back on a query or a recall.
   *
   * Falls back to the consultation reference only when allocation genuinely
   * fails, and marks it so, rather than inventing a number that looks official.
   */
  const allocated = await allocatePrescriptionNumber(row.consultationId);

  return {
    prescriptionNumber:
      allocated ?? `UNNUMBERED-${row.consultationId.slice(0, 8).toUpperCase()}`,
    issuedAt,
    company: {
      name: row.companyName,
      gphcNumber: row.companyGphc,
      addressLine1: row.companyAddress,
      town: row.companyTown,
      postcode: row.companyPostcode,
    },
    branch: { name: row.branchName, phone: row.branchPhone },
    patient: {
      fullName: `${row.firstName} ${row.lastName}`,
      dateOfBirth: row.dateOfBirth,
      addressLine1: row.addressLine1,
      town: row.town,
      postcode: row.postcode,
      phone: row.phone,
      email: row.email,
    },
    medicine: {
      name: row.productName ?? row.serviceName,
      strength: typeof clinical.strength === 'string' ? clinical.strength : '—',
      directions:
        typeof clinical.directions === 'string'
          ? clinical.directions
          : 'Administered at the pharmacy',
      quantity: row.batchNumber ? '1 dose' : '—',
      duration: '—',
    },
    price: {
      amount: row.priceMinor !== null ? formatMoney(row.priceMinor) : 'No charge',
      paid: clinical.fundedBy === 'NHS' || clinical.paid === true,
      method: typeof clinical.fundedBy === 'string' ? String(clinical.fundedBy) : null,
    },
    prescriber: {
      fullName: row.clinicianName ?? 'Not recorded',
      gphcNumber: row.clinicianGphc ?? '—',
      signatureDataUrl: row.clinicianSignature,
    },
    alert,
    consultation: {
      serviceName: row.serviceName,
      completedAt: issuedAt,
      outcome: null,
      summary,
      advice,
    },
  };
}
