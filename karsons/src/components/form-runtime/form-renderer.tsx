'use client';

/**
 * Form renderer.
 *
 * Turns a schema produced by the Service Designer into a working multi-step
 * form. There is no flu-vaccine-specific code here, or anywhere else — every
 * service the client builds renders through this one component.
 *
 * All logic lives in `src/lib/forms/runtime.ts` and is unit tested. This file
 * is presentation only, which is why the tricky parts (conditional visibility,
 * pruning, validation) have 19 tests behind them rather than being buried in a
 * component.
 */

import { useMemo, useState } from 'react';
import type { FormField, FormSchema, ValidationIssue } from '@/types/form-schema';
import {
  numberQuestions,
  pruneHiddenAnswers,
  validateStep,
  visibleFieldsForStep,
  visibleSteps,
} from '@/lib/forms/runtime';
import {
  AddressField,
  FileUploadField,
  PhotoCaptureField,
  ScaleField,
  SignatureField,
  type AddressValue,
  type UploadedFile,
} from '@/components/form-runtime/field-controls';
import {
  cmToInches,
  feetAndInchesToCm,
  inchesToCm,
  kgToStonesAndPounds,
  stonesAndPoundsToKg,
} from '@/lib/units';

type Answers = Record<string, unknown>;

/** Imperial/metric toggle. Patients think in stones; the database stores kg. */
function MeasurementInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: number | undefined) => void;
}) {
  const [imperial, setImperial] = useState(true);
  const numeric = typeof value === 'number' ? value : undefined;

  if (field.measurementKind === 'weight') {
    const { stones, pounds } = numeric ? kgToStonesAndPounds(numeric) : { stones: 0, pounds: 0 };

    return (
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-line p-0.5" role="group">
          {(['Stones & pounds', 'Kilograms'] as const).map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={imperial === (index === 0)}
              onClick={() => setImperial(index === 0)}
              className={`rounded px-3 py-1 text-sm ${
                imperial === (index === 0) ? 'bg-brand-600 text-white' : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {imperial ? (
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-xs text-ink-soft">Stones</span>
              <input
                type="number" inputMode="numeric" min={0} max={60}
                value={stones || ''}
                onChange={(e) => onChange(stonesAndPoundsToKg({ stones: Number(e.target.value), pounds }))}
                className="w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-ink-soft">Pounds</span>
              <input
                type="number" inputMode="numeric" min={0} max={13}
                value={pounds || ''}
                onChange={(e) => onChange(stonesAndPoundsToKg({ stones, pounds: Number(e.target.value) }))}
                className="w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
          </div>
        ) : (
          <input
            type="number" inputMode="decimal" min={0} max={400} step={0.1}
            value={numeric ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            className="w-full rounded-lg border border-line px-3 py-2"
          />
        )}
      </div>
    );
  }

  // Height and other lengths.
  const inches = numeric ? cmToInches(numeric) : 0;
  const feet = Math.floor(inches / 12);
  const remainder = Math.round(inches % 12);

  return (
    <div>
      <div className="mb-2 inline-flex rounded-lg border border-line p-0.5" role="group">
        {(['Feet & inches', 'Centimetres'] as const).map((label, index) => (
          <button
            key={label}
            type="button"
            aria-pressed={imperial === (index === 0)}
            onClick={() => setImperial(index === 0)}
            className={`rounded px-3 py-1 text-sm ${imperial === (index === 0) ? 'bg-brand-600 text-white' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {imperial ? (
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-ink-soft">Feet</span>
            <input
              type="number" inputMode="numeric" min={0} max={8}
              value={feet || ''}
              onChange={(e) => onChange(feetAndInchesToCm(Number(e.target.value), remainder))}
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs text-ink-soft">Inches</span>
            <input
              type="number" inputMode="numeric" min={0} max={11}
              value={remainder || ''}
              onChange={(e) => onChange(feetAndInchesToCm(feet, Number(e.target.value)))}
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <input
          type="number" inputMode="decimal" min={0} max={300}
          value={numeric ? Math.round(numeric) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : inchesToCm(cmToInches(Number(e.target.value))))}
          className="w-full rounded-lg border border-line px-3 py-2"
        />
      )}
    </div>
  );
}

function FieldControl({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: ValidationIssue;
  onChange: (value: unknown) => void;
}) {
  const inputId = `field-${field.id}`;
  const errorId = `${inputId}-error`;
  const describedBy = [field.helpText ? `${inputId}-help` : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  const base = `w-full rounded-lg border px-3 py-2.5 ${
    error ? 'border-triage-red-700 bg-triage-red-100' : 'border-line'
  }`;

  if (field.type === 'info') {
    return (
      <div className="rounded-card border border-brand-100 bg-brand-50 p-4 text-sm text-ink-soft">
        {field.label}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold">
        {field.number ? <span className="mr-1.5 font-mono text-ink-soft">{field.number}.</span> : null}
        {field.label}
        {field.required && <span className="ml-1 text-triage-red-700" aria-hidden>*</span>}
      </label>

      {field.helpText && (
        <p id={`${inputId}-help`} className="mb-2 text-xs text-ink-soft">
          {field.helpText}
        </p>
      )}

      {field.type === 'yesno' && (
        <div className="flex gap-2" role="group" aria-labelledby={inputId}>
          {['Yes', 'No'].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={value === option}
              onClick={() => onChange(option)}
              className={`flex-1 rounded-lg border px-4 py-2.5 font-semibold ${
                value === option ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {(field.type === 'select' || field.type === 'radio') && (
        <select
          id={inputId}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={base}
        >
          <option value="">Please select</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {field.type === 'multiselect' && (
        <div className="space-y-1.5">
          {field.options?.map((option) => {
            const selected = Array.isArray(value) && value.includes(option.value);
            return (
              <label key={option.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    const current = Array.isArray(value) ? [...value] : [];
                    onChange(
                      e.target.checked
                        ? [...current, option.value]
                        : current.filter((v) => v !== option.value),
                    );
                  }}
                />
                <span className="text-sm">{option.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === 'textarea' && (
        <textarea
          id={inputId} rows={4}
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={base}
        />
      )}

      {field.type === 'measurement' && (
        <MeasurementInput field={field} value={value} onChange={onChange} />
      )}

      {['text', 'email', 'phone', 'number', 'date'].includes(field.type) && (
        <input
          id={inputId}
          type={field.type === 'phone' ? 'tel' : field.type}
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={base}
        />
      )}

      {field.type === 'signature' && (
        <SignatureField
          id={inputId}
          value={value as string | undefined}
          onChange={onChange}
          invalid={Boolean(error)}
        />
      )}

      {field.type === 'fileUpload' && (
        <FileUploadField
          id={inputId}
          value={value as UploadedFile | undefined}
          onChange={onChange}
          invalid={Boolean(error)}
          helpText={field.placeholder}
        />
      )}

      {field.type === 'photoCapture' && (
        <PhotoCaptureField
          id={inputId}
          value={value as UploadedFile | undefined}
          onChange={onChange}
          invalid={Boolean(error)}
          helpText={field.placeholder}
        />
      )}

      {field.type === 'address' && (
        <AddressField
          id={inputId}
          value={value as AddressValue | undefined}
          onChange={onChange}
          invalid={Boolean(error)}
        />
      )}

      {field.type === 'scale' && (
        <ScaleField
          id={inputId}
          value={value as number | undefined}
          onChange={onChange}
          min={field.validation?.min ?? 0}
          max={field.validation?.max ?? 5}
          invalid={Boolean(error)}
        />
      )}

      {field.type === 'checkbox' && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-sm">{field.helpText ?? 'I confirm'}</span>
        </label>
      )}

      {field.type === 'dateOfBirth' && (
        <DateOfBirthInput id={inputId} value={value as string} onChange={onChange} invalid={Boolean(error)} />
      )}

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-triage-red-700">
          {error.message}
        </p>
      )}
    </div>
  );
}

function DateOfBirthInput({
  id, value, onChange, invalid,
}: { id: string; value?: string; onChange: (v: string) => void; invalid: boolean }) {
  const [day = '', month = '', year = ''] = (value ?? '').split('-').reverse();

  function update(next: { d?: string; m?: string; y?: string }) {
    const d = next.d ?? day;
    const m = next.m ?? month;
    const y = next.y ?? year;
    onChange(y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '');
  }

  const cls = `rounded-lg border px-3 py-2.5 text-center font-mono ${invalid ? 'border-triage-red-700' : 'border-line'}`;

  return (
    <div className="flex gap-2" id={id}>
      <input aria-label="Day" inputMode="numeric" maxLength={2} placeholder="DD"
        value={day} onChange={(e) => update({ d: e.target.value })} className={`${cls} w-20`} />
      <input aria-label="Month" inputMode="numeric" maxLength={2} placeholder="MM"
        value={month} onChange={(e) => update({ m: e.target.value })} className={`${cls} w-20`} />
      <input aria-label="Year" inputMode="numeric" maxLength={4} placeholder="YYYY"
        value={year} onChange={(e) => update({ y: e.target.value })} className={`${cls} w-24`} />
    </div>
  );
}

export function FormRenderer({
  schema,
  initialAnswers = {},
  clinicianMode = false,
  onSubmit,
}: {
  schema: FormSchema;
  initialAnswers?: Answers;
  /** True on the pharmacist's screen — includes clinician-only questions. */
  clinicianMode?: boolean;
  onSubmit: (answers: Answers) => void;
}) {
  const numbered = useMemo(
    () => (schema.numberQuestions ? numberQuestions(schema) : schema),
    [schema],
  );

  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [stepIndex, setStepIndex] = useState(0);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  // Steps are recomputed on every answer change — a step can appear or vanish
  // based on an earlier answer, so the count is not fixed.
  const steps = visibleSteps(numbered, answers);
  const step = steps[stepIndex];

  if (!step) return null;

  const fields = visibleFieldsForStep(step, answers).filter((f) =>
    clinicianMode ? true : !f.clinicianOnly,
  );

  const issueFor = (fieldId: string) => issues.find((i) => i.fieldId === fieldId);

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setIssues((current) => current.filter((i) => i.fieldId !== fieldId));
  }

  function next() {
    const result = validateStep(step!, answers, { includeClinicianOnly: clinicianMode });
    if (!result.valid) {
      setIssues(result.issues);
      document.getElementById(`field-${result.issues[0]!.fieldId}`)?.focus();
      return;
    }

    setIssues([]);

    if (stepIndex === steps.length - 1) {
      // Strip answers whose field is no longer visible before submitting.
      // Without this a record can say "no allergies" and "allergic to
      // penicillin" simultaneously.
      onSubmit(pruneHiddenAnswers(numbered, answers));
      return;
    }
    setStepIndex((i) => i + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="mb-2 flex gap-1.5" role="progressbar"
          aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={steps.length}
          aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s.id}
              className={`h-2 flex-1 rounded-full ${i < stepIndex ? 'bg-clinical-green-600' : i === stepIndex ? 'bg-brand-600' : 'bg-brand-100'}`} />
          ))}
        </div>
        <p className="text-xs text-ink-soft">Step {stepIndex + 1} of {steps.length}</p>
      </div>

      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="mb-1 text-xl">{step.title}</h2>
        {step.description && <p className="mb-5 text-sm text-ink-soft">{step.description}</p>}

        {issues.length > 0 && (
          <div role="alert" className="mb-5 rounded-lg border border-triage-red-700 bg-triage-red-100 p-4">
            <p className="mb-1 font-semibold">Please check the following</p>
            <ul className="list-inside list-disc text-sm">
              {issues.map((issue) => <li key={issue.fieldId}>{issue.fieldLabel}</li>)}
            </ul>
          </div>
        )}

        <div className="space-y-5">
          {fields.map((field) => (
            <FieldControl
              key={field.id}
              field={field}
              value={answers[field.id]}
              error={issueFor(field.id)}
              onChange={(value) => setAnswer(field.id, value)}
            />
          ))}
        </div>

        <div className="mt-7 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            className={`rounded-full border border-line px-5 py-2.5 text-sm font-semibold ${stepIndex === 0 ? 'invisible' : ''}`}>
            Back
          </button>
          <button type="button" onClick={next}
            className="rounded-full bg-brand-600 px-6 py-2.5 text-sm font-bold text-white">
            {stepIndex === steps.length - 1 ? 'Submit' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
