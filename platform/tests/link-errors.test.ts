/**
 * What a member of staff is told when an emailed link fails.
 *
 * The case that prompted this is the first one: Supabase's own PKCE message,
 * complete with an instruction to install a library, reached a pharmacist's
 * sign-in screen.
 */

import { describe, it, expect } from 'vitest';
import {
  asEmailOtpType, describeLinkFailure, landingFor, EMAIL_OTP_TYPES,
} from '../src/lib/auth/link-errors';

describe('translating an auth failure', () => {
  it('replaces the PKCE message with something actionable', () => {
    const raw = 'PKCE code verifier not found in storage. This can happen if the auth '
      + 'flow was initiated in a different browser or device, or if the storage was '
      + 'cleared. For SSR frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr on '
      + 'both the server and client to store the code verifier in cookies.';

    const { message } = describeLinkFailure(raw);

    expect(message).toContain('same device');
    expect(message).not.toMatch(/supabase|pkce|sveltekit|library|cookies/i);
  });

  it('names expiry as expiry', () => {
    expect(describeLinkFailure('Email link is invalid or has expired').message)
      .toContain('expired');
    expect(describeLinkFailure('otp_expired').message).toContain('expired');
  });

  it('says plainly when a link has been used', () => {
    const { message } = describeLinkFailure('Token has already been used');
    expect(message).toContain('already been used');
    // Worth telling somebody, because it may not have been them.
    expect(message).toContain('administrator');
  });

  it('suggests the wrapped-link cause for an invalid token', () => {
    expect(describeLinkFailure('Invalid token hash').message).toContain('two lines');
  });

  it('does not offer a retry for an account that is gone', () => {
    const failure = describeLinkFailure('User not found');
    expect(failure.retryable).toBe(false);
  });

  it('handles being given nothing', () => {
    for (const value of [null, undefined, '']) {
      const failure = describeLinkFailure(value);
      expect(failure.message.length).toBeGreaterThan(0);
      expect(failure.retryable).toBe(true);
    }
  });

  it('never leaks the raw text for a message it does not recognise', () => {
    const raw = 'ERR_JWT_MALFORMED at line 42 in gotrue/internal/api/token.go';
    expect(describeLinkFailure(raw).message).not.toContain('gotrue');
    expect(describeLinkFailure(raw).message).not.toContain('ERR_JWT');
  });

  it('never mentions a library or a framework, whatever it is given', () => {
    const raws = [
      'PKCE code verifier not found in storage',
      'Email link is invalid or has expired',
      'Token has already been used',
      'User not found',
      'Request rate limit reached',
      'something nobody has seen before',
    ];

    for (const raw of raws) {
      expect(describeLinkFailure(raw).message)
        .not.toMatch(/@supabase|next\.js|sveltekit|localstorage|verifier/i);
    }
  });
});

describe('narrowing the link type', () => {
  it('recognises every type an email can carry', () => {
    for (const type of EMAIL_OTP_TYPES) {
      expect(asEmailOtpType(type)).toBe(type);
    }
  });

  it('includes invite, which the old cast left out', () => {
    expect(asEmailOtpType('invite')).toBe('invite');
  });

  it('falls back rather than passing something through unchecked', () => {
    expect(asEmailOtpType('nonsense')).toBe('magiclink');
    expect(asEmailOtpType(null)).toBe('magiclink');
    expect(asEmailOtpType(undefined)).toBe('magiclink');
  });
});

describe('where a link lands', () => {
  it('sends a recovery to choose a password', () => {
    expect(landingFor('recovery', '/')).toBe('/reset-password');
  });

  it('sends an invitation to choose a password', () => {
    // An invited colleague dropped on the dashboard is signed in with no
    // password and no way back in tomorrow.
    expect(landingFor('invite', '/patients')).toBe('/reset-password');
  });

  it('honours a requested destination otherwise', () => {
    expect(landingFor('magiclink', '/patients')).toBe('/patients');
  });

  it('refuses to be redirected off-site', () => {
    expect(landingFor('magiclink', '//evil.example')).toBe('/');
    expect(landingFor('magiclink', 'https://evil.example')).toBe('/');
  });

  it('defaults to the dashboard', () => {
    expect(landingFor('magiclink', null)).toBe('/');
  });
});
