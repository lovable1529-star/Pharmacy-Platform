/**
 * The rules behind the date-of-birth field.
 *
 * The staff forms used a native date picker, which opens on the current month
 * and made a receptionist page back through decades. Replacing it means owning
 * the validation the browser used to do — and doing it better, because the
 * browser was happy to accept a birth date in the future.
 */

import { describe, expect, it } from 'vitest';
import {
  splitIsoDate, toDate, toIsoDate, ageOn,
  dateOfBirthProblem, toStoredDate, parsePastedDate, segmentComplete,
} from '@/lib/patients/date-of-birth';

const TODAY = new Date(Date.UTC(2026, 7, 30));

describe('reading a date', () => {
  it('splits an ISO date into parts', () => {
    expect(splitIsoDate('1958-03-14')).toEqual({ year: '1958', month: '03', day: '14' });
  });

  it('gives empty parts for anything that is not a full ISO date', () => {
    for (const bad of ['', '1958-3-14', '14/03/1958', '1958-03', 'not a date']) {
      expect(splitIsoDate(bad)).toEqual({ day: '', month: '', year: '' });
    }
  });

  it('round-trips', () => {
    const parts = splitIsoDate('1958-03-14');
    expect(toIsoDate(toDate(parts)!)).toBe('1958-03-14');
  });
});

describe('impossible dates', () => {
  /*
   * The one that matters. `new Date(1958, 1, 31)` is accepted by JavaScript and
   * hands back 3 March — so without comparing the components back out, a typo
   * becomes a different, plausible-looking date of birth on a clinical record.
   */
  it('refuses 31 February instead of silently moving it to March', () => {
    expect(toDate({ day: '31', month: '02', year: '1958' })).toBeNull();
    expect(dateOfBirthProblem({ day: '31', month: '02', year: '1958' }, TODAY))
      .toMatch(/does not exist/);
  });

  it('refuses the 31st of a thirty-day month', () => {
    expect(toDate({ day: '31', month: '04', year: '1990' })).toBeNull();
  });

  it('accepts 29 February in a leap year and refuses it otherwise', () => {
    expect(toDate({ day: '29', month: '02', year: '2000' })).not.toBeNull();
    expect(toDate({ day: '29', month: '02', year: '1999' })).toBeNull();
  });

  it('refuses a month outside 1-12', () => {
    expect(toDate({ day: '01', month: '13', year: '1990' })).toBeNull();
    expect(toDate({ day: '01', month: '00', year: '1990' })).toBeNull();
  });
});

describe('dates that parse but cannot be a birth date', () => {
  it('refuses the future — the native picker did not', () => {
    expect(dateOfBirthProblem({ day: '01', month: '01', year: '2030' }, TODAY))
      .toMatch(/cannot be in the future/);
  });

  it('refuses an age over 120, which is a mistyped year', () => {
    expect(dateOfBirthProblem({ day: '14', month: '03', year: '1858' }, TODAY))
      .toMatch(/over 120/);
  });

  it('accepts a plausible date of birth', () => {
    expect(dateOfBirthProblem({ day: '14', month: '03', year: '1958' }, TODAY)).toBeNull();
  });
});

describe('while it is still being typed', () => {
  /*
   * A field that turns red on the first keystroke teaches people to ignore it.
   * Nothing is wrong until the date is complete.
   */
  it('reports no problem for a partial date', () => {
    expect(dateOfBirthProblem({ day: '1', month: '', year: '' }, TODAY)).toBeNull();
    expect(dateOfBirthProblem({ day: '14', month: '03', year: '19' }, TODAY)).toBeNull();
  });

  /*
   * The old control emitted `1990-3-` mid-typing, which is neither empty nor a
   * date, and every reader downstream had to guess what it meant.
   */
  it('stores nothing until the date is real', () => {
    expect(toStoredDate({ day: '14', month: '03', year: '19' }, TODAY)).toBe('');
    expect(toStoredDate({ day: '31', month: '02', year: '1958' }, TODAY)).toBe('');
    expect(toStoredDate({ day: '01', month: '01', year: '2030' }, TODAY)).toBe('');
    expect(toStoredDate({ day: '14', month: '03', year: '1958' }, TODAY)).toBe('1958-03-14');
  });
});

describe('age', () => {
  it('counts whole years', () => {
    expect(ageOn(new Date(Date.UTC(1958, 2, 14)), TODAY)).toBe(68);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    // Born in December, asked in August: still the younger age.
    expect(ageOn(new Date(Date.UTC(1958, 11, 14)), TODAY)).toBe(67);
  });

  it('counts the birthday itself', () => {
    expect(ageOn(new Date(Date.UTC(1958, 7, 30)), TODAY)).toBe(68);
  });
});

describe('pasting', () => {
  it('takes the formats that actually turn up', () => {
    const expected = { day: '14', month: '03', year: '1958' };
    expect(parsePastedDate('14/03/1958')).toEqual(expected);
    expect(parsePastedDate('14-03-1958')).toEqual(expected);
    expect(parsePastedDate('14.03.1958')).toEqual(expected);
    expect(parsePastedDate('1958-03-14')).toEqual(expected);
    expect(parsePastedDate('  14/03/1958  ')).toEqual(expected);
  });

  it('pads single digits', () => {
    expect(parsePastedDate('4/3/1958')).toEqual({ day: '04', month: '03', year: '1958' });
  });

  it('ignores anything that is not a date, so a normal paste still works', () => {
    for (const bad of ['', 'Margaret', '1958', '14/03/58', 'tomorrow']) {
      expect(parsePastedDate(bad)).toBeNull();
    }
  });
});

describe('moving between the boxes as you type', () => {
  /*
   * The reported bug. A lone digit was treated as finished, so typing 25 in the
   * day box became "02" in the day and "5" pushed into the month.
   */
  it('waits on a day digit that could still be extended', () => {
    for (const d of ['1', '2', '3']) {
      expect(segmentComplete('day', d)).toBe(false);
    }
  });

  it('moves on from a day digit that cannot be extended', () => {
    // There is no 40th of the month, so 4 can only mean the 4th.
    for (const d of ['4', '5', '9']) {
      expect(segmentComplete('day', d)).toBe(true);
    }
  });

  it('waits on month 1, which could be January, October, November or December', () => {
    expect(segmentComplete('month', '1')).toBe(false);
  });

  it('moves on from month 2, which can only be February', () => {
    for (const m of ['2', '5', '9']) {
      expect(segmentComplete('month', m)).toBe(true);
    }
  });

  it('two digits are always finished', () => {
    expect(segmentComplete('day', '25')).toBe(true);
    expect(segmentComplete('month', '12')).toBe(true);
  });

  it('a year is only finished at four digits', () => {
    for (const y of ['1', '19', '195']) {
      expect(segmentComplete('year', y)).toBe(false);
    }
    expect(segmentComplete('year', '1958')).toBe(true);
  });

  /*
   * The display keeps exactly what was typed — the padding that caused this
   * bug was never needed, because the stored ISO value pads on its own.
   */
  it('a single digit still stores as a padded ISO date', () => {
    expect(toStoredDate({ day: '2', month: '5', year: '1990' }, TODAY)).toBe('1990-05-02');
  });
});
