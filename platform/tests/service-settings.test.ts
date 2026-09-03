/**
 * Service price and public branding.
 *
 * The price one matters most: a service with no price stranded every
 * prescription raised from it at PENDING_PAYMENT, because there was nothing to
 * charge and so nothing ever settled it.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseProfile,
  parsePrice,
  priceProblems,
  profileIsEmpty,
  publicProfileProblems,
  type PublicProfileDraft,
} from '../src/lib/services/settings';

function profile(over: Partial<PublicProfileDraft> = {}): PublicProfileDraft {
  return {
    publicBrandName: '',
    primaryColour: '',
    secondaryColour: '',
    supportEmail: '',
    supportPhone: '',
    privacyUrl: '',
    termsUrl: '',
    fulfilmentName: '',
    ...over,
  };
}

describe('reading a price', () => {
  it('takes whole pounds', () => {
    expect(parsePrice('190')).toBe(19000);
  });

  it('takes pounds and pence', () => {
    expect(parsePrice('190.50')).toBe(19050);
  });

  it('ignores a pound sign and thousands separators', () => {
    expect(parsePrice('£1,900')).toBe(190000);
  });

  it('treats an empty box as no price', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('   ')).toBeNull();
  });

  it('rounds rather than truncates', () => {
    // 19.999 typed by accident is £20.00, not £19.99.
    expect(parsePrice('19.999')).toBe(2000);
  });

  it('reports nonsense as not-a-number rather than guessing', () => {
    expect(Number.isNaN(parsePrice('free') as number)).toBe(true);
  });
});

describe('validating a price', () => {
  it('accepts no price at all', () => {
    expect(priceProblems(null)).toEqual([]);
  });

  it('accepts a normal price', () => {
    expect(priceProblems(19000)).toEqual([]);
    expect(priceProblems(0)).toEqual([]);
  });

  it('refuses a negative price', () => {
    expect(priceProblems(-1)).toHaveLength(1);
  });

  it('refuses nonsense', () => {
    expect(priceProblems(Number.NaN)).toHaveLength(1);
  });

  it('refuses a fraction of a penny', () => {
    expect(priceProblems(190.5)).toHaveLength(1);
  });

  it('catches a missing decimal point', () => {
    // The mistake that actually happens with a pounds field storing pence.
    const problems = priceProblems(10_000_00 + 1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('decimal point');
  });
});

describe('validating a public profile', () => {
  it('accepts an entirely empty one', () => {
    expect(publicProfileProblems(profile())).toEqual([]);
  });

  it('accepts a filled-in one', () => {
    expect(publicProfileProblems(profile({
      publicBrandName: 'Karsons Weight Management',
      primaryColour: '#5B3FA8',
      secondaryColour: '#0F766E',
      supportEmail: 'clinic@karsonspharmacy.co.uk',
      supportPhone: '01624 615150',
      privacyUrl: 'https://karsonspharmacy.co.uk/privacy',
      termsUrl: 'https://karsonspharmacy.co.uk/terms',
      fulfilmentName: 'Karsons Pharmacy Limited',
    }))).toEqual([]);
  });

  it('refuses a colour that is not a hex code', () => {
    expect(publicProfileProblems(profile({ primaryColour: 'purple' }))).toHaveLength(1);
  });

  it('accepts three-digit hex', () => {
    expect(publicProfileProblems(profile({ primaryColour: '#5B3' }))).toEqual([]);
  });

  it('refuses a link that would run code in the patient browser', () => {
    expect(publicProfileProblems(profile({ privacyUrl: 'javascript:alert(1)' }))).toHaveLength(1);
  });

  it('refuses a bare domain, which is not a link', () => {
    expect(publicProfileProblems(profile({ termsUrl: 'karsonspharmacy.co.uk/terms' })))
      .toHaveLength(1);
  });

  it('refuses an email that is not an address', () => {
    expect(publicProfileProblems(profile({ supportEmail: 'ring the shop' }))).toHaveLength(1);
  });

  it('leaves the phone alone, because phone numbers are written many ways', () => {
    expect(publicProfileProblems(profile({ supportPhone: '01624 615150 (ask for the clinic)' })))
      .toEqual([]);
  });

  it('reports every fault at once rather than the first', () => {
    expect(publicProfileProblems(profile({
      primaryColour: 'purple',
      supportEmail: 'nope',
      privacyUrl: 'karsons.im',
    }))).toHaveLength(3);
  });
});

describe('storing a profile', () => {
  it('knows an empty one from a filled one', () => {
    expect(profileIsEmpty(profile())).toBe(true);
    expect(profileIsEmpty(profile({ publicBrandName: '  ' }))).toBe(true);
    expect(profileIsEmpty(profile({ publicBrandName: 'Karsons WM' }))).toBe(false);
  });

  it('turns blanks into nulls, so "not set" is one value', () => {
    const stored = normaliseProfile(profile({ publicBrandName: '  Karsons WM  ' }));
    expect(stored.publicBrandName).toBe('Karsons WM');
    expect(stored.supportEmail).toBeNull();
  });
});
