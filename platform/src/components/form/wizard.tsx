'use client';

/**
 * Form wizard.
 *
 * Renders any published FormSchema. There is one of these, and it is what the
 * patient sees on their phone, what a member of staff completes on a tablet, and
 * what the Service Designer shows as its live preview. No second implementation
 * exists, so nothing can drift.
 *
 * The pruning behaviour is the part worth knowing about: answer "yes" to
 * allergies, type the detail, change to "no", and the typed detail is discarded.
 * Otherwise the record contradicts itself, which is exactly the thing a regulator
 * asks about.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  visibleSteps, visibleFieldsForStep, validateStep, validateForm,
  pruneHiddenAnswers, numberQuestions, activeWarnings, isStepUnlocked,
} from '@/lib/forms/runtime';
import type { Answers, FormField, FormSchema } from '@/types/form-schema';
import {
  FieldShell, FieldWarning, PillToggle, Segmented, RadioList, ChipGroup, CheckList,
  Dropdown, TextInput, TextArea, AddressInput, DateOfBirthInput, MeasurementInput, PhoneField,
  DerivedValue, FileUploadInput, SignaturePad, InfoBlock, ConsentList,
  type FieldProps,
} from '@/components/fields/controls';

/**
 * Exported so the clinician's review panel edits an answer with the exact
 * control the patient answered it on. Two implementations of "what a weight
 * field looks like" would drift, and the one a clinician corrects a record
 * with is the worse one to get wrong.
 */
export function Control(props: FieldProps & { schema: FormSchema }) {
  const { field, schema } = props;

  switch (field.type) {
    case 'yesNo':
    case 'yesNoNa':
      return <PillToggle {...props} />;
    case 'select':
      if (field.presentation === 'segmented') return <Segmented {...props} />;
      if (field.presentation === 'radioList') return <RadioList {...props} />;
      return <Dropdown {...props} />;
    case 'scale':
      return <RadioList {...props} />;
    case 'multiSelect':
      return <ChipGroup {...props} />;
    case 'checkboxGroup':
      return <CheckList {...props} />;
    case 'longText':
      return <TextArea {...props} />;
    case 'phone':
      return <PhoneField {...props} />;
    case 'address':
      return <AddressInput {...props} />;
    case 'dateOfBirth':
      return <DateOfBirthInput {...props} />;
    case 'measurement':
      return <MeasurementInput {...props} />;
    case 'derived':
      return <DerivedValue {...props} />;
    case 'fileUpload':
    case 'photoCapture':
      return <FileUploadInput {...props} />;
    case 'signature':
      return <SignaturePad {...props} />;
    case 'infoBlock':
      return <InfoBlock {...props} />;
    case 'consentList':
      return <ConsentList {...props} clauses={schema.consentClauses ?? []} />;
    default:
      return <TextInput {...props} />;
  }
}

export interface WizardProps {
  schema: FormSchema;
  /** Staff completing on a patient's behalf also see clinician-only questions. */
  clinicianMode?: boolean;
  initialAnswers?: Answers;
  onSubmit?: (answers: Answers) => Promise<void> | void;
  /**
   * Called whenever an answer changes, for autosave.
   *
   * Fires on every keystroke, so whatever is passed here must do its own
   * debouncing — this deliberately does not batch, because the wizard should
   * not be deciding how often a patient's answers reach the database.
   */
  onAnswersChange?: (answers: Answers) => void;
  submitLabel?: string;
  /** Preview mode is read-only and never submits. */
  preview?: boolean;
}

export function FormWizard({
  schema: rawSchema,
  clinicianMode = false,
  initialAnswers = {},
  onSubmit,
  onAnswersChange,
  submitLabel = 'Submit',
  preview = false,
}: WizardProps) {
  const schema = useMemo(
    () => (rawSchema.numberQuestions ? numberQuestions(rawSchema) : rawSchema),
    [rawSchema],
  );

  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Autosave notification lives in an effect, not in the state updater —
  // React may invoke an updater twice, and a double POST per keystroke is a
  // real cost when a patient is on a phone with poor signal.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onAnswersChange?.(answers);
    // onAnswersChange is intentionally not a dependency: callers pass an inline
    // closure, and depending on it would re-fire the save on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const options = { includeClinicianOnly: clinicianMode };
  const steps = visibleSteps(schema, answers, options);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const warnings = activeWarnings(schema, answers);
  const blocked = warnings.some((w) => w.severity === 'stop');

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((previous) => {
      const next = { ...previous, [fieldId]: value };
      // Discard anything that just became invisible.
      return pruneHiddenAnswers(schema, next);
    });
  }

  const stepValidation = step ? validateStep(step, answers, options) : { valid: true, issues: [] };
  const errorFor = (fieldId: string) =>
    showErrors ? stepValidation.issues.find((i) => i.fieldId === fieldId)?.message : undefined;

  function goNext() {
    if (!stepValidation.valid) { setShowErrors(true); return; }
    setShowErrors(false);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setShowErrors(false);
    setStepIndex((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    const validation = validateForm(schema, answers, options);
    if (!validation.valid) { setShowErrors(true); return; }
    if (!onSubmit) return;

    setSubmitting(true);
    try {
      await onSubmit(pruneHiddenAnswers(schema, answers));
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[520px] px-6 py-20 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-safe-100 text-safe-700">
          <Check size={26} strokeWidth={2.4} />
        </div>
        <h2 className="mb-2 text-[24px] text-ink">Thank you</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          Your answers have been sent to the pharmacy. There is nothing else to do — a pharmacist
          will go through them with you at your appointment.
        </p>
      </div>
    );
  }

  const isLastStep = stepIndex >= steps.length - 1;
  const progress = steps.length > 0 ? (stepIndex + 1) / steps.length : 0;

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-8">
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface shadow-panel">
        {/* ── Step tabs ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunk px-5 py-3.5">
          {steps.map((s, i) => {
            const unlocked = isStepUnlocked(s, answers);
            const active = i === stepIndex;
            const complete = i < stepIndex;
            return (
              <button
                key={s.id}
                type="button"
                disabled={!unlocked || i > stepIndex}
                onClick={() => setStepIndex(i)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  active && 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]',
                  !active && complete && 'text-safe-700 hover:bg-surface',
                  !active && !complete && 'text-ink-faint',
                  (!unlocked || i > stepIndex) && 'cursor-not-allowed',
                )}
              >
                <span
                  className={cn(
                    'flex h-[19px] w-[19px] items-center justify-center rounded-full font-mono text-[10.5px]',
                    active && 'bg-brand-600 text-white',
                    complete && 'bg-safe-600 text-white',
                    !active && !complete && 'bg-line-soft text-ink-faint',
                  )}
                >
                  {complete ? <Check size={11} strokeWidth={3} /> : !unlocked ? <Lock size={10} /> : i + 1}
                </span>
                {s.title}
              </button>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-[1fr_260px]">
          {/* ── Questions ───────────────────────────────── */}
          <div className="min-w-0 px-6 py-7 sm:px-8">
            {step ? (
              <>
                <div className="mb-6">
                  <h2 className="text-[21px] text-ink">{step.title}</h2>
                  {step.description ? (
                    <p className="mt-1 text-[14px] text-ink-faint">{step.description}</p>
                  ) : null}
                </div>

                <div className="flex flex-col">
                  {visibleFieldsForStep(step, answers, options).map((field: FormField) => {
                    const fieldWarnings = warnings.filter((w) => w.fieldId === field.id);
                    return (
                      <FieldShell key={field.id} field={field} error={errorFor(field.id)}>
                        <Control
                          schema={schema}
                          field={field}
                          value={answers[field.id]}
                          answers={answers}
                          onChange={(v) => setAnswer(field.id, v)}
                          disabled={preview}
                        />
                        {fieldWarnings.map((w) => (
                          <FieldWarning key={w.message} message={w.message} severity={w.severity} />
                        ))}
                      </FieldShell>
                    );
                  })}
                </div>

                {/* ── Actions ─────────────────────────────── */}
                <div className="mt-8 flex items-center justify-between gap-4 border-t border-line-soft pt-5">
                  {stepIndex > 0 ? (
                    <button
                      type="button"
                      onClick={goBack}
                      className="flex items-center gap-1.5 text-[14px] text-ink-faint transition-colors hover:text-ink"
                    >
                      <ArrowLeft size={15} strokeWidth={2} />
                      Back
                    </button>
                  ) : (
                    <span />
                  )}

                  {isLastStep ? (
                    <button
                      type="button"
                      onClick={submit}
                      disabled={preview || submitting || blocked}
                      className={cn(
                        'flex items-center gap-2 rounded-[8px] px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
                        blocked ? 'cursor-not-allowed bg-ink-faint' : 'bg-brand-600 hover:bg-brand-700',
                        (preview || submitting) && 'opacity-60',
                      )}
                    >
                      {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
                      {blocked ? 'Cannot continue' : submitLabel}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goNext}
                      className="flex items-center gap-2 rounded-[8px] bg-brand-600 px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      Next
                      <ArrowRight size={15} strokeWidth={2.2} />
                    </button>
                  )}
                </div>

                {blocked ? (
                  <p className="mt-3 text-right text-[13px] text-stop-700">
                    Please speak to the pharmacy before continuing.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          {/* ── Sidebar ─────────────────────────────────── */}
          <aside className="border-t border-line bg-sunk px-6 py-7 lg:border-l lg:border-t-0">
            <div className="mb-6">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-ink-faint">
                  Step {stepIndex + 1} of {steps.length}
                </span>
                <span className="tabular font-mono text-[11px] text-ink-faint">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              {schema.estimatedMinutes ? (
                <p className="mt-2.5 text-[12.5px] text-ink-faint">
                  About {schema.estimatedMinutes} minutes in total
                </p>
              ) : null}
            </div>

            <div className="border-t border-line pt-5">
              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.09em] text-ink-faint">
                Your answers so far
              </h3>
              <RecapList schema={schema} answers={answers} options={options} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function RecapList({
  schema, answers, options,
}: {
  schema: FormSchema;
  answers: Answers;
  options: { includeClinicianOnly: boolean };
}) {
  const entries = visibleSteps(schema, answers, options)
    .flatMap((s) => visibleFieldsForStep(s, answers, options))
    .filter((f) => f.type !== 'infoBlock' && f.type !== 'signature' && f.type !== 'consentList')
    .map((f) => ({ field: f, value: answers[f.id] }))
    .filter((e) => e.value !== undefined && e.value !== null && e.value !== '')
    .slice(0, 8);

  if (entries.length === 0) {
    return <p className="text-[12.5px] leading-relaxed text-ink-faint">Nothing answered yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {entries.map(({ field, value }) => (
        <li key={field.id} className="flex justify-between gap-3 text-[12.5px]">
          <span className="min-w-0 flex-1 truncate text-ink-faint">{field.label}</span>
          <span className="max-w-[45%] truncate text-right font-medium text-ink">
            {formatRecapValue(field, value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatRecapValue(field: FormField, value: unknown): string {
  if (typeof value === 'object' && value !== null && 'si' in value) {
    const measurement = value as { si: number | null };
    if (measurement.si === null) return '—';
    return field.measurementKind === 'weight'
      ? `${measurement.si} kg`
      : `${measurement.si} cm`;
  }

  if (Array.isArray(value)) {
    const labels = value.map(
      (v) => field.options?.find((o) => o.value === v)?.label ?? String(v),
    );
    return labels.length > 2 ? `${labels.length} selected` : labels.join(', ');
  }

  if (value === true) return 'Agreed';
  if (value instanceof File) return value.name;

  const option = field.options?.find((o) => o.value === value);
  if (option) return option.label;

  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'na') return 'N/A';

  return String(value);
}
