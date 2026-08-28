/**
 * Consent captured as a record.
 *
 * The point of the snapshot is that the exact statements a patient was shown
 * survive a later rewording of the form. These pin the two ways that goes
 * wrong: recording a consent question the patient never saw, and losing a
 * per-question override in favour of the form-wide list.
 */

import { describe, it, expect } from 'vitest';
import { consentTextFor } from '../src/lib/workflow/consent';
import type { FormSchema } from '../src/types/form-schema';

const SCHEMA: FormSchema = {
  schemaVersion: 1,
  title: 'Test',
  consentClauses: [
    { id: 'c1', text: 'The information I have given is true and accurate.' },
    { id: 'c2', text: 'I consent to the medicine being supplied.' },
  ],
  steps: [
    {
      id: 'about',
      title: 'About you',
      fields: [
        { id: 'gender', type: 'select', label: 'Gender', options: [
          { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' },
        ] },
      ],
    },
    {
      id: 'consent',
      title: 'Consent',
      fields: [
        { id: 'consent', type: 'consentList', label: 'Consent to treatment', required: true },
        {
          id: 'gpConsent',
          type: 'consentList',
          label: 'Sharing with your GP',
          required: true,
          // A second consent with its own wording — the case the form-wide list
          // could not express.
          consentClauses: [{ id: 'g1', text: 'I agree my GP may be told.' }],
          visibleWhen: [{ field: 'gender', operator: 'eq', value: 'female' }],
        },
      ],
    },
  ],
};

describe('consentTextFor', () => {
  it('snapshots the form-wide statements', () => {
    const text = consentTextFor(SCHEMA, { gender: 'male', consent: true });
    expect(text).toContain('true and accurate');
    expect(text).toContain('consent to the medicine being supplied');
  });

  it('uses a question own wording where it overrides the form', () => {
    const text = consentTextFor(SCHEMA, { gender: 'female', consent: true, gpConsent: true });
    expect(text).toContain('I agree my GP may be told.');
  });

  it('leaves out a consent question the patient never saw', () => {
    // gpConsent is hidden for male patients. Recording it as agreed would be a
    // false claim about something never put to them.
    const text = consentTextFor(SCHEMA, { gender: 'male', consent: true });
    expect(text).not.toContain('I agree my GP may be told.');
  });

  it('returns nothing when a form asks for no consent', () => {
    const noConsent: FormSchema = {
      schemaVersion: 1, title: 'Weight only',
      steps: [{ id: 's', title: 'S', fields: [
        { id: 'weight', type: 'number', label: 'Weight' },
      ] }],
    };
    // An empty record would make "consent held" untrue wherever it is counted.
    expect(consentTextFor(noConsent, {})).toBeNull();
  });

  it('keeps the statements in the order they were shown', () => {
    const text = consentTextFor(SCHEMA, { gender: 'female', consent: true, gpConsent: true })!;
    expect(text.indexOf('true and accurate')).toBeLessThan(text.indexOf('GP may be told'));
  });
});
