/**
 * The face-to-face referral link.
 *
 * Two things matter: a patient stopped by the online form is always given a
 * next step where one exists, and the link is never something that runs code
 * in their browser.
 */

import { describe, it, expect } from 'vitest';
import {
  isExternalReferral,
  isUsableReferralUrl,
  placeholderReferralUrl,
  resolveReferralUrl,
} from '../src/lib/services/referral';

describe('what counts as a usable link', () => {
  it('accepts our own pages', () => {
    expect(isUsableReferralUrl('/in-person/weight-management-first')).toBe(true);
  });

  it('accepts absolute web addresses', () => {
    expect(isUsableReferralUrl('https://karsons.im/weight-management')).toBe(true);
    expect(isUsableReferralUrl('http://karsons.im/weight-management')).toBe(true);
  });

  it('refuses anything that would run code in the patient browser', () => {
    expect(isUsableReferralUrl('javascript:alert(1)')).toBe(false);
    expect(isUsableReferralUrl('data:text/html,<script>')).toBe(false);
  });

  it('refuses a protocol-relative address pretending to be one of our pages', () => {
    // `//evil.example` reads like a path and is not one.
    expect(isUsableReferralUrl('//evil.example/book')).toBe(false);
  });

  it('refuses a bare domain, which is not a link', () => {
    expect(isUsableReferralUrl('karsons.im/weight-management')).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(isUsableReferralUrl('')).toBe(false);
    expect(isUsableReferralUrl('   ')).toBe(false);
  });
});

describe('resolving which link to offer', () => {
  const slug = 'weight-management-first';

  it('uses the pharmacy own page when they have configured one', () => {
    expect(resolveReferralUrl({ configured: 'https://karsons.im/f2f', serviceSlug: slug }))
      .toBe('https://karsons.im/f2f');
  });

  it('falls back to the placeholder until they configure one', () => {
    expect(resolveReferralUrl({ configured: null, serviceSlug: slug }))
      .toBe('/in-person/weight-management-first');
    expect(resolveReferralUrl({ configured: '   ', serviceSlug: slug }))
      .toBe('/in-person/weight-management-first');
  });

  it('trims what was typed', () => {
    expect(resolveReferralUrl({ configured: '  https://karsons.im/f2f  ', serviceSlug: slug }))
      .toBe('https://karsons.im/f2f');
  });

  it('offers nothing rather than the placeholder when a bad link is configured', () => {
    // Hiding the mistake behind the placeholder would stop whoever typed it
    // ever finding out.
    expect(resolveReferralUrl({ configured: 'javascript:alert(1)', serviceSlug: slug }))
      .toBeNull();
  });

  it('offers nothing for a service with no in-person equivalent', () => {
    expect(resolveReferralUrl({
      configured: null,
      serviceSlug: 'flu-vaccination',
      offerPlaceholder: false,
    })).toBeNull();
  });

  it('still honours a configured link on a service that has no placeholder', () => {
    expect(resolveReferralUrl({
      configured: 'https://karsons.im/flu-clinic',
      serviceSlug: 'flu-vaccination',
      offerPlaceholder: false,
    })).toBe('https://karsons.im/flu-clinic');
  });
});

describe('how the link should open', () => {
  it('treats our own pages as internal', () => {
    expect(isExternalReferral(placeholderReferralUrl('weight-management-first'))).toBe(false);
  });

  it('treats the pharmacy own site as external', () => {
    expect(isExternalReferral('https://karsons.im/f2f')).toBe(true);
  });
});
