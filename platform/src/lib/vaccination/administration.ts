/**
 * Recording a vaccination.
 *
 * Written as a general vaccination engine, not a flu one: §28.2 says COVID,
 * hepatitis, shingles and the rest run through the same machinery, so nothing
 * in this file names a disease.
 *
 * Two rules from the specification are encoded here rather than left to the
 * form, because both are the kind that quietly stop being true when someone
 * builds a second screen:
 *
 *   §27.4  an injection type must not be demanded where nothing is injected
 *   §27.5  a record cannot complete until it is actually complete
 */

export const INJECTION_TYPES = ['INTRAMUSCULAR', 'SUBCUTANEOUS', 'SUBDERMAL'] as const;
export type InjectionType = (typeof INJECTION_TYPES)[number];

export const ADMINISTRATION_SITES = [
  'RIGHT_DELTOID', 'LEFT_DELTOID', 'RIGHT_THIGH', 'LEFT_THIGH',
  'ORAL', 'NASAL', 'TOPICAL', 'SELF_INJECTION',
] as const;
export type AdministrationSite = (typeof ADMINISTRATION_SITES)[number];

export const SITE_LABELS: Record<AdministrationSite, string> = {
  RIGHT_DELTOID: 'Right deltoid',
  LEFT_DELTOID: 'Left deltoid',
  RIGHT_THIGH: 'Right thigh',
  LEFT_THIGH: 'Left thigh',
  ORAL: 'Oral',
  NASAL: 'Nasal',
  TOPICAL: 'Topical',
  SELF_INJECTION: 'Self-injection (abdomen, thigh or upper arm)',
};

export const INJECTION_LABELS: Record<InjectionType, string> = {
  INTRAMUSCULAR: 'Intramuscular',
  SUBCUTANEOUS: 'Subcutaneous',
  SUBDERMAL: 'Subdermal',
};

/** Routes where nothing is injected, so no needle goes anywhere. */
const NON_INJECTED: readonly AdministrationSite[] = ['ORAL', 'NASAL', 'TOPICAL'];

/**
 * Does this route need an injection type?
 *
 * §27.4. Asking "intramuscular or subcutaneous?" about a nasal spray produces
 * a record that is either wrong or blank, and a required field nobody can
 * answer honestly gets filled in with whatever clears the form.
 */
export function needsInjectionType(site: AdministrationSite): boolean {
  return !NON_INJECTED.includes(site);
}

export interface AdministrationDraft {
  patientId: string | null;
  clinicianId: string | null;
  branchId: string | null;
  batchId: string | null;
  site: AdministrationSite | null;
  injectionType: InjectionType | null;
  administeredOn: string | null;
  consentRecorded: boolean;
  suitabilityConfirmed: boolean;
  declarationsConfirmed: boolean;
  /** Expiry of the chosen batch, so an out-of-date one can be refused here. */
  batchExpiry?: string | null;
  batchRecalled?: boolean;
  availableQuantity?: number | null;
}

export interface CompletionIssue {
  field: string;
  message: string;
}

/**
 * Everything §27.5 requires before a vaccination record may be completed.
 *
 * Returns every problem rather than the first, because a pharmacist standing
 * with a patient should see the whole list once, not discover it a field at a
 * time.
 */
export function validateAdministration(
  draft: AdministrationDraft,
  today = new Date(),
): CompletionIssue[] {
  const issues: CompletionIssue[] = [];

  if (!draft.patientId) {
    issues.push({ field: 'patientId', message: 'Choose the patient this record belongs to.' });
  }
  if (!draft.consentRecorded) {
    issues.push({ field: 'consent', message: 'Consent has not been recorded for this consultation.' });
  }
  if (!draft.suitabilityConfirmed) {
    issues.push({ field: 'suitability', message: 'Confirm the patient is suitable before recording a vaccination.' });
  }
  if (!draft.branchId) {
    issues.push({ field: 'branchId', message: 'Choose the branch this was given at.' });
  }
  if (!draft.clinicianId) {
    issues.push({ field: 'clinicianId', message: 'Choose the pharmacist who administered it.' });
  }
  if (!draft.administeredOn) {
    issues.push({ field: 'administeredOn', message: 'Record the date it was given.' });
  }

  if (!draft.batchId) {
    issues.push({ field: 'batchId', message: 'Choose the vaccine and batch used.' });
  } else {
    // §28.4 — expired batches cannot be selected, and stock cannot go negative.
    if (draft.batchRecalled) {
      issues.push({ field: 'batchId', message: 'That batch has been recalled and cannot be used.' });
    }
    if (draft.batchExpiry) {
      const expiry = new Date(`${draft.batchExpiry}T23:59:59`);
      if (!Number.isNaN(expiry.getTime()) && expiry < today) {
        issues.push({
          field: 'batchId',
          message: `That batch expired on ${draft.batchExpiry} and cannot be used.`,
        });
      }
    }
    if (draft.availableQuantity != null && draft.availableQuantity <= 0) {
      issues.push({ field: 'batchId', message: 'There is none of that batch left at this branch.' });
    }
  }

  if (!draft.site) {
    issues.push({ field: 'site', message: 'Record where it was given.' });
  } else if (needsInjectionType(draft.site) && !draft.injectionType) {
    issues.push({ field: 'injectionType', message: 'Record the type of injection.' });
  }

  if (!draft.declarationsConfirmed) {
    issues.push({ field: 'declarations', message: 'Confirm the pharmacist declarations before completing.' });
  }

  return issues;
}

/**
 * The injection type that should be stored.
 *
 * A route that injects nothing stores null even if the form still held a value
 * from before the route was changed — otherwise a nasal spray ends up recorded
 * as intramuscular because of a stale field the user never saw again.
 */
export function normaliseInjectionType(
  site: AdministrationSite | null,
  injectionType: InjectionType | null,
): InjectionType | null {
  if (!site || !needsInjectionType(site)) return null;
  return injectionType;
}

/**
 * The declarations a pharmacist confirms before completing — §26.4.
 *
 * Keys are stable so reporting survives a rewording; the text is snapshotted
 * onto each record so what was actually agreed to stays provable.
 */
export const CLINICIAN_DECLARATIONS: { key: string; text: string }[] = [
  {
    key: 'verified-information',
    text: 'I have verified the accuracy of the patient’s pre-consultation information, including medical conditions and allergies, and determined that vaccination is clinically appropriate and the criteria are met under the applicable PGD.',
  },
  {
    key: 'leaflet-offered',
    text: 'I have offered the patient a patient information leaflet and discussed it as required.',
  },
  {
    key: 'side-effects-advised',
    text: 'I have advised the patient about possible side effects and their management.',
  },
  {
    key: 'monitoring-advised',
    text: 'I have advised the patient to remain in the pharmacy for 10–15 minutes after vaccination for monitoring.',
  },
];
