import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  findDuplicates,
  parseQuery,
  searchPatients,
  similarity,
  type PatientRecord,
} from '@/lib/patients/search';

const patients: PatientRecord[] = [
  { id: '1', firstName: 'Bridget', lastName: 'Kelly', dateOfBirth: new Date(Date.UTC(1974, 2, 5)), phone: '07624 100200', postcode: 'IM3 1AR' },
  { id: '2', firstName: 'Bridget', lastName: 'Quayle', dateOfBirth: new Date(Date.UTC(1982, 6, 19)), phone: '07624 200300', postcode: 'IM1 2BB' },
  { id: '3', firstName: 'Callum', lastName: 'Kelly', dateOfBirth: new Date(Date.UTC(1990, 10, 2)), phone: '07624 300400', postcode: 'IM6 1AT' },
  { id: '4', firstName: 'Deborah', lastName: 'Kermode', dateOfBirth: new Date(Date.UTC(1955, 0, 30)), phone: '07624 400500', postcode: 'IM8 3CD' },
  { id: '5', firstName: 'Illiam', lastName: 'Corlett', dateOfBirth: new Date(Date.UTC(1974, 2, 5)), phone: '07624 500600', postcode: 'IM5 1EF' },
];

describe('parseQuery', () => {
  it('separates names from a date of birth', () => {
    const result = parseQuery('Kelly 05/03/1974');
    expect(result.nameTokens).toEqual(['kelly']);
    expect(result.dateOfBirth?.getUTCFullYear()).toBe(1974);
    expect(result.dateOfBirth?.getUTCMonth()).toBe(2);
  });

  it('accepts several date formats', () => {
    expect(parseQuery('05/03/1974').dateOfBirth).not.toBeNull();
    expect(parseQuery('05-03-1974').dateOfBirth).not.toBeNull();
    expect(parseQuery('1974-03-05').dateOfBirth).not.toBeNull();
  });

  it('expands a two-digit year to the past, not the future', () => {
    // A patient born in 74 means 1974, not 2074.
    expect(parseQuery('05/03/74').dateOfBirth?.getUTCFullYear()).toBe(1974);
  });

  it('rejects impossible dates rather than rolling them over', () => {
    expect(parseQuery('31/02/1990').dateOfBirth).toBeNull();
  });

  it('recognises an Isle of Man postcode', () => {
    expect(parseQuery('IM3 1AR').postcode).toBe('IM31AR');
  });

  it('recognises a phone number', () => {
    expect(parseQuery('07624100200').phoneDigits).toBe('07624100200');
  });

  it('handles a mixed query', () => {
    const result = parseQuery('Bridget Kelly 05/03/1974');
    expect(result.nameTokens).toEqual(['bridget', 'kelly']);
    expect(result.dateOfBirth).not.toBeNull();
  });
});

describe('similarity', () => {
  it('scores identical strings as 1', () => {
    expect(similarity('Kelly', 'kelly')).toBe(1);
  });

  it('scores a typo highly', () => {
    expect(similarity('Kelly', 'Kelley')).toBeGreaterThan(0.8);
    expect(similarity('Quayle', 'Quale')).toBeGreaterThan(0.8);
  });

  it('scores unrelated strings low', () => {
    expect(similarity('Kelly', 'Kermode')).toBeLessThan(0.5);
  });
});

describe('searchPatients', () => {
  it('finds by surname', () => {
    const results = searchPatients(patients, 'Kelly');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.patient.lastName === 'Kelly')).toBe(true);
  });

  it('finds by first name', () => {
    const results = searchPatients(patients, 'Bridget');
    expect(results.map((r) => r.patient.id).sort()).toEqual(['1', '2']);
  });

  it('finds by partial name — a pharmacist types the first few letters', () => {
    const results = searchPatients(patients, 'Kerm');
    expect(results[0]?.patient.lastName).toBe('Kermode');
  });

  it('ranks a full name match above a surname-only match', () => {
    const results = searchPatients(patients, 'Bridget Kelly');
    expect(results[0]?.patient.id).toBe('1');
  });

  it('uses date of birth as the strongest disambiguator', () => {
    // Two patients share a date of birth but only one is a Kelly.
    const results = searchPatients(patients, 'Kelly 05/03/1974');
    expect(results[0]?.patient.id).toBe('1');
  });

  it('finds by date of birth alone', () => {
    const results = searchPatients(patients, '05/03/1974');
    expect(results.map((r) => r.patient.id).sort()).toEqual(['1', '5']);
  });

  it('finds by phone number', () => {
    const results = searchPatients(patients, '07624300400');
    expect(results[0]?.patient.id).toBe('3');
  });

  it('tolerates a misspelling', () => {
    const results = searchPatients(patients, 'Kermodee');
    expect(results[0]?.patient.lastName).toBe('Kermode');
  });

  it('returns nothing for an empty query', () => {
    expect(searchPatients(patients, '')).toEqual([]);
    expect(searchPatients(patients, '   ')).toEqual([]);
  });

  it('reports which fields matched, for highlighting', () => {
    const results = searchPatients(patients, 'Kelly 05/03/1974');
    expect(results[0]?.matched).toContain('dateOfBirth');
    expect(results[0]?.matched).toContain('lastName');
  });

  it('respects the result limit', () => {
    expect(searchPatients(patients, 'Kelly', { limit: 1 })).toHaveLength(1);
  });
});

describe('findDuplicates', () => {
  it('flags high confidence on the same name and date of birth', () => {
    const incoming = { firstName: 'Bridget', lastName: 'Kelly', dateOfBirth: new Date(Date.UTC(1974, 2, 5)) };
    const results = findDuplicates(incoming, patients);

    expect(results[0]?.confidence).toBe('high');
    expect(results[0]?.patient.id).toBe('1');
    expect(results[0]?.reasons).toContain('Same date of birth');
  });

  it('flags a misspelled surname with the same date of birth', () => {
    const incoming = { firstName: 'Bridget', lastName: 'Kelley', dateOfBirth: new Date(Date.UTC(1974, 2, 5)) };
    const results = findDuplicates(incoming, patients);

    expect(results[0]?.confidence).toBe('high');
    expect(results[0]?.reasons).toContain('Similar last name');
  });

  it('flags a shared phone number even when names differ', () => {
    const incoming = {
      firstName: 'Robert', lastName: 'Smith',
      dateOfBirth: new Date(Date.UTC(1960, 1, 1)),
      phone: '07624 100200',
    };
    const results = findDuplicates(incoming, patients);
    expect(results[0]?.confidence).toBe('medium');
    expect(results[0]?.reasons).toContain('Same phone number');
  });

  it('does not flag genuinely different people who share a surname', () => {
    const incoming = { firstName: 'Fiona', lastName: 'Kelly', dateOfBirth: new Date(Date.UTC(2001, 5, 15)) };
    expect(findDuplicates(incoming, patients)).toHaveLength(0);
  });

  it('orders results by confidence', () => {
    const incoming = {
      firstName: 'Bridget', lastName: 'Kelly',
      dateOfBirth: new Date(Date.UTC(1974, 2, 5)),
      phone: '07624 500600',
    };
    const results = findDuplicates(incoming, patients);
    expect(results[0]?.confidence).toBe('high');
  });
});

describe('ageInYears', () => {
  it('calculates age correctly', () => {
    expect(ageInYears(new Date(Date.UTC(1974, 2, 5)), new Date(Date.UTC(2026, 7, 27)))).toBe(52);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    expect(ageInYears(new Date(Date.UTC(1974, 10, 5)), new Date(Date.UTC(2026, 7, 27)))).toBe(51);
  });

  it('counts a birthday on the day itself', () => {
    expect(ageInYears(new Date(Date.UTC(1974, 7, 27)), new Date(Date.UTC(2026, 7, 27)))).toBe(52);
  });
});
