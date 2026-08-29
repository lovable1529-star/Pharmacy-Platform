'use client';

/**
 * Entering a date of birth.
 *
 * The staff forms used `<input type="date">`, which hands you the browser's
 * picker. That picker opens on the current month and expects you to navigate to
 * a date near today — which is right for an expiry date or an appointment, and
 * wrong for a birth date, where the answer is most often forty to eighty years
 * back. A receptionist with a patient in front of them was paging through
 * decades.
 *
 * Three boxes instead, because that is how a date of birth is spoken and how it
 * appears on every document a patient will be holding: day, month, year.
 *
 * ── What makes it fast ───────────────────────────────────────────────────
 *
 * Typing is the whole interaction. Two digits in the day box move to the month
 * automatically; two in the month move to the year. Backspace at the start of
 * an empty box moves back. Somebody reading a date aloud can be typed at
 * without ever looking at the screen or touching the mouse.
 *
 * Pasting works too, in the formats that actually turn up: 14/03/1958,
 * 14-03-1958 and the ISO 1958-03-14 that comes out of our own exports.
 *
 * ── What makes it safe ───────────────────────────────────────────────────
 *
 * The age is shown as soon as the date is complete. That is the check a
 * pharmacist actually performs — "sixty-eight, yes, that's her" — and it
 * catches a typo in the year, which is the error that matters and the one a
 * picker hides completely.
 *
 * Impossible dates are refused rather than accepted and normalised. 31 February
 * is a typo, and JavaScript's Date would quietly turn it into 3 March; a
 * silently corrected date of birth on a clinical record is worse than an error
 * message.
 *
 * The value is only emitted when it is a real, complete date. The previous
 * implementation emitted `1990-3-` while you were still typing, which is
 * neither empty nor valid, and downstream code had to guess.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  type DateParts, EMPTY_PARTS, splitIsoDate, toDate, toIsoDate, ageOn,
  dateOfBirthProblem, toStoredDate, parsePastedDate, segmentComplete,
} from '@/lib/patients/date-of-birth';

export interface DateOfBirthProps {
  /** ISO `YYYY-MM-DD`, or an empty string when incomplete. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  /** Latest date accepted. Defaults to today — nobody is born tomorrow. */
  max?: Date;
  /**
   * Marks the field as changed-and-worth-noticing, without saying it is wrong.
   *
   * The edit screen uses it when a date of birth is being altered on an
   * existing record — amber, because that is a thing to look at twice rather
   * than an error. A real problem still overrides it and shows red.
   */
  warn?: boolean;
}

export function DateOfBirthField({
  value, onChange, id, disabled, required, max, warn,
}: DateOfBirthProps) {
  const [parts, setParts] = useState<DateParts>(() => splitIsoDate(value));
  const [touched, setTouched] = useState(false);

  const dayRef = useRef<HTMLInputElement | null>(null);
  const monthRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);

  /*
   * Follow the value when it changes from OUTSIDE — a prefill arriving, or an
   * edit screen loading a patient.
   *
   * Tracked by what we last emitted rather than by re-deriving it from the
   * boxes. Comparing against the boxes looked equivalent and was not: clearing
   * the day of a saved date makes the boxes incomplete, so they no longer match
   * the parent's still-valid value, and the effect helpfully put the old date
   * back. Editing the date of birth of an existing patient was impossible.
   */
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setParts(splitIsoDate(value));
  }, [value]);

  const ceiling = max ?? new Date();
  const parsed = toDate(parts);
  const problem = dateOfBirthProblem(parts, ceiling);

  function commit(next: DateParts) {
    setParts(next);
    // Empty until it is a real date. Half a date is not a date.
    const stored = toStoredDate(next, ceiling);
    lastEmitted.current = stored;
    onChange(stored);
  }

  function digitsOnly(raw: string, maxLength: number): string {
    return raw.replace(/\D/g, '').slice(0, maxLength);
  }

  /*
   * The ref OBJECT is passed, never `ref.current`.
   *
   * Reading it at render time captures whatever it held then — null on the
   * first render, because React populates refs during commit. Auto-advance
   * would silently not work until the component had re-rendered once.
   */
  type Ref = React.RefObject<HTMLInputElement | null>;

  function handle(key: keyof DateParts, maxLength: number, next: Ref | null) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const digits = digitsOnly(event.target.value, maxLength);
      commit({ ...parts, [key]: digits });
      // See `segmentComplete`: a lone "2" in the day box is not finished.
      if (segmentComplete(key, digits)) next?.current?.focus();
    };
  }

  function handleBack(key: keyof DateParts, previous: Ref) {
    return (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Backspace') return;
      if (parts[key] !== '') return;
      previous.current?.focus();
    };
  }

  /**
   * A whole date pasted into any box.
   *
   * Staff paste from a spreadsheet, an email or our own CSV export, and having
   * that land as "14031958" in the day box is the kind of small failure that
   * makes people stop trusting a field.
   */
  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const next = parsePastedDate(event.clipboardData.getData('text'));
    if (!next) return;

    event.preventDefault();
    commit(next);
    yearRef.current?.focus();
  }

  /*
   * Nothing is rewritten as you type.
   *
   * These boxes used to pad a single digit to two on blur, so that "3" in the
   * month box meant March. It also meant that leaving the day box after one
   * digit turned "2" into "02" — and somebody part-way through typing 25 saw
   * their input changed under them and the caret jump.
   *
   * The padding was never needed: `toStoredDate` builds the ISO value through
   * `Date`, which pads on its own. So "2" and "02" store identically and the
   * display can simply show what was typed.
   */
  function markTouched() {
    setTouched(true);
  }

  const box = cn(
    'rounded-control border bg-surface px-3 py-2.5 text-center text-[15px] tabular text-ink',
    'transition-[border-color,box-shadow] placeholder:text-ink-faint',
    'focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none',
    problem && touched
      ? 'border-stop-200 focus:border-stop-600'
      : warn
        ? 'border-review-600 focus:border-review-600'
        : 'border-line focus:border-brand-400',
  );

  const showProblem = problem !== null && touched;

  return (
    <div>
      <div className="flex max-w-[330px] gap-2" onPaste={handlePaste}>
        <input
          ref={dayRef}
          id={id}
          aria-label="Day of birth"
          inputMode="numeric"
          autoComplete="bday-day"
          disabled={disabled}
          required={required}
          placeholder="DD"
          value={parts.day}
          onChange={handle('day', 2, monthRef)}
          onBlur={markTouched}
          aria-invalid={showProblem}
          className={cn(box, 'w-[72px]')}
        />
        <input
          ref={monthRef}
          aria-label="Month of birth"
          inputMode="numeric"
          autoComplete="bday-month"
          disabled={disabled}
          required={required}
          placeholder="MM"
          value={parts.month}
          onChange={handle('month', 2, yearRef)}
          onKeyDown={handleBack('month', dayRef)}
          onBlur={markTouched}
          aria-invalid={showProblem}
          className={cn(box, 'w-[72px]')}
        />
        <input
          ref={yearRef}
          aria-label="Year of birth"
          inputMode="numeric"
          autoComplete="bday-year"
          disabled={disabled}
          required={required}
          placeholder="YYYY"
          value={parts.year}
          onChange={handle('year', 4, null)}
          onKeyDown={handleBack('year', monthRef)}
          onBlur={markTouched}
          aria-invalid={showProblem}
          className={cn(box, 'w-[96px]')}
        />

        {/*
          The confirmation, not decoration. "Sixty-eight, yes, that's her" is
          the check being performed at the counter, and it is what catches a
          mistyped year — the error a date picker hides completely.
        */}
        {parsed && !problem ? (
          <span className="flex items-center whitespace-nowrap text-[13px] text-ink-faint">
            {ageOn(parsed, ceiling)} years old
          </span>
        ) : null}
      </div>

      {showProblem ? (
        <p role="alert" className="mt-1.5 text-[12.5px] text-stop-700">{problem}</p>
      ) : null}
    </div>
  );
}
