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
import { visibleSteps, visibleFieldsForStep } from '@/lib/forms/runtime';
import { presentAnswer } from '@/lib/forms/present';
import { formatMoney } from '@/lib/units';
import type { PrescriptionData } from './prescription';
import type { Answers, FormField, FormSchema } from '@/types/form-schema';

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

  /*
   * The consultation summary on the reverse, grouped the way the form is.
   *
   * It used to be one flat list of every answered question — twenty-nine rows
   * on the flu form with nothing separating "your measurements" from "consent".
   * A pharmacist reading it back at the counter is looking for one section, and
   * a flat list makes them read all of it to find any of it.
   *
   * The grouping is the questionnaire's own steps, so the printed record and
   * the screen the patient filled in have the same shape.
   */
  const sections: { title: string; entries: { label: string; value: string }[] }[] = [];
  let advice: string[] = [];
  let alert: string | null = null;
  /*
   * The patient's own signature, kept as the picture it is.
   *
   * It was skipped along with info blocks, on the reasoning that a data URL is
   * not a readable answer — true, but the conclusion was wrong. This is the
   * mark that makes the consent record evidence of anything, so it belongs on
   * the printed copy, drawn rather than described.
   */
  let patientSignature: string | null = null;

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

      for (const step of visibleSteps(schema, answers, { includeClinicianOnly: true })) {
        const entries: { label: string; value: string }[] = [];

        for (const field of visibleFieldsForStep(step, answers, { includeClinicianOnly: true })) {
          // An info block asks nothing, and a signature is an image rather than
          // a value — printing its data URL as text helps nobody.
          if (field.type === 'infoBlock') continue;

          if (field.type === 'signature') {
            const signed = answers[field.id];
            if (typeof signed === 'string' && signed.startsWith('data:image')) {
              patientSignature = signed;
            }
            continue;
          }
          entries.push({ label: field.label, value: presentAnswer(field, answers[field.id], answers) });
        }

        // A step whose questions were all hidden by the answers given is not a
        // heading with nothing under it.
        if (entries.length > 0) sections.push({ title: step.title, entries });
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

  // What the pharmacist recorded on the day, kept apart from what the patient
  // answered in advance. Who said what is a distinction that matters on a
  // clinical record.
  const recorded: { label: string; value: string }[] = [];

  for (const [key, label] of [
    ['siteOfAdministration', 'Site of administration'],
    ['injectionType', 'Type of injection'],
    ['fundedBy', 'Funded by'],
  ] as const) {
    if (typeof clinical[key] === 'string') {
      recorded.push({ label, value: clinical[key] as string });
    }
  }
  if (row.notes) recorded.push({ label: 'Notes', value: row.notes });
  if (recorded.length > 0) sections.push({ title: 'Recorded at the appointment', entries: recorded });

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
      sections,
      advice,
      patientSignature,
    },
  };
}
