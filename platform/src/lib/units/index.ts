/**
 * Unit conversion.
 *
 * Patients are asked for weight in stones and pounds and waist in inches. The
 * database stores SI throughout. Conversion happens at the UI boundary and
 * nowhere else — if you find yourself converting inside business logic,
 * something has leaked.
 */

import {
  bmiInputsPlausible, within, BMI as BMI_RANGE,
} from '@/lib/clinical/plausibility';

const KG_PER_STONE = 6.35029318;
const KG_PER_POUND = 0.45359237;
const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

export interface StonesAndPounds {
  stones: number;
  pounds: number;
}

export interface FeetAndInches {
  feet: number;
  inches: number;
}

export function stonesAndPoundsToKg({ stones, pounds }: StonesAndPounds): number {
  return round(stones * KG_PER_STONE + pounds * KG_PER_POUND, 2);
}

export function kgToStonesAndPounds(kg: number): StonesAndPounds {
  const totalPounds = kg / KG_PER_POUND;
  const stones = Math.floor(totalPounds / 14);
  const pounds = Math.round(totalPounds - stones * 14);
  // Rounding can push pounds to 14, which is not a thing.
  return pounds === 14 ? { stones: stones + 1, pounds: 0 } : { stones, pounds };
}

export function inchesToCm(inches: number): number {
  return round(inches * CM_PER_INCH, 1);
}

export function cmToInches(cm: number): number {
  return round(cm / CM_PER_INCH, 1);
}

export function feetAndInchesToCm({ feet, inches }: FeetAndInches): number {
  return round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH, 1);
}

export function cmToFeetAndInches(cm: number): FeetAndInches {
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = Math.round(totalInches - feet * INCHES_PER_FOOT);
  return inches === 12 ? { feet: feet + 1, inches: 0 } : { feet, inches };
}

/** Null rather than NaN or Infinity when the inputs cannot produce a BMI. */
export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm)) return null;
  if (weightKg <= 0 || heightCm <= 0) return null;

  /*
   * Refused rather than computed, when the figures could not have come from a
   * person.
   *
   * A height typed in metres — 1.7 rather than 170 — yields a BMI near
   * 290,000, and that does not fail the clinical rules. It SATISFIES them: the
   * rule authorising a routine repeat wants `bmi >= 25`. So the worst typo on
   * the form came back GREEN and the patient was supplied without a pharmacist
   * looking.
   *
   * Returning null makes the rules that read it skip instead, and a request
   * where nothing matched falls to the AMBER default — a pharmacist reads it.
   * That is the right answer when the data is wrong, and it is emphatically
   * better than guessing that 1.7 meant metres.
   */
  if (!bmiInputsPlausible(weightKg, heightCm)) return null;

  const metres = heightCm / 100;
  const bmi = round(weightKg / (metres * metres), 1);

  // Bounding the inputs still admits absurd pairs; checking the answer closes
  // that without a rule about which of the two was wrong.
  return within(bmi, BMI_RANGE) ? bmi : null;
}

/** Positive means weight was lost. Null when the comparison is meaningless. */
export function percentageWeightLoss(previousKg: number, currentKg: number): number | null {
  if (!Number.isFinite(previousKg) || !Number.isFinite(currentKg)) return null;
  if (previousKg <= 0) return null;
  return round(((previousKg - currentKg) / previousKg) * 100, 2);
}

/** Money is always integer pence. Never floats. */
export function formatMoney(minorUnits: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(
    minorUnits / 100,
  );
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Dates are stored UTC and rendered in the client's own timezone. */
export function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}
