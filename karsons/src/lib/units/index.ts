/**
 * Unit conversion.
 *
 * The client's patients are asked for weight in stones and pounds and waist in
 * inches. The database stores SI throughout. Conversion happens at the UI
 * boundary and nowhere else — if you find yourself converting inside business
 * logic, something has leaked.
 */

const KG_PER_POUND = 0.45359237;
const POUNDS_PER_STONE = 14;
const CM_PER_INCH = 2.54;

export interface StonesAndPounds {
  stones: number;
  pounds: number;
}

export function stonesAndPoundsToKg({ stones, pounds }: StonesAndPounds): number {
  const totalPounds = stones * POUNDS_PER_STONE + pounds;
  return round(totalPounds * KG_PER_POUND, 2);
}

export function kgToStonesAndPounds(kg: number): StonesAndPounds {
  const totalPounds = kg / KG_PER_POUND;
  const stones = Math.floor(totalPounds / POUNDS_PER_STONE);
  const pounds = round(totalPounds - stones * POUNDS_PER_STONE, 1);

  // Rounding can push pounds to exactly 14 — carry it into stones.
  if (pounds >= POUNDS_PER_STONE) {
    return { stones: stones + 1, pounds: 0 };
  }
  return { stones, pounds };
}

export function inchesToCm(inches: number): number {
  return round(inches * CM_PER_INCH, 1);
}

export function cmToInches(cm: number): number {
  return round(cm / CM_PER_INCH, 1);
}

export function feetAndInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * 12 + inches);
}

/** BMI in kg/m². Returns null rather than Infinity when height is absent. */
export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (!heightCm || heightCm <= 0 || !weightKg || weightKg <= 0) return null;
  const heightM = heightCm / 100;
  return round(weightKg / (heightM * heightM), 1);
}

/**
 * Percentage weight change between two measurements.
 * Negative means weight lost — but the client's clinical rules are expressed
 * as "≥2% weight loss", so `percentageWeightLoss` returns a positive number
 * for loss to keep the rules readable.
 */
export function percentageWeightLoss(previousKg: number, currentKg: number): number | null {
  if (!previousKg || previousKg <= 0) return null;
  return round(((previousKg - currentKg) / previousKg) * 100, 2);
}

/** Money is stored as integer pence. Never use floats for currency. */
export function formatMoney(minorUnits: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(
    minorUnits / 100,
  );
}

function round(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}
