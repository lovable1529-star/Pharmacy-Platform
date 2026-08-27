import { describe, it, expect } from 'vitest';
import {
  parseQuery, similarity, searchPatients, shouldSearch, ageInYears,
  type PatientRecord,
} from '@/lib/patients/search';

const PATIENTS: PatientRecord[] = [
  { id: '1', firstName: 'Bridget', lastName: 'Kelly', dateOfBirth: '1974-03-05', postcode: 'IM31AR', phone: '01624615150' },
  { id: '2', firstName: 'Thomas', lastName: 'Kermode', dateOfBirth: '1961-11-20', postcode: 'IM12BX', phone: '01624222333' },
  { id: '3', firstName: 'Bridget', lastName: 'Quayle', dateOfBirth: '1988-07-14', postcode: 'IM61AB', phone: '01624444555' },
  { id: '4', firstName: 'Callum', lastName: 'Costain', dateOfBirth: '1990-01-02', postcode: 'IM31AR', phone: '01624777888' },
];

describe('parseQuery — one box that works out what was typed', () => {
  it('reads a UK-format date of birth', () => {
    expect(parseQuery('05/03/1974').dateOfBirth).toBe('1974-03-05');
  });

  it('reads an ISO date of birth', () => {
    expect(parseQuery('1974-03-05').dateOfBirth).toBe('1974-03-05');
  });

  it('separates a name from a date of birth', () => {
    const parsed = parseQuery('Kelly 05/03/1974');
    expect(parsed.nameTokens).toEqual(['kelly']);
    expect(parsed.dateOfBirth).toBe('1974-03-05');
  });

  it('recognises an Isle of Man postcode written with a space', () => {
    expect(parseQuery('IM3 1AR').postcode).toBe('IM31AR');
  });

  it('recognises a phone number', () => {
    expect(parseQuery('01624615150').phone).toBe('01624615150');
  });
});

describe('similarity — tolerating a misspelt Manx surname', () => {
  it('scores an exact match as 1', () => {
    expect(similarity('Kermode', 'Kermode')).toBe(1);
  });

  it('scores a single-character error highly', () => {
    expect(similarity('kermode', 'kermodee')).toBeGreaterThan(0.8);
  });

  it('scores unrelated words low', () => {
    expect(similarity('kermode', 'costain')).toBeLessThan(0.4);
  });
});

describe('searchPatients', () => {
  it('does not fire below the minimum length', () => {
    expect(shouldSearch('Ke')).toBe(false);
    expect(shouldSearch('Kel')).toBe(true);
    expect(searchPatients(PATIENTS, 'Ke')).toEqual([]);
  });

  it('finds a patient by surname', () => {
    const results = searchPatients(PATIENTS, 'Kelly');
    expect(results[0]?.patient.lastName).toBe('Kelly');
  });

  it('finds a misspelt surname — Kermodee still finds Kermode', () => {
    const results = searchPatients(PATIENTS, 'Kermodee');
    expect(results[0]?.patient.lastName).toBe('Kermode');
    expect(results[0]?.matchedOn).toContain('similar name');
  });

  it('a name plus date of birth beats the same name alone', () => {
    const ambiguous = searchPatients(PATIENTS, 'Bridget');
    expect(ambiguous.length).toBe(2);

    const precise = searchPatients(PATIENTS, 'Bridget 05/03/1974');
    expect(precise[0]?.patient.id).toBe('1');
    expect(precise[0]?.matchedOn).toContain('date of birth');
    expect(precise[0]!.score).toBeGreaterThan(ambiguous[0]!.score);
  });

  it('searches by postcode even though it contains a space', () => {
    const results = searchPatients(PATIENTS, 'IM3 1AR');
    expect(results.map((r) => r.patient.id).sort()).toEqual(['1', '4']);
  });

  it('searches by phone number', () => {
    const results = searchPatients(PATIENTS, '01624615150');
    expect(results[0]?.patient.id).toBe('1');
  });

  it('returns nothing for a query that matches nobody', () => {
    expect(searchPatients(PATIENTS, 'Zzzzzzz')).toEqual([]);
  });
});

describe('ageInYears', () => {
  it('does not count a birthday that has not happened yet this year', () => {
    expect(ageInYears('1974-12-25', new Date('2026-08-27'))).toBe(51);
  });

  it('counts a birthday that has passed', () => {
    expect(ageInYears('1974-03-05', new Date('2026-08-27'))).toBe(52);
  });
});
