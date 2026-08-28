/**
 * Vaccine administration rules.
 *
 * Both rules tested here are the kind that quietly stop being true when
 * somebody builds a second screen, which is why they live in a function rather
 * than in a form.
 */

import { describe, it, expect } from 'vitest';
import {
  needsInjectionType, validateAdministration, normaliseInjectionType,
  CLINICIAN_DECLARATIONS, ADMINISTRATION_SITES, SITE_LABELS,
  type AdministrationDraft,
} from '../src/lib/vaccination/administration';

const TODAY = new Date('2026-08-30T10:00:00Z');

const COMPLETE: AdministrationDraft = {
  patientId: 'p1',
  clinicianId: 'c1',
  branchId: 'b1',
  batchId: 'batch1',
  site: 'LEFT_DELTOID',
  injectionType: 'INTRAMUSCULAR',
  administeredOn: '2026-08-30',
  consentRecorded: true,
  suitabilityConfirmed: true,
  declarationsConfirmed: true,
  batchExpiry: '2027-04-30',
  batchRecalled: false,
  availableQuantity: 12,
};

describe('injection type follows the route — §27.4', () => {
  it('is required for anything injected', () => {
    expect(needsInjectionType('LEFT_DELTOID')).toBe(true);
    expect(needsInjectionType('RIGHT_THIGH')).toBe(true);
    expect(needsInjectionType('SELF_INJECTION')).toBe(true);
  });

  it('is not asked where nothing is injected', () => {
    expect(needsInjectionType('ORAL')).toBe(false);
    expect(needsInjectionType('NASAL')).toBe(false);
    expect(needsInjectionType('TOPICAL')).toBe(false);
  });

  it('discards a stale value when the route changes', () => {
    // Someone picks intramuscular, then changes the route to nasal. The old
    // value must not survive, or the record says a spray was injected.
    expect(normaliseInjectionType('NASAL', 'INTRAMUSCULAR')).toBeNull();
    expect(normaliseInjectionType('LEFT_DELTOID', 'INTRAMUSCULAR')).toBe('INTRAMUSCULAR');
  });

  it('accepts a nasal record with no injection type', () => {
    const issues = validateAdministration(
      { ...COMPLETE, site: 'NASAL', injectionType: null }, TODAY,
    );
    expect(issues).toHaveLength(0);
  });

  it('refuses an injected record without one', () => {
    const issues = validateAdministration(
      { ...COMPLETE, site: 'LEFT_DELTOID', injectionType: null }, TODAY,
    );
    expect(issues.map((i) => i.field)).toContain('injectionType');
  });
});

describe('completion validation — §27.5', () => {
  it('accepts a complete record', () => {
    expect(validateAdministration(COMPLETE, TODAY)).toHaveLength(0);
  });

  it('reports every problem at once, not the first', () => {
    // A pharmacist standing with a patient should see the whole list.
    const issues = validateAdministration({
      ...COMPLETE,
      patientId: null, clinicianId: null, batchId: null,
      consentRecorded: false, declarationsConfirmed: false,
    }, TODAY);
    expect(issues.length).toBeGreaterThanOrEqual(5);
  });

  it('refuses without consent', () => {
    const issues = validateAdministration({ ...COMPLETE, consentRecorded: false }, TODAY);
    expect(issues.map((i) => i.field)).toContain('consent');
  });

  it('refuses without the pharmacist declarations', () => {
    const issues = validateAdministration({ ...COMPLETE, declarationsConfirmed: false }, TODAY);
    expect(issues.map((i) => i.field)).toContain('declarations');
  });

  it('refuses until suitability is confirmed', () => {
    const issues = validateAdministration({ ...COMPLETE, suitabilityConfirmed: false }, TODAY);
    expect(issues.map((i) => i.field)).toContain('suitability');
  });
});

describe('batch safety — §28.4', () => {
  it('refuses an expired batch', () => {
    const issues = validateAdministration({ ...COMPLETE, batchExpiry: '2026-04-30' }, TODAY);
    expect(issues.map((i) => i.message).join(' ')).toContain('expired');
  });

  it('allows a batch expiring later today', () => {
    // Expiry is a date, not an instant. A batch dated today is still usable.
    const issues = validateAdministration({ ...COMPLETE, batchExpiry: '2026-08-30' }, TODAY);
    expect(issues).toHaveLength(0);
  });

  it('refuses a recalled batch', () => {
    const issues = validateAdministration({ ...COMPLETE, batchRecalled: true }, TODAY);
    expect(issues.map((i) => i.message).join(' ')).toContain('recalled');
  });

  it('refuses to take stock below zero', () => {
    const issues = validateAdministration({ ...COMPLETE, availableQuantity: 0 }, TODAY);
    expect(issues.map((i) => i.field)).toContain('batchId');
  });
});

describe('reference data', () => {
  it('names every site in the specification', () => {
    expect(ADMINISTRATION_SITES).toHaveLength(8);
    for (const site of ADMINISTRATION_SITES) expect(SITE_LABELS[site]).toBeTruthy();
  });

  it('carries the four pharmacist declarations with stable keys', () => {
    expect(CLINICIAN_DECLARATIONS).toHaveLength(4);
    const keys = CLINICIAN_DECLARATIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of CLINICIAN_DECLARATIONS) expect(d.text.length).toBeGreaterThan(30);
  });
});
