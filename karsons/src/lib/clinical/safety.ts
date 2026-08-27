/**
 * Clinical safety checks.
 *
 * These run at the point a pharmacist is about to administer or supply
 * something. They are the last line of defence before a mistake reaches a
 * patient.
 *
 * Design principle: a BLOCK stops the action outright. A WARN requires the
 * pharmacist to acknowledge it explicitly, and the acknowledgement is recorded
 * against the consultation with their name.
 *
 * We do not silently pass anything. A check that cannot be performed — because
 * data is missing — returns a warning saying so. Absence of evidence is not
 * evidence of safety.
 */

export type SafetySeverity = 'BLOCK' | 'WARN' | 'INFO';

export interface SafetyFinding {
  code: string;
  severity: SafetySeverity;
  /** Shown to the pharmacist. Says what is wrong and what to do about it. */
  message: string;
  detail?: string;
}

export interface SafetyResult {
  findings: SafetyFinding[];
  /** True when nothing blocks. Warnings still require acknowledgement. */
  canProceed: boolean;
  requiresAcknowledgement: boolean;
}

export interface PatientAllergy {
  substance: string;
  severity?: string | null;
}

export interface ProductForCheck {
  id: string;
  name: string;
  /** Substances present in or derived from the product, e.g. egg, gelatin. */
  allergens: string[];
}

export interface BatchForCheck {
  batchNumber: string;
  expiryDate: Date;
  recalledAt?: Date | null;
  recallReason?: string | null;
}

/**
 * Common alternative names for allergens. A patient records "eggs"; a product
 * lists "ovalbumin". Without this mapping the check silently passes.
 *
 * This list is deliberately conservative — it exists to catch obvious misses,
 * not to replace a pharmacist reading the label.
 */
const ALLERGEN_SYNONYMS: Record<string, string[]> = {
  egg: ['egg', 'eggs', 'ovalbumin', 'egg protein', 'hen egg'],
  gelatin: ['gelatin', 'gelatine', 'porcine gelatin', 'bovine gelatin'],
  latex: ['latex', 'natural rubber latex', 'rubber'],
  neomycin: ['neomycin', 'neomycin sulphate', 'neomycin sulfate'],
  gentamicin: ['gentamicin', 'gentamycin'],
  polysorbate: ['polysorbate', 'polysorbate 80', 'tween 80'],
  thiomersal: ['thiomersal', 'thimerosal', 'merthiolate'],
  penicillin: ['penicillin', 'amoxicillin', 'benzylpenicillin', 'phenoxymethylpenicillin'],
  formaldehyde: ['formaldehyde', 'formalin'],
};

function normalise(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Expands a term into itself plus any known synonyms. */
function expandTerm(term: string): Set<string> {
  const normalised = normalise(term);
  const expanded = new Set<string>([normalised]);

  for (const synonyms of Object.values(ALLERGEN_SYNONYMS)) {
    if (synonyms.some((s) => normalised.includes(s) || s.includes(normalised))) {
      synonyms.forEach((s) => expanded.add(s));
    }
  }
  return expanded;
}

/**
 * Cross-checks a product's allergens against the patient's recorded allergies.
 *
 * A match is a BLOCK, not a warning. The pharmacist can override by recording a
 * clinical justification, but it must be a deliberate act — this is exactly the
 * failure mode that harms someone.
 */
export function checkAllergies(
  allergies: PatientAllergy[],
  product: ProductForCheck,
): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  if (product.allergens.length === 0) return findings;

  for (const allergy of allergies) {
    const patientTerms = expandTerm(allergy.substance);

    for (const allergen of product.allergens) {
      const productTerms = expandTerm(allergen);
      const overlap = [...patientTerms].some((t) => productTerms.has(t));

      if (overlap) {
        findings.push({
          code: 'ALLERGY_CONFLICT',
          severity: 'BLOCK',
          message: `${product.name} contains ${allergen}, and this patient is recorded as allergic to ${allergy.substance}.`,
          detail: allergy.severity
            ? `Recorded severity: ${allergy.severity}. Do not proceed without clinical justification.`
            : 'Do not proceed without clinical justification.',
        });
      }
    }
  }
  return findings;
}

/** Expiry and recall checks on the specific batch about to be used. */
export function checkBatch(batch: BatchForCheck, now = new Date()): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  if (batch.recalledAt) {
    findings.push({
      code: 'BATCH_RECALLED',
      severity: 'BLOCK',
      message: `Batch ${batch.batchNumber} has been recalled and must not be used.`,
      detail: batch.recallReason ?? 'Quarantine this stock and contact your supervising pharmacist.',
    });
  }

  if (batch.expiryDate < now) {
    findings.push({
      code: 'BATCH_EXPIRED',
      severity: 'BLOCK',
      message: `Batch ${batch.batchNumber} expired on ${batch.expiryDate.toLocaleDateString('en-GB')}.`,
      detail: 'Remove from usable stock and record as wastage.',
    });
  } else {
    const daysRemaining = Math.floor((batch.expiryDate.getTime() - now.getTime()) / 86_400_000);
    if (daysRemaining <= 30) {
      findings.push({
        code: 'BATCH_EXPIRING_SOON',
        severity: 'INFO',
        message: `Batch ${batch.batchNumber} expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
        detail: 'Use this batch first.',
      });
    }
  }
  return findings;
}

export function checkStock(available: number, required: number, productName: string): SafetyFinding[] {
  if (available >= required) return [];

  return [{
    code: 'INSUFFICIENT_STOCK',
    severity: 'BLOCK',
    message: `Not enough ${productName} in stock at this branch.`,
    detail: `Required: ${required}. Available: ${available}. Check another branch or receive new stock first.`,
  }];
}

export interface RecentSupply {
  branchName: string;
  suppliedAt: Date;
  medicine: string;
  months: number;
}

/**
 * Flags a patient obtaining supply at more than one branch inside a window.
 *
 * The client raised this concern directly. Because patients are held at
 * organisation level rather than per branch, we can actually detect it — a
 * patient collecting at Onchan on Monday and Kirk Michael on Thursday is
 * visible where it would not be in two separate systems.
 *
 * WARN rather than BLOCK. There are legitimate explanations, including travel
 * and a genuine replacement for a damaged pen. It needs a conversation, not an
 * automatic refusal.
 */
export function checkCrossBranchSupply(
  recentSupplies: RecentSupply[],
  currentBranchName: string,
  now = new Date(),
  windowDays = 21,
): SafetyFinding[] {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);

  const elsewhere = recentSupplies.filter(
    (s) => s.suppliedAt >= cutoff && s.branchName !== currentBranchName,
  );

  if (elsewhere.length === 0) return [];

  const mostRecent = elsewhere.reduce((a, b) => (a.suppliedAt > b.suppliedAt ? a : b));
  const daysAgo = Math.floor((now.getTime() - mostRecent.suppliedAt.getTime()) / 86_400_000);

  return [{
    code: 'CROSS_BRANCH_SUPPLY',
    severity: 'WARN',
    message: `This patient received ${mostRecent.medicine} at ${mostRecent.branchName} ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago.`,
    detail: 'Confirm with the patient before supplying again.',
  }];
}

/** Warns when a check could not be performed because data is missing. */
export function checkDataCompleteness(input: {
  hasAllergyHistory: boolean;
  hasIdentityVerification: boolean;
}): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  if (!input.hasAllergyHistory) {
    findings.push({
      code: 'NO_ALLERGY_HISTORY',
      severity: 'WARN',
      message: 'No allergy history is recorded for this patient.',
      detail: 'Ask the patient and record the answer before proceeding.',
    });
  }

  if (!input.hasIdentityVerification) {
    findings.push({
      code: 'IDENTITY_NOT_VERIFIED',
      severity: 'BLOCK',
      message: 'Patient identity has not been verified.',
      detail: 'Confirm identity before recording any clinical action.',
    });
  }
  return findings;
}

/** Combines findings from every check into a single result. */
export function summariseSafety(findings: SafetyFinding[]): SafetyResult {
  const hasBlock = findings.some((f) => f.severity === 'BLOCK');
  const hasWarn = findings.some((f) => f.severity === 'WARN');

  return {
    findings: [...findings].sort((a, b) => {
      const order = { BLOCK: 0, WARN: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    }),
    canProceed: !hasBlock,
    requiresAcknowledgement: hasWarn,
  };
}

/** Runs every applicable check for an administration. */
export function runPreAdministrationChecks(input: {
  allergies: PatientAllergy[];
  product: ProductForCheck;
  batch: BatchForCheck;
  availableStock: number;
  requiredQuantity: number;
  identityVerified: boolean;
  hasAllergyHistory: boolean;
  now?: Date;
}): SafetyResult {
  const now = input.now ?? new Date();

  return summariseSafety([
    ...checkDataCompleteness({
      hasAllergyHistory: input.hasAllergyHistory,
      hasIdentityVerification: input.identityVerified,
    }),
    ...checkAllergies(input.allergies, input.product),
    ...checkBatch(input.batch, now),
    ...checkStock(input.availableStock, input.requiredQuantity, input.product.name),
  ]);
}
