/**
 * Splitting a booked name.
 *
 * Booking asks for one name field; a patient record needs two. The split is
 * what lets a patient record exist from the moment an appointment does.
 */

import { describe, it, expect } from 'vitest';
import { splitName, isIsoDate } from '../src/lib/patients/name';

describe('splitName', () => {
  it('splits an ordinary name', () => {
    expect(splitName('Bridget Kelly')).toEqual({ firstName: 'Bridget', lastName: 'Kelly' });
  });

  it('keeps a middle name with the first', () => {
    // Splitting on the FIRST space would give "Mary" / "Jane Watson", which is
    // wrong far more often than this is.
    expect(splitName('Mary Jane Watson')).toEqual({ firstName: 'Mary Jane', lastName: 'Watson' });
  });

  it('treats a single word as the surname', () => {
    // Somebody is asked for at a counter by surname.
    expect(splitName('Khan')).toEqual({ firstName: '—', lastName: 'Khan' });
  });

  it('tidies stray spacing rather than failing on it', () => {
    expect(splitName('  Bridget   Kelly  ')).toEqual({ firstName: 'Bridget', lastName: 'Kelly' });
  });

  it('refuses an empty name', () => {
    expect(splitName('')).toBeNull();
    expect(splitName('   ')).toBeNull();
  });
});

describe('isIsoDate', () => {
  it('accepts a real date of birth', () => {
    expect(isIsoDate('1974-03-05')).toBe(true);
  });

  it('rejects a future date', () => {
    // A future date of birth is a typo, not a patient — and it would create a
    // record that never matches the person again.
    expect(isIsoDate('2099-01-01')).toBe(false);
  });

  it('rejects anything not a full date', () => {
    expect(isIsoDate('05/03/1974')).toBe(false);
    expect(isIsoDate('1974-3-5')).toBe(false);
    expect(isIsoDate('1974')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('rejects an impossible date', () => {
    expect(isIsoDate('1974-13-45')).toBe(false);
  });
});
