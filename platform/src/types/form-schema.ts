/**
 * Form schema — the structure the Service Designer emits and the form runtime
 * renders.
 *
 * This is the most important type in the codebase. It is what makes the product
 * a configuration engine rather than a collection of hard-coded forms. If a
 * clinical service cannot be expressed here, the schema needs extending — not
 * the form hard-coding.
 *
 * Two properties carry the whole design:
 *
 *   1. VERSIONING. A published version is immutable and a submission is
 *      permanently bound to the version it was completed against, so a form
 *      edited next year never changes what a patient answered last year.
 *
 *   2. STABLE IDS. A field's `id` never changes; its `label` may be rewritten
 *      freely. Reporting joins on the id, so improving the wording of a question
 *      does not fragment historical data. This is what the legacy system got
 *      wrong — the same question existed as `recent_meds` and `recent_wl_meds`
 *      in two places that had drifted apart.
 */

export type FieldType =
  | 'shortText'
  | 'longText'
  | 'number'
  | 'date'
  | 'dateOfBirth'
  | 'select'
  | 'multiSelect'
  | 'yesNo'
  | 'yesNoNa'
  | 'checkboxGroup'
  | 'scale'
  | 'email'
  | 'phone'
  | 'address'
  | 'measurement'
  | 'derived'
  | 'fileUpload'
  | 'photoCapture'
  | 'signature'
  | 'infoBlock'
  | 'consentList';

/**
 * How a field is presented. The schema owns the question; this owns the
 * control. The client picks from these — he never writes layout.
 */
export type Presentation =
  | 'pills'      // yes/no as two large tappable pills — the dominant pattern
  | 'chips'      // multi-select as pill chips
  | 'dropdown'
  | 'radioList'
  | 'checkList'
  | 'segmented';

export type MeasurementKind = 'weight' | 'height' | 'length';

/** Named calculations. Deliberately not a formula language — that way lies pain. */
export type DerivedCalculation = 'bmi' | 'age' | 'weightLossPercent';

export interface FieldOption {
  value: string;
  label: string;
  /**
   * Hidden data attached to an option — a GP surgery's @gov.im mailbox, a
   * vaccine's batch number and expiry, a pharmacist's GPhC number. Copied into
   * the submission when selected, without ever being shown to the patient.
   */
  metadata?: Record<string, unknown>;
}

export interface VisibilityRule {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'nin' | 'exists' | 'notExists';
  value?: unknown;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  /** Says what to do, not just what broke. */
  message?: string;
}

export interface FormField {
  /** Stable and permanent. Rewriting the label must never change this. */
  id: string;
  type: FieldType;
  label: string;
  /** Assigned by the builder so the client can say "question 7". */
  number?: number;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  presentation?: Presentation;
  options?: FieldOption[];
  measurementKind?: MeasurementKind;
  calculation?: DerivedCalculation;
  /** Fields the calculation reads, in order. */
  calculationInputs?: string[];
  validation?: FieldValidation;
  /** All rules must pass for the field to show. */
  visibleWhen?: VisibilityRule[];
  /**
   * Fields revealed when this one is answered a particular way. The client's
   * most common pattern by far: "Any allergies?" → Yes → detail box.
   */
  reveals?: { whenValue: unknown; fields: FormField[] }[];
  /**
   * Completed by the clinician at the appointment, not by the patient — e.g.
   * "Have you had a fever in the last 24 hours?", which he was explicit must be
   * asked on the day rather than in advance.
   */
  clinicianOnly?: boolean;
  /** Copies the selected option's metadata into the submission under this key. */
  storeMetadataAs?: string;
  /** Shown when this answer is given — e.g. "STOP: treatment cannot be supplied." */
  warnWhen?: { value: unknown; message: string; severity: 'info' | 'warn' | 'stop' }[];
  /** Two fields side by side on wide screens. Layout hint, not free layout. */
  halfWidth?: boolean;
}

export interface FormStep {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  visibleWhen?: VisibilityRule[];
  /**
   * Step stays locked until these fields are answered — the verification gate
   * pattern. Named fields must live in an earlier step.
   */
  unlockedBy?: string[];
}

export interface ConsentClause {
  id: string;
  text: string;
}

export interface FormSchema {
  schemaVersion: 1;
  title: string;
  description?: string;
  steps: FormStep[];
  /** Numbers every question sequentially — he asked for this and never got it. */
  numberQuestions?: boolean;
  estimatedMinutes?: number;
  /** Versioned separately so it is always provable which wording was agreed. */
  consentClauses?: ConsentClause[];
  /** Ticked by the pharmacist before submitting, not by the patient. */
  clinicianDeclarations?: ConsentClause[];
}

// ─────────────────────────────────────────────────────────────
// Runtime results
// ─────────────────────────────────────────────────────────────

export interface ValidationIssue {
  fieldId: string;
  fieldLabel: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type Answers = Record<string, unknown>;
