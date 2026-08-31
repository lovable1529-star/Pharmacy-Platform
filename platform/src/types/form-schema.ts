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
  warnWhen?: {
    value: unknown;
    message: string;
    severity: 'info' | 'warn' | 'stop';
    /**
     * Offer the patient the pharmacy's face-to-face service alongside this
     * warning.
     *
     * A flag rather than a URL, and it lives here rather than in the service
     * profile, because WHICH answers deserve a referral is a clinical decision
     * that belongs to a form version — someone reading a submission in a year
     * should be able to see that this version offered it. WHERE the referral
     * points is operational and changes freely, so that lives in
     * `service_public_profile.f2f_referral_url` instead.
     *
     * Deliberately not "every stop warning". A patient reporting persistent
     * vomiting and yellowing eyes is also stopped, and answering that with
     * "book an appointment" instead of "contact the pharmacy today" would be
     * the wrong instruction at the worst moment.
     */
    offerReferral?: boolean;
  }[];
  /** Two fields side by side on wide screens. Layout hint, not free layout. */
  halfWidth?: boolean;
  /**
   * Statements for THIS consent question, overriding the form-wide list.
   *
   * Consent normally belongs to the whole form — one agreed wording, versioned
   * with it, so it stays provable what a patient signed. That breaks down the
   * moment a form needs two different consents (treatment, then sharing with a
   * GP), because both questions were forced to show the same text.
   *
   * Set, this list wins for this question alone. Unset, the form-wide list
   * applies exactly as before. Provability is unaffected either way: a field
   * lives inside the same versioned schema the shared list does.
   */
  consentClauses?: ConsentClause[];
  /**
   * The wording of a consentList's single tick box.
   *
   * Was a hard-coded string inside the control, which meant the one sentence a
   * patient actually signs was the one sentence the pharmacy could not change.
   * Optional, and the control keeps the old wording as its fallback, so every
   * form version published before this still renders exactly as it did.
   */
  confirmLabel?: string;
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
  /**
   * What the patient reads after submitting.
   *
   * Optional, because the wizard's default has to be true for every service.
   * Set it where a service can say something more specific - a remote patient
   * being telephoned needs different words from somebody with an appointment.
   */
  completionMessage?: string;
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
