/**
 * Form runtime.
 *
 * Takes a schema produced by the Service Designer plus the answers so far, and
 * works out which fields are currently visible and whether the submission is
 * valid.
 *
 * Like the rules engine, this is pure — no I/O, no React. The React components
 * in `src/components/form-runtime/` render whatever this returns.
 *
 * Critical behaviour: a hidden field is never validated and never submitted.
 * If a patient answers "Yes" to allergies, fills in the detail box, then
 * changes their answer to "No", the detail must not be stored — otherwise the
 * clinical record contradicts itself.
 */

import type {
  FormField,
  FormSchema,
  FormStep,
  ValidationIssue,
  ValidationResult,
  VisibilityRule,
} from '@/types/form-schema';

type Answers = Record<string, unknown>;

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

/** All rules must pass. No rules means always visible. */
export function isVisible(
  item: { visibleWhen?: VisibilityRule[] },
  answers: Answers,
): boolean {
  if (!item.visibleWhen || item.visibleWhen.length === 0) return true;
  return item.visibleWhen.every((rule) => evaluateVisibilityRule(rule, answers));
}

/**
 * Expands a field into itself plus any fields it reveals, given current answers.
 * Revealed fields can themselves reveal further fields, so this recurses.
 */
export function expandField(field: FormField, answers: Answers): FormField[] {
  if (!isVisible(field, answers)) return [];

  const result: FormField[] = [field];
  const value = answers[field.id];

  for (const reveal of field.reveals ?? []) {
    const triggered = Array.isArray(value)
      ? value.includes(reveal.whenValue)
      : value === reveal.whenValue;

    if (triggered) {
      for (const child of reveal.fields) {
        result.push(...expandField(child, answers));
      }
    }
  }
  return result;
}

/** Every field currently visible in a step, including revealed children. */
export function visibleFieldsForStep(step: FormStep, answers: Answers): FormField[] {
  if (!isVisible(step, answers)) return [];
  return step.fields.flatMap((field) => expandField(field, answers));
}

/** Every field currently visible across the whole form. */
export function visibleFields(schema: FormSchema, answers: Answers): FormField[] {
  return schema.steps.flatMap((step) => visibleFieldsForStep(step, answers));
}

export function visibleSteps(schema: FormSchema, answers: Answers): FormStep[] {
  return schema.steps.filter((step) => isVisible(step, answers));
}

/**
 * Strips answers belonging to fields that are no longer visible.
 *
 * Call this before persisting. Without it, changing an answer leaves orphaned
 * data behind that contradicts the record — a clinical safety problem, not
 * just untidiness.
 */
export function pruneHiddenAnswers(schema: FormSchema, answers: Answers): Answers {
  const visibleIds = new Set(visibleFields(schema, answers).map((f) => f.id));
  const pruned: Answers = {};

  for (const [key, value] of Object.entries(answers)) {
    if (visibleIds.has(key)) pruned[key] = value;
  }
  return pruned;
}

function validateField(field: FormField, value: unknown): ValidationIssue | null {
  const fail = (message: string): ValidationIssue => ({
    fieldId: field.id,
    fieldLabel: field.label,
    message: field.validation?.message ?? message,
  });

  if (field.type === 'info') return null;

  if (field.required && !isPresent(value)) {
    return fail('This question needs an answer before you can continue.');
  }

  if (!isPresent(value)) return null;

  const v = field.validation;

  if (field.type === 'number' || field.type === 'measurement' || field.type === 'scale') {
    const n = Number(value);
    if (Number.isNaN(n)) return fail('Enter a number.');
    if (v?.min !== undefined && n < v.min) return fail(`Enter a value of ${v.min} or more.`);
    if (v?.max !== undefined && n > v.max) return fail(`Enter a value of ${v.max} or less.`);
  }

  if (typeof value === 'string') {
    if (v?.minLength !== undefined && value.length < v.minLength) {
      return fail(`Use at least ${v.minLength} characters.`);
    }
    if (v?.maxLength !== undefined && value.length > v.maxLength) {
      return fail(`Use ${v.maxLength} characters or fewer.`);
    }
    if (v?.pattern && !new RegExp(v.pattern).test(value)) {
      return fail('Check the format of your answer.');
    }
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return fail('Enter an email address in the format name@example.com');
    }
  }

  return null;
}

/**
 * Validates only what is currently visible.
 *
 * `includeClinicianOnly` is false on the patient-facing form — those questions
 * are answered by the pharmacist at the appointment, so requiring them from the
 * patient would block submission.
 */
export function validateForm(
  schema: FormSchema,
  answers: Answers,
  options: { includeClinicianOnly?: boolean } = {},
): ValidationResult {
  const { includeClinicianOnly = false } = options;

  const fields = visibleFields(schema, answers).filter((f) =>
    includeClinicianOnly ? true : !f.clinicianOnly,
  );

  const issues = fields
    .map((field) => validateField(field, answers[field.id]))
    .filter((issue): issue is ValidationIssue => issue !== null);

  return { valid: issues.length === 0, issues };
}

/** Validates a single step — used for step-by-step progression. */
export function validateStep(
  step: FormStep,
  answers: Answers,
  options: { includeClinicianOnly?: boolean } = {},
): ValidationResult {
  const { includeClinicianOnly = false } = options;

  const fields = visibleFieldsForStep(step, answers).filter((f) =>
    includeClinicianOnly ? true : !f.clinicianOnly,
  );

  const issues = fields
    .map((field) => validateField(field, answers[field.id]))
    .filter((issue): issue is ValidationIssue => issue !== null);

  return { valid: issues.length === 0, issues };
}

/**
 * Assigns sequential question numbers across the whole form, so the client can
 * say "question 14 needs rewording" — which he asked for explicitly.
 */
export function numberQuestions(schema: FormSchema): FormSchema {
  let counter = 0;

  const numberField = (field: FormField): FormField => {
    if (field.type === 'info') return field;
    counter += 1;
    return {
      ...field,
      number: counter,
      reveals: field.reveals?.map((r) => ({
        ...r,
        fields: r.fields.map(numberField),
      })),
    };
  };

  return {
    ...schema,
    steps: schema.steps.map((step) => ({ ...step, fields: step.fields.map(numberField) })),
  };
}

/**
 * Collects hidden metadata from selected options — a GP surgery's NHS email,
 * a vaccine's batch number and expiry. The patient never sees these.
 */
export function collectMetadata(schema: FormSchema, answers: Answers): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  for (const field of visibleFields(schema, answers)) {
    if (!field.storeMetadataAs || !field.options) continue;
    const selected = field.options.find((o) => o.value === answers[field.id]);
    if (selected?.metadata) metadata[field.storeMetadataAs] = selected.metadata;
  }
  return metadata;
}
