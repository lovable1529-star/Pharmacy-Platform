/**
 * Reading an answer back.
 *
 * Every case here is a bug that reached a clinical record: a measurement that
 * printed `[object Object] cm`, a BMI that printed a dash on a weight-management
 * prescription, and a signature that printed three kilobytes of base64 where a
 * mark should be.
 *
 * The screen and the PDF used to do this separately and disagreed. These pin
 * the one implementation they now share.
 */

import { describe, expect, it } from 'vitest';
import { presentAnswer, formatMeasurement, derivedValue, isImageAnswer } from '@/lib/forms/present';
import type { FormField } from '@/types/form-schema';

const weight: FormField = {
  id: 'weight', type: 'measurement', label: 'Current weight', measurementKind: 'weight',
};
const height: FormField = {
  id: 'height', type: 'measurement', label: 'Height', measurementKind: 'height',
};
const bmi: FormField = {
  id: 'bmi', type: 'derived', label: 'Calculated BMI',
  calculation: 'bmi', calculationInputs: ['weight', 'height'],
};

describe('measurements', () => {
  it('reads back the units the patient chose, not the units we store', () => {
    // Somebody who typed 12 stone 4 has not asserted "78 kg". Showing SI back
    // makes the record look altered.
    expect(formatMeasurement({ si: 78.0, unit: 'st_lb', raw: { stones: 12, pounds: 4 } }))
      .toBe('12 st 4 lb');
    expect(formatMeasurement({ si: 162.6, unit: 'ft_in', raw: { feet: 5, inches: 4 } }))
      .toBe('5 ft 4 in');
  });

  it('handles the metric single-value units', () => {
    expect(formatMeasurement({ si: 84.2, unit: 'kg', raw: { value: 84.2 } })).toBe('84.2 kg');
    expect(formatMeasurement({ si: 96, unit: 'cm', raw: { value: 96 } })).toBe('96 cm');
  });

  /*
   * The regression. The old code interpolated `record.raw` — the CONTAINER —
   * straight into a template string, so every measurement on every consultation
   * read "[object Object] cm".
   */
  it('never renders the container object', () => {
    const cases = [
      { si: 84.2, unit: 'kg', raw: { value: 84.2 } },
      { si: 78.0, unit: 'st_lb', raw: { stones: 12, pounds: 4 } },
      { si: 162.6, unit: 'ft_in', raw: { feet: 5, inches: 4 } },
      { si: 96, unit: 'cm', raw: {} },
    ];
    for (const value of cases) {
      expect(presentAnswer(weight, value)).not.toContain('[object Object]');
    }
  });

  it('falls back to the stored value when raw is empty rather than reading as unanswered', () => {
    // An answer that exists must not print as a dash.
    expect(formatMeasurement({ si: 96, unit: 'cm', raw: {} })).toBe('96 cm');
  });

  it('reports genuinely empty as empty', () => {
    expect(formatMeasurement({ si: null, unit: 'cm', raw: {} })).toBe('—');
  });
});

describe('calculated values', () => {
  /*
   * These are never stored — the patient's form computes them at render time.
   * Everything downstream saw nothing, so BMI was a dash on the review screen,
   * on the printed prescription and in the GP's copy, while being correct on
   * the form the patient had just filled in.
   */
  it('computes BMI from the measurements around it', () => {
    const answers = {
      weight: { si: 84.2, unit: 'kg', raw: { value: 84.2 } },
      height: { si: 163, unit: 'cm', raw: { value: 163 } },
    };
    expect(derivedValue(bmi, answers)).toBe('31.7');
    expect(presentAnswer(bmi, undefined, answers)).toBe('31.7');
  });

  it('says nothing rather than guessing when a measurement is missing', () => {
    const answers = { weight: { si: 84.2, unit: 'kg', raw: { value: 84.2 } } };
    expect(derivedValue(bmi, answers)).toBeNull();
    expect(presentAnswer(bmi, undefined, answers)).toBe('—');
  });

  it('computes age from a date of birth', () => {
    const age: FormField = {
      id: 'age', type: 'derived', label: 'Age', calculation: 'age', calculationInputs: ['dob'],
    };
    const value = presentAnswer(age, undefined, { dob: '1958-03-14' });
    expect(Number(value)).toBeGreaterThan(60);
  });
});

describe('signatures', () => {
  const signature: FormField = { id: 'sig', type: 'signature', label: 'Please sign below' };
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAxk';

  it('is recognised as a picture so a caller can draw it', () => {
    expect(isImageAnswer(signature, dataUrl)).toBe(true);
  });

  /*
   * The text path must never emit the data URL. The review screen printed the
   * whole base64 string into the record where the mark should have been.
   */
  it('never returns the raw data url as text', () => {
    const text = presentAnswer(signature, dataUrl);
    expect(text).toBe('Signed');
    expect(text).not.toContain('base64');
  });

  it('an unsigned field is empty, not "Signed"', () => {
    expect(presentAnswer(signature, undefined)).toBe('—');
  });
});

describe('everything else', () => {
  const yesNo: FormField = { id: 'q', type: 'yesNo', label: 'Are you pregnant?' };

  it('spells out the stored answer tokens', () => {
    expect(presentAnswer(yesNo, 'yes')).toBe('Yes');
    expect(presentAnswer(yesNo, 'no')).toBe('No');
    expect(presentAnswer({ ...yesNo, type: 'yesNoNa' }, 'na')).toBe('N/A');
  });

  it('uses the option label rather than its stored value', () => {
    const select: FormField = {
      id: 's', type: 'select', label: 'Hydration',
      options: [{ value: 'lt_1', label: 'Less than 1 litre a day' }],
    };
    expect(presentAnswer(select, 'lt_1')).toBe('Less than 1 litre a day');
  });

  it('joins a multi-select by label', () => {
    const multi: FormField = {
      id: 'm', type: 'multiSelect', label: 'Effects',
      options: [{ value: 'a', label: 'Nausea' }, { value: 'b', label: 'Headache' }],
    };
    expect(presentAnswer(multi, ['a', 'b'])).toBe('Nausea, Headache');
  });

  it('names an uploaded file rather than printing its storage path', () => {
    const upload: FormField = { id: 'f', type: 'fileUpload', label: 'Photo' };
    const value = { path: 'org/abc-123.jpg', name: 'medicine-box.jpg', size: 91234 };
    expect(presentAnswer(upload, value)).toBe('medicine-box.jpg');
  });

  it('reads an address as one line', () => {
    const address: FormField = { id: 'a', type: 'address', label: 'Home address' };
    expect(presentAnswer(address, { addressLine1: '42 Royal Avenue', town: 'Onchan', postcode: 'IM3 1LG' }))
      .toBe('42 Royal Avenue, Onchan, IM3 1LG');
  });
});
