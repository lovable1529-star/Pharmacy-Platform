'use client';

/**
 * Field components.
 *
 * Eighteen controls. This is the entire visual vocabulary of every consultation
 * form the client will ever build — which is exactly why he configures questions
 * and never layout. He picks the question, the options and the logic; the way it
 * looks is ours, so every form he publishes looks like a designed product rather
 * than a form builder's output.
 *
 * The dominant pattern by a wide margin is the yes/no pill with a conditional
 * detail box. It appears fourteen times across his three forms, so it gets the
 * most care.
 */

import { useEffect, useRef, useState } from 'react';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import {
  Check, Upload, Camera, Eraser, Info, AlertTriangle, OctagonX, Loader2,
  ExternalLink, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { carriesNoAnswer } from '@/lib/forms/runtime';
import { DateOfBirthField } from '@/components/ui/date-of-birth';
import { SearchSelect } from '@/components/ui/search-select';
import { canUpload, uploadFile, useUploadTarget } from './upload-context';
import { isStoredFileRef, formatFileSize } from './stored-file';
import {
  stonesAndPoundsToKg, kgToStonesAndPounds, feetAndInchesToCm, cmToFeetAndInches,
  inchesToCm, cmToInches, calculateBmi,
} from '@/lib/units';
import type { FormField, FieldOption } from '@/types/form-schema';

export interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  answers: Record<string, unknown>;
  error?: string;
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Shared chrome
// ─────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink ' +
  'placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none ' +
  'focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-1';

export function FieldShell({
  field,
  error,
  children,
}: {
  field: FormField;
  error?: string;
  children: React.ReactNode;
}) {
  if (carriesNoAnswer(field)) return <>{children}</>;

  return (
    <div className="border-t border-line-soft py-5 first:border-t-0 first:pt-0">
      <label
        htmlFor={field.id}
        className="mb-2 block text-[15px] font-medium leading-snug text-ink"
      >
        {field.number !== undefined ? (
          <span className="mr-1.5 font-mono text-[12.5px] font-normal text-ink-faint">
            {field.number}.
          </span>
        ) : null}
        {field.label}
        {field.required ? <span className="ml-1 text-stop-600">*</span> : null}
      </label>

      {field.helpText ? (
        <p className="mb-2.5 text-[13px] leading-snug text-ink-faint">{field.helpText}</p>
      ) : null}

      {children}

      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] text-stop-700">
          <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shown when an answer triggers guidance or a hard stop. */
export function FieldWarning({
  message,
  severity,
  action,
}: {
  message: string;
  severity: 'info' | 'warn' | 'stop';
  /**
   * Somewhere to go, for a warning that closes a door.
   *
   * A stop tells a patient they cannot continue. Where there is a real
   * alternative — the pharmacy's own face-to-face programme — leaving them to
   * find it themselves loses them, so the warning carries the way out.
   */
  action?: { href: string; label: string; external: boolean };
}) {
  const Icon = severity === 'stop' ? OctagonX : severity === 'warn' ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        'mt-3 flex items-start gap-2.5 rounded-control border px-3.5 py-2.5 text-[13.5px] leading-snug',
        severity === 'stop' && 'border-stop-200 bg-stop-50 text-stop-700',
        severity === 'warn' && 'border-review-200 bg-review-50 text-review-700',
        severity === 'info' && 'border-brand-200 bg-brand-50 text-brand-700',
      )}
    >
      <Icon size={15} strokeWidth={2.1} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span>{message}</span>

        {action ? (
          <a
            href={action.href}
            /*
             * The pharmacy's own site opens in a new tab so the half-finished
             * form stays where it is; our own placeholder navigates normally,
             * because it has a way back and a stack of tabs helps nobody.
             */
            target={action.external ? '_blank' : undefined}
            rel={action.external ? 'noreferrer noopener' : undefined}
            className={cn(
              'mt-2.5 inline-flex items-center gap-1.5 rounded-control px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors',
              severity === 'stop' && 'bg-stop-600 hover:bg-stop-700',
              severity === 'warn' && 'bg-review-600 hover:bg-review-700',
              severity === 'info' && 'bg-brand-600 hover:bg-brand-700',
            )}
          >
            {action.label}
            {action.external
              ? <ExternalLink size={13} strokeWidth={2.2} />
              : <ArrowRight size={14} strokeWidth={2.2} />}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 1 · Pill toggle — yes/no and yes/no/N-A
// ─────────────────────────────────────────────────────────────

export function PillToggle({ field, value, onChange, disabled }: FieldProps) {
  const options: FieldOption[] =
    field.type === 'yesNoNa'
      ? [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'na', label: 'Not applicable' },
        ]
      : [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ];

  return (
    <div className="flex flex-wrap gap-2.5">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? undefined : option.value)}
            className={cn(
              'flex min-w-[104px] flex-1 items-center justify-center gap-2 rounded-control border px-4 py-3 text-[15px] font-medium transition-colors sm:flex-none',
              selected
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            {selected ? <Check size={15} strokeWidth={2.6} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 2 · Segmented — a small set of mutually exclusive choices
// ─────────────────────────────────────────────────────────────

export function Segmented({ field, value, onChange, disabled }: FieldProps) {
  const options = field.options ?? [];
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-[9px] bg-sunk p-1">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[6px] px-4 py-2 text-[14px] font-medium transition-colors',
              selected
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]'
                : 'text-ink-soft hover:text-ink',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3 · Radio list — several options, each needing a full line
// ─────────────────────────────────────────────────────────────

export function RadioList({ field, value, onChange, disabled }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      {(field.options ?? []).map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-start gap-3 rounded-control border px-3.5 py-3 text-left transition-colors',
              selected
                ? 'border-brand-500 bg-brand-50'
                : 'border-line bg-surface hover:border-brand-300',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                selected ? 'border-brand-600' : 'border-line',
              )}
            >
              {selected ? <span className="h-2 w-2 rounded-full bg-brand-600" /> : null}
            </span>
            <span className={cn('text-[14.5px] leading-snug', selected ? 'text-ink' : 'text-ink-soft')}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4 · Chip group — multi-select
// ─────────────────────────────────────────────────────────────

export function ChipGroup({ field, value, onChange, disabled }: FieldProps) {
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(optionValue: string) {
    // "None of the above" is exclusive — selecting it clears everything else,
    // and selecting anything else clears it.
    if (optionValue === 'none') {
      onChange(selected.includes('none') ? [] : ['none']);
      return;
    }
    const withoutNone = selected.filter((v) => v !== 'none');
    onChange(
      withoutNone.includes(optionValue)
        ? withoutNone.filter((v) => v !== optionValue)
        : [...withoutNone, optionValue],
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(field.options ?? []).map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => toggle(option.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition-colors',
              isSelected
                ? 'border-brand-500 bg-brand-100 text-brand-700'
                : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            {isSelected ? <Check size={13} strokeWidth={2.8} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5 · Check list — multi-select where each line is a statement
// ─────────────────────────────────────────────────────────────

export function CheckList({ field, value, onChange, disabled }: FieldProps) {
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(optionValue: string) {
    if (optionValue === 'none') {
      onChange(selected.includes('none') ? [] : ['none']);
      return;
    }
    const withoutNone = selected.filter((v) => v !== 'none');
    onChange(
      withoutNone.includes(optionValue)
        ? withoutNone.filter((v) => v !== optionValue)
        : [...withoutNone, optionValue],
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {(field.options ?? []).map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => toggle(option.value)}
            className={cn(
              'flex items-start gap-3 rounded-control border px-3.5 py-2.5 text-left transition-colors',
              isSelected ? 'border-brand-400 bg-brand-50' : 'border-line bg-surface hover:border-brand-300',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
                isSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
              )}
            >
              {isSelected ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className={cn('text-[14.5px] leading-snug', isSelected ? 'text-ink' : 'text-ink-soft')}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 6 · Dropdown
// ─────────────────────────────────────────────────────────────

/**
 * A dropdown you can type into.
 *
 * The GP surgery list is eleven Isle of Man practices and the country list is
 * every country there is. A native select makes somebody scroll both, on a
 * phone, while a pharmacist waits.
 */
export function Dropdown({ field, value, onChange, disabled, error }: FieldProps) {
  return (
    <SearchSelect
      id={field.id}
      value={typeof value === 'string' ? value : ''}
      onChange={(next) => onChange(next || undefined)}
      disabled={disabled}
      invalid={Boolean(error)}
      placeholder={field.placeholder ?? 'Please choose…'}
      options={(field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
      }))}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// 7 · Text inputs
// ─────────────────────────────────────────────────────────────

/**
 * Phone numbers go through react-phone-number-input rather than a plain text
 * box. Patients write their number a dozen different ways — 01624 615150,
 * +44 1624 615150, 07624… — and a number the pharmacy cannot ring is worse than
 * no number at all when a batch gets recalled.
 */
export function PhoneField({ field, value, onChange, disabled }: FieldProps) {
  const current = typeof value === 'string' ? value : undefined;
  const invalid = Boolean(current) && !isValidPhoneNumber(current!);

  return (
    <>
      <PhoneInput
        id={field.id}
        international
        defaultCountry="IM"
        countryCallingCodeEditable={false}
        value={current}
        onChange={(next) => onChange(next ?? undefined)}
        disabled={disabled}
        className={cn('karsons-phone', disabled && 'opacity-55')}
      />
      {invalid ? (
        <p className="mt-1.5 text-[12.5px] text-review-700">
          That number does not look complete.
        </p>
      ) : null}
    </>
  );
}

/**
 * A plain calendar date.
 *
 * `date` was in the FieldType union with no case in the renderer's switch, so a
 * date question fell through to the default text box: no picker, no validation,
 * and a free-text string stored where an ISO date was expected. Nothing shipped
 * one, because it was also missing from the palette — the type existed and was
 * unreachable from both ends.
 *
 * Distinct from `dateOfBirth`, which is a three-part day/month/year entry
 * because typing a birth date into a picker means scrolling back seventy years.
 * This is for near dates — last vaccination, travel date — where a picker wins.
 *
 * Stores an ISO `YYYY-MM-DD` string, the same shape `dateOfBirth` produces, so
 * everything downstream that already handles a date keeps working.
 */
export function DateInput({ field, value, onChange, disabled }: FieldProps) {
  return (
    <input
      id={field.id}
      type="date"
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      className={inputClass}
    />
  );
}

export function TextInput({ field, value, onChange, disabled }: FieldProps) {
  const inputType =
    field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : 'text';

  return (
    <input
      id={field.id}
      type={inputType}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      disabled={disabled}
      value={value === undefined || value === null ? '' : String(value)}
      placeholder={field.placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (field.type === 'number') {
          onChange(raw === '' ? undefined : Number(raw));
        } else {
          onChange(raw === '' ? undefined : raw);
        }
      }}
      className={inputClass}
    />
  );
}

export function TextArea({ field, value, onChange, disabled }: FieldProps) {
  return (
    <textarea
      id={field.id}
      rows={3}
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={cn(inputClass, 'min-h-[84px] resize-y')}
    />
  );
}

export function AddressInput({ field, value, onChange, disabled }: FieldProps) {
  return (
    <textarea
      id={field.id}
      rows={3}
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      placeholder={'House number and street\nTown\nPostcode'}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={cn(inputClass, 'min-h-[84px] resize-y')}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// 8 · Date of birth — three boxes, not a picker
// ─────────────────────────────────────────────────────────────

export function DateOfBirthInput({ field, value, onChange, disabled }: FieldProps) {
  /*
   * The patient's questionnaire and the staff forms now share one control.
   *
   * This file had its own three boxes with no auto-advance, no paste, no age
   * shown and no validation — and it emitted `1990-3-` while you were still
   * typing, which is neither empty nor a date. The staff side meanwhile used
   * the browser's picker, which opens on this month and made somebody entering
   * a birth date page back through decades.
   */
  return (
    <DateOfBirthField
      id={field.id}
      disabled={disabled}
      required={field.required}
      value={typeof value === 'string' ? value : ''}
      onChange={(next) => onChange(next || undefined)}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// 9 · Measurement — dual units, stored SI
// ─────────────────────────────────────────────────────────────

type MeasurementValue = { si: number | null; unit: string; raw: Record<string, number | ''> };

export function MeasurementInput({ field, value, onChange, disabled }: FieldProps) {
  const kind = field.measurementKind ?? 'length';
  const current = (value ?? {}) as Partial<MeasurementValue>;
  const metricUnit = kind === 'weight' ? 'kg' : 'cm';
  const imperialUnit = kind === 'weight' ? 'st_lb' : kind === 'height' ? 'ft_in' : 'in';
  const unit = current.unit ?? metricUnit;
  const raw = current.raw ?? {};

  function emit(nextUnit: string, nextRaw: Record<string, number | ''>) {
    let si: number | null = null;

    if (nextUnit === 'kg') si = Number(nextRaw.value) || null;
    else if (nextUnit === 'cm') si = Number(nextRaw.value) || null;
    else if (nextUnit === 'st_lb') {
      const st = Number(nextRaw.stones) || 0;
      const lb = Number(nextRaw.pounds) || 0;
      si = st || lb ? stonesAndPoundsToKg({ stones: st, pounds: lb }) : null;
    } else if (nextUnit === 'ft_in') {
      const ft = Number(nextRaw.feet) || 0;
      const inch = Number(nextRaw.inches) || 0;
      si = ft || inch ? feetAndInchesToCm({ feet: ft, inches: inch }) : null;
    } else if (nextUnit === 'in') {
      si = Number(nextRaw.value) ? inchesToCm(Number(nextRaw.value)) : null;
    }

    onChange({ si, unit: nextUnit, raw: nextRaw });
  }

  /** Switching units converts what is already entered rather than clearing it. */
  function switchUnit(nextUnit: string) {
    const si = current.si ?? null;
    if (si === null) { emit(nextUnit, {}); return; }

    if (nextUnit === 'kg' || nextUnit === 'cm') emit(nextUnit, { value: si });
    else if (nextUnit === 'st_lb') {
      const { stones, pounds } = kgToStonesAndPounds(si);
      emit(nextUnit, { stones, pounds });
    } else if (nextUnit === 'ft_in') {
      const { feet, inches } = cmToFeetAndInches(si);
      emit(nextUnit, { feet, inches });
    } else if (nextUnit === 'in') {
      emit(nextUnit, { value: cmToInches(si) });
    }
  }

  const numberBox = 'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] tabular text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none';

  return (
    <div>
      <div className="mb-2.5 inline-flex gap-1 rounded-control bg-sunk p-1">
        {[
          { key: metricUnit, label: kind === 'weight' ? 'Kilograms' : 'Centimetres' },
          { key: imperialUnit, label: kind === 'weight' ? 'Stones & pounds' : kind === 'height' ? 'Feet & inches' : 'Inches' },
        ].map((u) => (
          <button key={u.key} type="button" disabled={disabled} aria-pressed={unit === u.key}
            onClick={() => switchUnit(u.key)}
            className={cn(
              'rounded-[6px] px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              unit === u.key ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]' : 'text-ink-soft hover:text-ink',
            )}>
            {u.label}
          </button>
        ))}
      </div>

      <div className="flex max-w-[340px] items-center gap-2">
        {unit === 'st_lb' ? (
          <>
            <div className="flex-1">
              <input aria-label="Stones" inputMode="decimal" disabled={disabled} className={numberBox}
                value={raw.stones ?? ''} onChange={(e) => emit(unit, { ...raw, stones: e.target.value === '' ? '' : Number(e.target.value) })} />
              <span className="mt-1 block text-center text-[11.5px] text-ink-faint">stones</span>
            </div>
            <div className="flex-1">
              <input aria-label="Pounds" inputMode="decimal" disabled={disabled} className={numberBox}
                value={raw.pounds ?? ''} onChange={(e) => emit(unit, { ...raw, pounds: e.target.value === '' ? '' : Number(e.target.value) })} />
              <span className="mt-1 block text-center text-[11.5px] text-ink-faint">pounds</span>
            </div>
          </>
        ) : unit === 'ft_in' ? (
          <>
            <div className="flex-1">
              <input aria-label="Feet" inputMode="decimal" disabled={disabled} className={numberBox}
                value={raw.feet ?? ''} onChange={(e) => emit(unit, { ...raw, feet: e.target.value === '' ? '' : Number(e.target.value) })} />
              <span className="mt-1 block text-center text-[11.5px] text-ink-faint">feet</span>
            </div>
            <div className="flex-1">
              <input aria-label="Inches" inputMode="decimal" disabled={disabled} className={numberBox}
                value={raw.inches ?? ''} onChange={(e) => emit(unit, { ...raw, inches: e.target.value === '' ? '' : Number(e.target.value) })} />
              <span className="mt-1 block text-center text-[11.5px] text-ink-faint">inches</span>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <input aria-label={field.label} inputMode="decimal" disabled={disabled} className={numberBox}
              value={raw.value ?? ''} onChange={(e) => emit(unit, { value: e.target.value === '' ? '' : Number(e.target.value) })} />
            <span className="mt-1 block text-center text-[11.5px] text-ink-faint">{unit}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 10 · Derived — computed, never typed
// ─────────────────────────────────────────────────────────────

export function DerivedValue({ field, answers }: FieldProps) {
  let computed: number | null = null;
  let suffix = '';

  if (field.calculation === 'bmi') {
    const [weightKey, heightKey] = field.calculationInputs ?? [];
    const weight = (answers[weightKey ?? ''] as { si?: number | null } | undefined)?.si;
    const height = (answers[heightKey ?? ''] as { si?: number | null } | undefined)?.si;
    if (weight && height) computed = calculateBmi(weight, height);
  }

  return (
    <div className="inline-flex items-baseline gap-2.5 rounded-control border border-line bg-sunk px-4 py-3">
      <span className="tabular font-display text-[24px] font-semibold text-ink">
        {computed ?? '—'}
      </span>
      <span className="text-[13px] text-ink-faint">
        {computed === null ? 'Fill in the measurements above' : suffix || 'calculated'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 11 · Upload and camera
// ─────────────────────────────────────────────────────────────

/**
 * A file the patient actually sent.
 *
 * The upload happens the moment a file is chosen, not at submit. That is what
 * turns the green tick into a promise the system can keep: previously the form
 * showed one, then dropped the file on submit because a `File` cannot be
 * serialised into the answers payload — so the patient believed they had sent
 * their exemption letter and the pharmacy never knew one existed.
 *
 * The answer stored is a reference to the saved object, never the file itself.
 */
export function FileUploadInput({ field, value, onChange, disabled }: FieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const target = useUploadTarget();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const stored = isStoredFileRef(value) ? value : null;
  const isCamera = field.type === 'photoCapture';
  const Icon = isCamera ? Camera : Upload;
  const uploadable = canUpload(target);

  async function choose(file: File | undefined) {
    if (!file) return;
    setFailure(null);

    if (!uploadable) {
      // Refuse rather than accept-and-lose. Being told now is far better than
      // a clinician discovering the gap when the patient is in front of them.
      setFailure('This form cannot take attachments. Please bring the document with you.');
      return;
    }

    setBusy(true);
    const result = await uploadFile(target, field.id, file);
    setBusy(false);

    if (result.ok) onChange(result.file);
    else setFailure(result.error);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex w-full items-center gap-3.5 rounded-[9px] border border-dashed px-4 py-4 text-left transition-colors',
          stored ? 'border-safe-600 bg-safe-50' : 'border-line bg-sunk hover:border-brand-400',
          failure && 'border-stop-600 bg-stop-50',
          (disabled || busy) && 'cursor-not-allowed opacity-55',
        )}
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-control',
            stored ? 'bg-safe-100 text-safe-700' : 'bg-surface text-ink-faint',
          )}
        >
          {busy ? (
            <Loader2 size={18} className="animate-spin" />
          ) : stored ? (
            <Check size={18} strokeWidth={2.4} />
          ) : (
            <Icon size={18} strokeWidth={1.9} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium text-ink">
            {busy
              ? 'Sending…'
              : (stored?.name ?? (isCamera ? 'Take a photo' : 'Choose a file or take a photo'))}
          </span>
          <span className="block text-[12.5px] text-ink-faint">
            {busy
              ? 'Please keep this page open'
              : stored
                ? `Sent · ${formatFileSize(stored.size)} · tap to replace`
                : 'JPG, PNG, HEIC or PDF, up to 10MB'}
          </span>
        </span>
      </button>

      {failure ? (
        <p className="mt-1.5 text-[12.5px] text-stop-700">{failure}</p>
      ) : null}

      <input
        ref={inputRef}
        id={field.id}
        type="file"
        accept="image/jpeg,image/png,image/heic,application/pdf"
        capture={isCamera ? 'environment' : undefined}
        className="sr-only"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          // Clear it so choosing the same file twice still fires a change.
          e.target.value = '';
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 12 · Signature
// ─────────────────────────────────────────────────────────────

export function SignaturePad({ field, value, onChange, disabled }: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#191428';
  }, []);

  function position(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = position(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = position(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(undefined);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label={field.label}
        className={cn(
          'h-[150px] w-full touch-none rounded-[9px] border bg-surface',
          hasInk ? 'border-brand-300' : 'border-dashed border-line',
          disabled && 'opacity-55',
        )}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12.5px] text-ink-faint">
          {hasInk ? 'Signed' : 'Sign with your finger or mouse'}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
        >
          <Eraser size={13} strokeWidth={2} />
          Clear
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 13 · Info block and consent
// ─────────────────────────────────────────────────────────────

export function InfoBlock({ field }: FieldProps) {
  return (
    <div className="my-2 rounded-[9px] border border-line bg-sunk px-4 py-3.5">
      <p className="text-[13.5px] leading-relaxed text-ink-soft">{field.label}</p>
    </div>
  );
}

export function ConsentList({
  field, value, onChange, disabled, clauses,
}: FieldProps & { clauses: { id: string; text: string }[] }) {
  const accepted = value === true;

  return (
    <div>
      <ul className="mb-3 flex flex-col gap-2.5 rounded-[9px] border border-line bg-sunk px-4 py-4">
        {clauses.map((clause) => (
          <li key={clause.id} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-soft">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            {clause.text}
          </li>
        ))}
      </ul>

      <button
        type="button"
        role="checkbox"
        aria-checked={accepted}
        disabled={disabled}
        onClick={() => onChange(accepted ? undefined : true)}
        className={cn(
          'flex w-full items-start gap-3 rounded-control border px-4 py-3.5 text-left transition-colors',
          accepted ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-brand-300',
          disabled && 'cursor-not-allowed opacity-55',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
            accepted ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
          )}
        >
          {accepted ? <Check size={13} strokeWidth={3} /> : null}
        </span>
        <span className="text-[14.5px] font-medium leading-snug text-ink">
          {/* The fallback is the wording every form used before this was
              configurable, so existing published versions are unchanged. */}
          {field.confirmLabel ?? 'I have read and agree to all of the above.'}
        </span>
      </button>
    </div>
  );
}
