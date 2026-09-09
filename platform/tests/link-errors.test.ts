/**
 * What a member of staff is told when an emailed link fails.
 *
 * The case that prompted this is the first one: Supabase's own PKCE message,
 * complete with an instruction to install a library, reached a pharmacist's
 * sign-in screen.
 */

import { describe, it, expect } from 'vitest';
import {
  asEmailOtpType, describeLinkFailure, landingFor, EMAIL_OTP_TYPES, describeSendFailure } from '../src/lib/auth/link-errors';

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

describe('describeSendFailure', () => {
  it('says nothing about an unrecognised failure, so no secret leaks on a guess', () => {
    expect(describeSendFailure('user not found')).toBeNull();
    expect(describeSendFailure('signups not allowed for this instance')).toBeNull();
    expect(describeSendFailure('')).toBeNull();
    expect(describeSendFailure(null)).toBeNull();
    expect(describeSendFailure(undefined)).toBeNull();
  });

  it('recognises the free-tier hourly cap, whichever way Supabase words it', () => {
    for (const raw of [
      'email rate limit exceeded',
      'over_email_send_rate_limit',
      'Email rate limit exceeded',
    ]) {
      const failure = describeSendFailure(raw);
      expect(failure, raw).not.toBeNull();
      expect(failure!.transient).toBe(true);
    }
  });

  it('trusts a 429 even when the wording is unfamiliar', () => {
    const failure = describeSendFailure('something we have never seen', 429);
    expect(failure?.transient).toBe(true);
  });

  it('separates the per-address cooling-off from the hourly cap', () => {
    const brief = describeSendFailure(
      'For security purposes, you can only request this after 51 seconds.',
    );
    const hourly = describeSendFailure('email rate limit exceeded');
    expect(brief).not.toBeNull();
    expect(brief!.message).not.toBe(hourly!.message);
  });

  it('calls a broken mailer our problem rather than a wait', () => {
    const failure = describeSendFailure('Error sending recovery email');
    expect(failure?.transient).toBe(false);
  });

  // The reason this function exists: it must never become another way to ask
  // whether an address belongs to somebody.
  it('never describes anything that reveals whether an account exists', () => {
    for (const raw of [
      'User not found',
      'user_not_found',
      'Unable to validate email address: invalid format',
      'User already registered',
    ]) {
      expect(describeSendFailure(raw), raw).toBeNull();
    }
  });

  it('recognises the Resend faults that follow a switch-over', () => {
    const cases = [
      'The karsonspharmacy.co.uk domain is not verified. Please, add and verify your domain',
      'You can only send testing emails to your own email address (shahid@reputera.in)',
      'API key is invalid',
      'You have reached your daily sending quota',
    ];
    for (const raw of cases) {
      expect(describeSendFailure(raw), raw).not.toBeNull();
    }
  });

  // The branch for an unverified *domain* must not catch an unverified
  // *account* — that is a fact about the person, and this screen hides those.
  it('still hides an account that has not confirmed its email', () => {
    expect(describeSendFailure('Email not confirmed')).toBeNull();
    expect(describeSendFailure('email_not_confirmed')).toBeNull();
    expect(describeSendFailure('User email not verified')).toBeNull();
  });

  it('never repeats the sending domain or the account holder back to the user', () => {
    const leaky = describeSendFailure(
      'You can only send testing emails to your own email address (shahid@reputera.in)',
    );
    expect(leaky!.message).not.toContain('reputera');
    expect(leaky!.message).not.toContain('@');

    const unverified = describeSendFailure(
      'The karsonspharmacy.co.uk domain is not verified.',
    );
    expect(unverified!.message).not.toContain('karsonspharmacy');
  });

  it('does not put a library or an HTTP status in front of a pharmacist', () => {
    const messages = [
      describeSendFailure('email rate limit exceeded'),
      describeSendFailure('For security purposes, you can only request this after 9 seconds'),
      describeSendFailure('Error sending invite email'),
      describeSendFailure('gateway', 503),
    ].map((f) => f!.message.toLowerCase());

    for (const m of messages) {
      for (const leak of ['supabase', 'smtp', '429', '500', 'null', 'undefined']) {
        expect(m, m).not.toContain(leak);
      }
    }
  });
});
