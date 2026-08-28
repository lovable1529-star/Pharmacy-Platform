/**
 * Configurable dose ladders.
 *
 * The ladder is not a display list — it is the thing "only same or ±1 step" is
 * measured against, so a step change is meaningless without the ordering. These
 * pin that the functions honour a supplied ladder rather than the built-in one,
 * which is what moving the medicine master into the database depends on.
 */

import { describe, it, expect } from 'vitest';
import {
  doseStepChange, ladderPosition, parseMedicineValue, DOSE_LADDERS,
  type DoseLadders,
} from '../src/lib/clinical/derived';

/** A pharmacy that has added a strength the source never knew about. */
const CONFIGURED: DoseLadders = {
  Mounjaro: ['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg'],
  Wegovy: ['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg'],
  Saxenda: ['0.6mg', '1.2mg', '1.8mg', '2.4mg', '3mg'],
};

describe('the built-in ladders still apply when nothing is configured', () => {
  it('measures a single step', () => {
    expect(doseStepChange('mounjaro_7.5mg', 'mounjaro_10mg')).toBe(1);
  });

  it('measures a jump', () => {
    expect(doseStepChange('mounjaro_2.5mg', 'mounjaro_10mg')).toBe(3);
  });

  it('signs a decrease negatively', () => {
    expect(doseStepChange('mounjaro_10mg', 'mounjaro_7.5mg')).toBe(-1);
  });

  it('refuses to compare across medicines', () => {
    // Switching brand is not a step on any ladder, and the ruleset treats the
    // resulting null as "do not proceed automatically".
    expect(doseStepChange('mounjaro_5mg', 'wegovy_1mg')).toBeNull();
  });
});

describe('a ladder supplied from the master', () => {
  it('recognises a medicine the source does not carry', () => {
    expect(parseMedicineValue('saxenda_1.2mg')).toBeNull();
    expect(parseMedicineValue('saxenda_1.2mg', CONFIGURED)).toEqual({
      medicine: 'Saxenda', strength: '1.2mg',
    });
  });

  it('measures steps on it', () => {
    expect(doseStepChange('saxenda_0.6mg', 'saxenda_1.8mg', CONFIGURED)).toBe(2);
    expect(doseStepChange('saxenda_0.6mg', 'saxenda_1.8mg')).toBeNull();
  });

  it('takes position from the configured order, not alphabetically', () => {
    // '10mg' sorts before '2.5mg' as text. Position has to come from the rung.
    expect(ladderPosition('Mounjaro', '10mg', CONFIGURED)).toBe(3);
    expect(ladderPosition('Mounjaro', '2.5mg', CONFIGURED)).toBe(0);
  });

  it('returns null for a strength the master has retired', () => {
    const trimmed: DoseLadders = { Mounjaro: ['5mg', '7.5mg', '10mg'] };
    expect(ladderPosition('Mounjaro', '2.5mg', trimmed)).toBeNull();
    // And therefore no step change rather than a wrong one — this gates a RED.
    expect(doseStepChange('mounjaro_2.5mg', 'mounjaro_10mg', trimmed)).toBeNull();
  });
});

describe('the built-in ladders are internally sane', () => {
  it('has no duplicate rungs', () => {
    for (const [brand, ladder] of Object.entries(DOSE_LADDERS)) {
      expect(new Set(ladder).size, `${brand} has a repeated strength`).toBe(ladder.length);
    }
  });

  it('is ordered by ascending dose', () => {
    for (const [brand, ladder] of Object.entries(DOSE_LADDERS)) {
      const numeric = ladder.map((s) => parseFloat(s));
      const sorted = [...numeric].sort((a, b) => a - b);
      expect(numeric, `${brand} is out of order`).toEqual(sorted);
    }
  });
});
