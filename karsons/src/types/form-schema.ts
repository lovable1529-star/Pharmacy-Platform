/**
 * Form schema — the structure the Service Designer emits and the form runtime
 * renders.
 *
 * This is the single most important type in the codebase. It is what makes the
 * platform a configuration engine rather than a collection of hard-coded forms.
 * If a clinical service cannot be expressed here, the schema needs extending —
 * not the form hard-coding.
 *
 * Versioning: a published schema version is immutable, and a submission is
 * permanently bound to the version it was completed against. Editing a form
 * next year must never change what a patient answered last year.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'dateOfBirth'
  | 'select'
  | 'multiselect'
  | 'yesno'
  | 'radio'
  | 'checkbox'
  | 'scale'
  | 'email'
  | 'phone'
  | 'address'
  | 'signature'
  | 'fileUpload'
  | 'photoCapture'
  | 'measurement'
  | 'info';

/** Units the patient may enter, converted to SI on submission. */
export type MeasurementKind = 'weight' | 'height' | 'length';

export interface FieldOption {
  value: string;
  label: string;
  /**
   * Hidden data attached to an option — e.g. a GP surgery's NHS email, or a
   * vaccine's batch number and expiry. Populated into the submission when
   * selected, without ever being shown to the patient.
   */
  metadata?: Record<string, unknown>;
}

/** Shows or hides a field based on an earlier answer. */
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
  /** Message shown when validation fails. Says what to do, not just what broke. */
  message?: string;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  /** Auto-assigned by the builder so the client can reference "question 7". */
  number?: number;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  options?: FieldOption[];
  measurementKind?: MeasurementKind;
  validation?: FieldValidation;
  /** All rules must pass for the field to be shown. */
  visibleWhen?: VisibilityRule[];
  /**
   * Fields revealed when this one is answered a particular way. The client's
   * most common pattern: "Do you have allergies?" → Yes → detail box.
   */
  reveals?: { whenValue: unknown; fields: FormField[] }[];
  /**
   * Completed by the clinician at the appointment, not by the patient.
   * e.g. "Have you had a fever in the last 24 hours?"
   */
  clinicianOnly?: boolean;
  /** Copies an option's metadata into the submission under this key. */
  storeMetadataAs?: string;
}

export interface FormStep {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  visibleWhen?: VisibilityRule[];
}

export interface FormSchema {
  schemaVersion: 1;
  title: string;
  description?: string;
  steps: FormStep[];
  /** Numbers every question sequentially — the client asked for this. */
  numberQuestions?: boolean;
  estimatedMinutes?: number;
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
