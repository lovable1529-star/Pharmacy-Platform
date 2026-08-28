/**
 * Consent, captured as its own record.
 *
 * It used to live inside the questionnaire's answers as a boolean, which meant
 * proving what somebody actually agreed to required finding the form version
 * they answered, resolving whether the field overrode the form-wide list, and
 * reassembling the wording. Provable in principle; not answerable in practice
 * when somebody asks in two years.
 *
 * §8A and §25.6 both ask for the same thing: a versioned record carrying the
 * text itself. So the clauses a patient was actually shown are snapshotted at
 * the moment they accept, alongside the version and who captured it.
 *
 * Written for every submission that contains a consent question, not only for
 * the ones that reach a pharmacist — a patient who consented and was then
 * declined still consented, and the record should say so.
 */

import type { Tx } from '@/lib/actions';
import { consentRecord } from '@/lib/db/schema';
import { visibleFields, resolveConsentClauses } from '@/lib/forms/runtime';
import type { FormSchema, Answers } from '@/types/form-schema';

export interface ConsentCapture {
  organisationId: string;
  submissionId: string;
  patientId: string | null;
  schema: FormSchema;
  answers: Answers;
  formVersion: number;
  /** The patient, or the staff member completing it on their behalf. */
  capturedBy: string;
  privacyPolicyVersion?: string | null;
}

/**
 * The exact statements this patient was shown, in the order they saw them.
 *
 * Only visible fields are considered: a consent question hidden by a
 * conditional rule was never put to them, and recording it as agreed would be
 * a false claim.
 */
export function consentTextFor(schema: FormSchema, answers: Answers): string | null {
  const parts: string[] = [];

  for (const field of visibleFields(schema, answers)) {
    if (field.type !== 'consentList') continue;

    const clauses = resolveConsentClauses(field, schema);
    if (clauses.length === 0) continue;

    parts.push(field.label);
    for (const clause of clauses) parts.push(`• ${clause.text}`);
    if (field.confirmLabel) parts.push(`[ticked] ${field.confirmLabel}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/** Did they actually tick it? */
function accepted(schema: FormSchema, answers: Answers): boolean {
  const consentFields = visibleFields(schema, answers).filter((f) => f.type === 'consentList');
  if (consentFields.length === 0) return false;
  return consentFields.every((f) => answers[f.id] === true || answers[f.id] === 'yes');
}

/**
 * Record what was agreed to.
 *
 * Does nothing when the form asks for no consent — a repeat request that only
 * collects a weight has nothing to snapshot, and writing an empty record would
 * make "consent held" untrue everywhere it is later counted.
 */
export async function captureConsent(tx: Tx, input: ConsentCapture): Promise<boolean> {
  const text = consentTextFor(input.schema, input.answers);
  if (!text) return false;

  await tx.insert(consentRecord).values({
    organisationId: input.organisationId,
    patientId: input.patientId,
    submissionId: input.submissionId,
    consentVersion: `form-v${input.formVersion}`,
    consentTextSnapshot: text,
    accepted: accepted(input.schema, input.answers),
    privacyPolicyVersion: input.privacyPolicyVersion ?? null,
    // The consent list and the privacy notice are presented together, so
    // ticking the one acknowledges the other.
    privacyAcknowledged: accepted(input.schema, input.answers),
    capturedBy: input.capturedBy,
  });

  return true;
}
