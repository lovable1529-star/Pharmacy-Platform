import { describe, expect, it } from 'vitest';
import {
  calculateBmi,
  cmToInches,
  feetAndInchesToCm,
  formatMoney,
  inchesToCm,
  kgToStonesAndPounds,
  percentageWeightLoss,
  stonesAndPoundsToKg,
} from '@/lib/units';

describe('weight conversion', () => {
  it('converts stones and pounds to kilograms', () => {
    expect(stonesAndPoundsToKg({ stones: 14, pounds: 0 })).toBeCloseTo(88.9, 1);
    expect(stonesAndPoundsToKg({ stones: 12, pounds: 7 })).toBeCloseTo(79.4, 1);
  });

  it('converts kilograms back to stones and pounds', () => {
    expect(kgToStonesAndPounds(88.9)).toEqual({ stones: 14, pounds: 0 });
  });

  it('round-trips without drift', () => {
    const original = { stones: 15, pounds: 9 };
    const result = kgToStonesAndPounds(stonesAndPoundsToKg(original));
    expect(result.stones).toBe(original.stones);
    expect(result.pounds).toBeCloseTo(original.pounds, 0);
  });

  it('carries 14 pounds into a whole stone rather than showing "13st 14lb"', () => {
    const result = kgToStonesAndPounds(stonesAndPoundsToKg({ stones: 13, pounds: 13.99 }));
    expect(result.pounds).toBeLessThan(14);
  });
});

describe('length conversion', () => {
  it('converts inches to centimetres', () => {
    expect(inchesToCm(38)).toBeCloseTo(96.5, 1);
  });

  it('converts centimetres to inches', () => {
    expect(cmToInches(96.5)).toBeCloseTo(38, 1);
  });

  it('converts feet and inches to centimetres', () => {
    expect(feetAndInchesToCm(5, 9)).toBeCloseTo(175.3, 1);
  });
});

describe('BMI', () => {
  it('calculates BMI correctly', () => {
    expect(calculateBmi(88.9, 175.3)).toBeCloseTo(28.9, 1);
    expect(calculateBmi(70, 170)).toBeCloseTo(24.2, 1);
  });

  it('returns null rather than Infinity when height is missing', () => {
    expect(calculateBmi(80, 0)).toBeNull();
    expect(calculateBmi(0, 170)).toBeNull();
  });
});

describe('weight loss percentage', () => {
  it('returns a positive number for weight lost', () => {
    // The clinical rules read "≥2% weight loss", so loss must be positive.
    expect(percentageWeightLoss(100, 96)).toBe(4);
  });

  it('returns a negative number for weight gained', () => {
    expect(percentageWeightLoss(100, 104)).toBe(-4);
  });

  it('returns null when the previous weight is unknown', () => {
    expect(percentageWeightLoss(0, 90)).toBeNull();
  });
});

describe('money formatting', () => {
  it('formats integer pence as pounds', () => {
    expect(formatMoney(14999)).toBe('£149.99');
    expect(formatMoney(0)).toBe('£0.00');
  });
});
