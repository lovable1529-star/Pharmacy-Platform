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
import { ArrowLeft, ArrowRight, Check, ExternalLink, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isExternalReferral } from '@/lib/services/referral';
import {
  fallbackStepIndex, hasResourceBlocks, placeResources, renderedResources, unticked,
  type ResourceBlock,
} from '@/lib/resources/placement';
import {
  visibleSteps, visibleFieldsForStep, validateStep, validateForm,
  pruneHiddenAnswers, numberQuestions, activeWarnings, isStepUnlocked,
  resolveConsentClauses,
  carriesNoAnswer,
} from '@/lib/forms/runtime';
import type { Answers, FormField, FormSchema } from '@/types/form-schema';
import {
  FieldShell, FieldWarning, PillToggle, Segmented, RadioList, ChipGroup, CheckList,
  Dropdown, TextInput, TextArea, AddressInput, DateInput, DateOfBirthInput, MeasurementInput, PhoneField,
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
    case 'date':
      return <DateInput {...props} />;
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
      // The question's own statements win; otherwise the form-wide list, which
      // is what every form published before per-question consent relies on.
      // Resolved by a tested function rather than inline — see runtime.ts.
      return <ConsentList {...props} clauses={resolveConsentClauses(field, schema)} />;
    default:
      return <TextInput {...props} />;
  }
}

/**
 * A leaflet or link the pharmacy wants this patient to read.
 *
 * Passed in rather than read from the schema, because resources live in the
 * database and change without republishing a form. The wizard is told what to
 * show; deciding which ones apply is not its job.
 */
export interface WizardResource {
  id: string;
  /** Stable across versions, so a block naming it survives a reworded leaflet. */
  resourceKey: string;
  title: string;
  description: string | null;
  url: string;
  requiresAcknowledgement: boolean;
}

export interface WizardProps {
  schema: FormSchema;
  /** Staff completing on a patient's behalf also see clinician-only questions. */
  clinicianMode?: boolean;
  initialAnswers?: Answers;
  /**
   * The second argument is the ids of the resources the patient ticked. Kept
   * out of `answers` on purpose: answers belong to a versioned form and these
   * do not, and folding them in would make a resource look like a question
   * that form version never asked.
   */
  onSubmit?: (
    answers: Answers,
    acknowledgedResourceIds: string[],
  ) => Promise<void> | void;
  /**
   * Called whenever an answer changes, for autosave.
   *
   * Fires on every keystroke, so whatever is passed here must do its own
   * debouncing — this deliberately does not batch, because the wizard should
   * not be deciding how often a patient's answers reach the database.
   */
  onAnswersChange?: (answers: Answers) => void;
  submitLabel?: string;
  /**
   * Shown immediately before the signature, which is where the client asked
   * for them and the only place they make sense: the patient is about to
   * declare the form true, so anything they are required to have read has to
   * be in front of them at that moment, not four steps back.
   */
  resources?: WizardResource[];
  /**
   * Where to send a patient the form has stopped, when the answer that stopped
   * them is one the schema marks as deserving a referral.
   *
   * Passed in rather than read from the schema: which answers earn a referral
   * is versioned with the form, but where it points is configuration the
   * pharmacy changes without a republish.
   */
  referralUrl?: string | null;
  /**
   * Preview: explorable, but nothing is recorded.
   *
   * Controls stay ENABLED on purpose. The point of a preview is to see what the
   * form does — including the questions that only appear once somebody answers
   * "yes" — and a preview with the inputs greyed out can never show that. It
   * was also the reason a colleague checking a form had to make a real
   * submission to see the whole thing.
   *
   * What preview removes is consequence: no validation blocking, no locked
   * steps, no submit, nothing saved.
   */
  preview?: boolean;
}

export function FormWizard({
  schema: rawSchema,
  clinicianMode = false,
  initialAnswers = {},
  onSubmit,
  onAnswersChange,
  submitLabel = 'Submit',
  resources = [],
  referralUrl = null,
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
  /** Resource ids the patient has ticked. */
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  function toggleAcknowledged(resourceId: string, ticked: boolean) {
    setAcknowledged((previous) => (ticked
      ? [...new Set([...previous, resourceId])]
      : previous.filter((id) => id !== resourceId)));
  }

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

  /*
   * Where the leaflets go.
   *
   * Computed against the VISIBLE steps and their visible fields: a block
   * hidden behind an unanswered branch is not a place anybody can read
   * anything, and treating it as one would strand a required tick somewhere
   * the patient cannot reach.
   *
   * A form that places its own blocks gets exactly what it asked for. A form
   * that places none — which is every version published before blocks existed
   * — falls back to one block above the signature, so nothing that used to
   * show its leaflets quietly stops.
   */
  const visibleStepFields = steps.map((st) => ({
    fields: visibleFieldsForStep(st, answers, options),
  }));

  const placement = useMemo(() => {
    if (resources.length === 0) return new Map<number, ResourceBlock[]>();

    if (hasResourceBlocks(visibleStepFields)) {
      return placeResources(visibleStepFields, resources);
    }

    const fallback = fallbackStepIndex(visibleStepFields, schema.steps);
    if (fallback < 0) return new Map<number, ResourceBlock[]>();

    return new Map<number, ResourceBlock[]>([
      [fallback, [{ fieldId: '__fallback', resources: [...resources] }]],
    ]);
    // visibleStepFields is rebuilt every render; the answers it derives from
    // are the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, answers, schema, stepIndex]);

  const blocksHere = placement.get(stepIndex) ?? [];

  /*
   * Required resources gate the step they are ON. Not the final submit:
   * leaving the tick five steps behind and refusing at the end tells somebody
   * they are wrong without telling them where.
   *
   * Nothing is required of somebody who is only looking at a preview.
   */
  const unreadHere = preview ? [] : unticked(blocksHere, acknowledged);

  const unreadAnywhere = preview
    ? []
    : renderedResources(placement)
      .filter((r) => r.requiresAcknowledgement && !acknowledged.includes(r.id));

  const heldByResources = unreadHere.length > 0;

  /** The first step still holding an unticked leaflet, for the submit guard. */
  const firstUnreadStep = unreadAnywhere.length === 0
    ? -1
    : [...placement.entries()]
      .filter(([, blocks]) => unticked(blocks, acknowledged).length > 0)
      .map(([index]) => index)
      .sort((a, b) => a - b)[0] ?? -1;

  const stepValidation = step ? validateStep(step, answers, options) : { valid: true, issues: [] };
  // Nothing is required of somebody who is only looking.
  const errorFor = (fieldId: string) =>
    showErrors && !preview
      ? stepValidation.issues.find((i) => i.fieldId === fieldId)?.message
      : undefined;

  function goNext() {
    if (!preview && !stepValidation.valid) { setShowErrors(true); return; }
    if (heldByResources) { setShowErrors(true); return; }
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
    /*
     * Checked again here as well as on the step. A block is not always on the
     * last step — the weight-management form asks about delivery after the
     * signature — so a patient can reach submit without the button guarding
     * that tick ever having been the one they pressed.
     */
    if (!preview && unreadAnywhere.length > 0 && firstUnreadStep >= 0) {
      setStepIndex(firstUnreadStep);
      setShowErrors(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!onSubmit) return;

    setSubmitting(true);
    try {
      await onSubmit(pruneHiddenAnswers(schema, answers), acknowledged);
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
          {/*
            The default has to be true for every service using this wizard.
            It said "a pharmacist will go through them with you at your
            appointment", which is right for a booked flu jab and wrong for a
            remote weight-management patient who will never have one — and
            being told to expect an appointment that is not coming is worse
            than being told nothing.

            A form can override it with `completionMessage` where the pharmacy
            wants to say something more specific.
          */}
          {schema.completionMessage
            ?? 'Your answers have been sent to the pharmacy. There is nothing else to do — '
              + 'a pharmacist will review them and be in touch.'}
        </p>
      </div>
    );
  }

  const isLastStep = stepIndex >= steps.length - 1;
  const progress = steps.length > 0 ? (stepIndex + 1) / steps.length : 0;

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-8">
      <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
        {/* ── Step tabs ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunk px-5 py-3.5">
          {steps.map((s, i) => {
            // In preview every step is reachable, in any order. Someone
            // checking a form should be able to jump straight to the consent
            // page without answering their way there.
            const unlocked = preview || isStepUnlocked(s, answers);
            const active = i === stepIndex;
            const complete = !preview && i < stepIndex;
            const reachable = preview || (unlocked && i <= stepIndex);
            return (
              <button
                key={s.id}
                type="button"
                disabled={!reachable}
                onClick={() => {
                  setShowErrors(false);
                  setStepIndex(i);
                }}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  active && 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]',
                  !active && complete && 'text-safe-700 hover:bg-surface',
                  !active && !complete && 'text-ink-faint',
                  !reachable && 'cursor-not-allowed',
                  preview && !active && 'text-ink-soft hover:bg-surface hover:text-ink',
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

                {/*
                  ── Resources ─────────────────────────────

                  Only the fallback block renders here, above the questions,
                  because that is where it always was. A block the form places
                  itself renders in its own position among the fields below.
                */}
                {blocksHere
                  .filter((b) => b.fieldId === '__fallback')
                  .map((block) => (
                    <ResourceBlockView
                      key={block.fieldId}
                      heading="Before you sign, please read"
                      block={block}
                      acknowledged={acknowledged}
                      onToggle={toggleAcknowledged}
                      showErrors={showErrors && !preview}
                      className="mb-7"
                    />
                  ))}

                <div className="flex flex-col">
                  {visibleFieldsForStep(step, answers, options).map((field: FormField) => {
                    const fieldWarnings = warnings.filter((w) => w.fieldId === field.id);

                    /*
                     * A resource block is a position, not a question. It has
                     * no answer, no validation and no field shell — what goes
                     * in it comes from the database at render time, which is
                     * the whole reason the pharmacy can change a leaflet
                     * without republishing the form it sits on.
                     */
                    if (field.type === 'resourceList') {
                      const block = blocksHere.find((b) => b.fieldId === field.id);
                      if (!block || block.resources.length === 0) return null;

                      return (
                        <ResourceBlockView
                          key={field.id}
                          heading={field.label}
                          block={block}
                          acknowledged={acknowledged}
                          onToggle={toggleAcknowledged}
                          showErrors={showErrors && !preview}
                          className="my-2"
                        />
                      );
                    }

                    return (
                      <FieldShell key={field.id} field={field} error={errorFor(field.id)}>
                        <Control
                          schema={schema}
                          field={field}
                          value={answers[field.id]}
                          answers={answers}
                          onChange={(v) => setAnswer(field.id, v)}
                          disabled={false}
                        />
                        {fieldWarnings.map((w) => (
                          <FieldWarning
                            key={w.message}
                            message={w.message}
                            severity={w.severity}
                            action={
                              /*
                               * Only where the schema asked for it. Every stop
                               * warning ends the form, but "book an
                               * appointment" is the right next step for
                               * somebody who would rather be seen and the
                               * wrong one for somebody reporting red-flag
                               * symptoms, who was just told to ring today.
                               */
                              w.offerReferral && referralUrl
                                ? {
                                  href: referralUrl,
                                  label: 'See the face-to-face programme',
                                  external: isExternalReferral(referralUrl),
                                }
                                : undefined
                            }
                          />
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

                  {isLastStep && preview ? (
                    // In preview the last step ends in a statement of fact, not
                    // a disabled button somebody will try to click anyway.
                    <span className="rounded-control border border-line bg-sunk px-4 py-2.5 text-[13.5px] text-ink-faint">
                      End of the form — nothing is submitted in preview
                    </span>
                  ) : isLastStep ? (
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting || blocked}
                      className={cn(
                        'flex items-center gap-2 rounded-control px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
                        blocked ? 'cursor-not-allowed bg-ink-faint' : 'bg-brand-600 hover:bg-brand-700',
                        submitting && 'opacity-60',
                      )}
                    >
                      {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
                      {blocked ? 'Cannot continue' : submitLabel}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goNext}
                      className="flex items-center gap-2 rounded-control bg-brand-600 px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-700"
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
    .filter((f) => !carriesNoAnswer(f) && f.type !== 'signature' && f.type !== 'consentList')
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

/**
 * One block of leaflets, wherever the form puts it.
 *
 * Rendered from database rows rather than from the schema, which is the point:
 * the pharmacy edits a leaflet and every form showing it changes, with no
 * republish and no effect on anything already answered.
 *
 * The heading comes from the block — the fallback says "Before you sign,
 * please read" because that is where it sits, and a block the client placed
 * themselves says whatever they typed as its label.
 */
function ResourceBlockView({
  heading, block, acknowledged, onToggle, showErrors, className,
}: {
  heading: string;
  block: ResourceBlock;
  acknowledged: string[];
  onToggle: (resourceId: string, ticked: boolean) => void;
  showErrors: boolean;
  className?: string;
}) {
  if (block.resources.length === 0) return null;

  return (
    <div className={cn('rounded-panel border border-line bg-sunk px-5 py-4', className)}>
      <h3 className="text-[15px] font-semibold text-ink">{heading}</h3>
      <p className="mt-0.5 text-[13px] text-ink-faint">
        These open in a new tab. This page keeps your answers.
      </p>

      <div className="mt-3.5 flex flex-col gap-2.5">
        {block.resources.map((r) => {
          const ticked = acknowledged.includes(r.id);
          const missing = showErrors && r.requiresAcknowledgement && !ticked;

          return (
            <div
              key={r.id}
              className={cn(
                'rounded-control border bg-surface px-4 py-3',
                missing ? 'border-stop-300' : 'border-line',
              )}
            >
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                {r.title}
                <ExternalLink size={13} strokeWidth={2.2} />
              </a>

              {r.description ? (
                <p className="mt-0.5 text-[13px] text-ink-soft">{r.description}</p>
              ) : null}

              {r.requiresAcknowledgement ? (
                <label className="mt-2.5 flex items-start gap-2.5 text-[13.5px] text-ink-soft">
                  <input
                    type="checkbox"
                    className="mt-[3px] h-[16px] w-[16px] accent-[var(--brand-600)]"
                    checked={ticked}
                    onChange={(e) => onToggle(r.id, e.target.checked)}
                  />
                  <span>I have read this.</span>
                </label>
              ) : null}

              {missing ? (
                <p className="mt-1.5 text-[12.5px] text-stop-700">
                  Please confirm you have read this.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
