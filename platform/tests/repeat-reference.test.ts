/**
 * The Repeat Care ID.
 *
 * The gate at /repeat/[slug] matches on this plus the email on record. An
 * enrolment without one is unreachable — which is what an automatically
 * created enrolment was, so a patient completed the whole new-patient journey
 * and still could not request a repeat.
 */

import { describe, expect, it } from 'vitest';
import {
  generateRepeatReference, normaliseRepeatReference, repeatReferencesMatch,
} from '@/lib/repeat-care/reference';

describe('generating one', () => {
  it('has the shape a person can read down a telephone', () => {
    expect(generateRepeatReference(() => 0)).toBe('RC-AAAA-AAAA');
    expect(generateRepeatReference()).toMatch(/^RC-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  /*
   * Read aloud and typed off a printed label, so the characters people
   * reliably confuse are simply not in the alphabet.
   */
  it('avoids the characters people mistake for each other', () => {
    const many = Array.from({ length: 300 }, () => generateRepeatReference()).join('');
    for (const confusable of ['O', '0', 'I', '1', 'L', 'S', '5', 'U', 'V']) {
      expect(many.replace(/^RC|-/g, '')).not.toContain(confusable);
    }
  });

  it('does not hand out the same one twice in a row', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateRepeatReference()));
    expect(seen.size).toBeGreaterThan(190);
  });
});

describe('matching what somebody typed', () => {
  /*
   * A reference read over the telephone comes back without its dashes about as
   * often as with them. Refusing that teaches people the system is broken.
   */
  it('ignores dashes, spaces and case', () => {
    for (const typed of ['RC-4H7K-M2PQ', 'rc4h7km2pq', 'RC 4H7K M2PQ', '  RC-4h7k-m2pq  ']) {
      expect(repeatReferencesMatch(typed, 'RC-4H7K-M2PQ')).toBe(true);
    }
  });

  it('still refuses a different reference', () => {
    expect(repeatReferencesMatch('RC-4H7K-M2PQ', 'RC-9WXY-3JTN')).toBe(false);
  });

  /* An enrolment with no reference must never match, least of all a blank. */
  it('never matches an enrolment with no reference', () => {
    expect(repeatReferencesMatch('RC-4H7K-M2PQ', null)).toBe(false);
    expect(repeatReferencesMatch('', null)).toBe(false);
  });

  it('normalises consistently', () => {
    expect(normaliseRepeatReference(' rc-4h7k-m2pq ')).toBe('RC4H7KM2PQ');
  });
});
