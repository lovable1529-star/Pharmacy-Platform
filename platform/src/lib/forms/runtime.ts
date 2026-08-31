/**
 * Form runtime.
 *
 * Takes a schema plus the answers so far, and works out which fields are
 * currently visible and whether the submission is valid.
 *
 * Pure — no React, no I/O, no clock. That is what lets the Service Designer's
 * live preview and the real patient form share one implementation, and it is
 * what makes every conditional rule exhaustively testable.
 */

import type {
  Answers, ConsentClause, FormField, FormSchema, FormStep, ValidationIssue,
  ValidationResult, VisibilityRule,
} from '@/types/form-schema';

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export function evaluateVisibilityRule(rule: VisibilityRule, answers: Answers): boolean {
  const actual = answers[rule.field];

  switch (rule.operator) {
    case 'exists':
      return isPresent(actual);
    case 'notExists':
      return !isPresent(actual);
    case 'eq':
      return actual === rule.value;
    case 'neq':
      return actual !== rule.value;
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(actual);
    case 'nin':
      return Array.isArray(rule.value) && !rule.value.includes(actual);
    default:
      return true;
  }
}

/** All rules must pass. An empty rule list means always visible. */
export function isVisible(
  item: { visibleWhen?: VisibilityRule[] },
  answers: Answers,
): boolean {
  if (!item.visibleWhen?.length) return true;
  return item.visibleWhen.every((rule) => evaluateVisibilityRule(rule, answers));
}

/**
 * A field plus any fields its current answer reveals, flattened in order.
 * Reveals nest, because "Yes → which ones? → and the reaction?" is a real shape
 * in his forms.
 */
export function expandField(field: FormField, answers: Answers): FormField[] {
  const result: FormField[] = [field];
  if (!field.reveals?.length) return result;

  const current = answers[field.id];
  for (const reveal of field.reveals) {
    if (current !== reveal.whenValue) continue;
    for (const child of reveal.fields) {
      if (isVisible(child, answers)) result.push(...expandField(child, answers));
    }
  }
  return result;
}

export interface VisibleFieldOptions {
  /** Patient-facing forms hide clinician-only fields entirely. */
  includeClinicianOnly?: boolean;
}

export function visibleFieldsForStep(
  step: FormStep,
  answers: Answers,
  options: VisibleFieldOptions = {},
): FormField[] {
  const { includeClinicianOnly = false } = options;

  return step.fields
    .filter((f) => isVisible(f, answers))
    .flatMap((f) => expandField(f, answers))
    .filter((f) => (includeClinicianOnly ? true : !f.clinicianOnly));
}

export function visibleSteps(
  schema: FormSchema,
  answers: Answers,
  options: VisibleFieldOptions = {},
): FormStep[] {
  return schema.steps
    .filter((step) => isVisible(step, answers))
    .filter((step) => visibleFieldsForStep(step, answers, options).length > 0);
}

export function visibleFields(
  schema: FormSchema,
  answers: Answers,
  options: VisibleFieldOptions = {},
): FormField[] {
  return visibleSteps(schema, answers, options).flatMap((step) =>
    visibleFieldsForStep(step, answers, options),
  );
}

/**
 * A step is locked until every field it depends on has an answer.
 * `unlockedBy` names fields in earlier steps — the verification-gate pattern.
 */
export function isStepUnlocked(step: FormStep, answers: Answers): boolean {
  if (!step.unlockedBy?.length) return true;
  return step.unlockedBy.every((fieldId) => isPresent(answers[fieldId]));
}

/**
 * Removes answers to fields that are no longer visible.
 *
 * Answer "yes" to allergies, type the detail, change to "no" — the typed detail
 * must not persist, or the record contradicts itself. A regulator will ask
 * about exactly this, and no demo ever shows it.
 */
export function pruneHiddenAnswers(schema: FormSchema, answers: Answers): Answers {
  const visible = new Set(
    visibleFields(schema, answers, { includeClinicianOnly: true }).map((f) => f.id),
  );

  const pruned: Answers = {};
  for (const [key, value] of Object.entries(answers)) {
    if (visible.has(key)) pruned[key] = value;
  }
  return pruned;
}

function validateField(field: FormField, answers: Answers): ValidationIssue | null {
  const value = answers[field.id];
  const rules = field.validation;

  if (field.required && !isPresent(value)) {
    return {
      fieldId: field.id,
      fieldLabel: field.label,
      message: rules?.message ?? 'This answer is needed before you can continue.',
    };
  }

  if (!isPresent(value)) return null;

  if (typeof value === 'number' || (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value)))) {
    const numeric = Number(value);
    if (rules?.min !== undefined && numeric < rules.min) {
      return {
        fieldId: field.id,
        fieldLabel: field.label,
        message: rules.message ?? `Enter a value of at least ${rules.min}.`,
      };
    }
    if (rules?.max !== undefined && numeric > rules.max) {
      return {
        fieldId: field.id,
        fieldLabel: field.label,
        message: rules.message ?? `Enter a value no greater than ${rules.max}.`,
      };
    }
  }

  if (typeof value === 'string') {
    if (rules?.minLength !== undefined && value.length < rules.minLength) {
      return {
        fieldId: field.id,
        fieldLabel: field.label,
        message: rules.message ?? `Use at least ${rules.minLength} characters.`,
      };
    }
    if (rules?.maxLength !== undefined && value.length > rules.maxLength) {
      return {
        fieldId: field.id,
        fieldLabel: field.label,
        message: rules.message ?? `Use no more than ${rules.maxLength} characters.`,
      };
    }
    /*
     * A pattern is author-supplied text, and `new RegExp` THROWS on an invalid
     * one — which would take down validation for the whole step rather than
     * failing this single field. An unparseable pattern is treated as no
     * pattern: the wrong answer to let through, but far better than a patient
     * meeting a crash halfway down a consent form.
     */
    if (rules?.pattern) {
      let expression: RegExp | null = null;
      try {
        expression = new RegExp(rules.pattern);
      } catch {
        expression = null;
      }
      if (expression && !expression.test(value)) {
        return {
          fieldId: field.id,
          fieldLabel: field.label,
          message: rules.message ?? 'That does not look right — please check it.',
        };
      }
    }
  }

  return null;
}

/**
 * Does this field ask the patient for nothing?
 *
 * An information block and a leaflet block are both positions on a page rather
 * than questions. They take no answer, so they must never be validated, never
 * be numbered, and never appear in a summary of what somebody answered.
 *
 * Named once rather than repeated as `type === 'infoBlock' || type === ...` in
 * seven files, because that is exactly the list that rots: the eighth place
 * gets missed and a block silently becomes a question that can never be
 * answered — which, marked required, makes a form impossible to submit.
 */
export function carriesNoAnswer(field: Pick<FormField, 'type'>): boolean {
  return field.type === 'infoBlock' || field.type === 'resourceList';
}

export function validateStep(
  step: FormStep,
  answers: Answers,
  options: VisibleFieldOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const field of visibleFieldsForStep(step, answers, options)) {
    if (carriesNoAnswer(field) || field.type === 'derived') continue;
    const issue = validateField(field, answers);
    if (issue) issues.push(issue);
  }
  return { valid: issues.length === 0, issues };
}

export function validateForm(
  schema: FormSchema,
  answers: Answers,
  options: VisibleFieldOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const step of visibleSteps(schema, answers, options)) {
    issues.push(...validateStep(step, answers, options).issues);
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Numbers every question sequentially across the whole form.
 *
 * Only top-level questions are numbered. A revealed follow-up is part of the
 * question that reveals it — "4. Gender" then "if other, please describe" — so
 * it does not take a number of its own. Info blocks are skipped for the same
 * reason: they ask nothing.
 *
 * This matters because the client asked for numbering specifically so he could
 * say "question 7" in feedback. A sequence that visibly skips from 4 to 6,
 * because 5 is currently hidden, defeats the entire point.
 *
 * Returns a new schema; the input is untouched.
 */
export function numberQuestions(schema: FormSchema): FormSchema {
  let counter = 0;

  const stripNumbers = (field: FormField): FormField => ({
    ...field,
    number: undefined,
    ...(field.reveals?.length
      ? {
          reveals: field.reveals.map((reveal) => ({
            ...reveal,
            fields: reveal.fields.map(stripNumbers),
          })),
        }
      : {}),
  });

  const numberField = (field: FormField): FormField => {
    const numbered: FormField =
      carriesNoAnswer(field) ? { ...field } : { ...field, number: ++counter };

    if (field.reveals?.length) {
      numbered.reveals = field.reveals.map((reveal) => ({
        ...reveal,
        fields: reveal.fields.map(stripNumbers),
      }));
    }
    return numbered;
  };

  return {
    ...schema,
    steps: schema.steps.map((step) => ({ ...step, fields: step.fields.map(numberField) })),
  };
}

/**
 * Pulls hidden metadata from selected options into the submission — the GP's
 * mailbox, the batch number and expiry, the pharmacist's GPhC number.
 */
/**
 * Which consent statements a question shows.
 *
 * The question's own list wins; otherwise the form-wide one. Worth being a
 * named, tested function rather than an inline fallback in the renderer,
 * because getting it backwards would silently show a patient the wrong consent
 * text and still record a valid-looking agreement.
 *
 * An EMPTY list on the field is a deliberate answer, not a missing one — a
 * question set to show no statements must not quietly inherit ten.
 */
export function resolveConsentClauses(
  field: FormField,
  schema: FormSchema,
): ConsentClause[] {
  return field.consentClauses ?? schema.consentClauses ?? [];
}

export function collectMetadata(schema: FormSchema, answers: Answers): Record<string, unknown> {
  const collected: Record<string, unknown> = {};

  for (const field of visibleFields(schema, answers, { includeClinicianOnly: true })) {
    if (!field.storeMetadataAs || !field.options) continue;
    const selected = field.options.find((o) => o.value === answers[field.id]);
    if (selected?.metadata) collected[field.storeMetadataAs] = selected.metadata;
  }

  return collected;
}

/** Every warning currently triggered — including hard stops. */
export interface ActiveWarning {
  fieldId: string;
  message: string;
  severity: 'info' | 'warn' | 'stop';
  /** This warning wants the face-to-face service offered beside it. */
  offerReferral: boolean;
}

export function activeWarnings(
  schema: FormSchema,
  answers: Answers,
): ActiveWarning[] {
  const warnings: ActiveWarning[] = [];

  for (const field of visibleFields(schema, answers, { includeClinicianOnly: true })) {
    if (!field.warnWhen?.length) continue;
    for (const warning of field.warnWhen) {
      if (answers[field.id] === warning.value) {
        warnings.push({
          fieldId: field.id,
          message: warning.message,
          severity: warning.severity,
          offerReferral: warning.offerReferral === true,
        });
      }
    }
  }

  return warnings;
}
