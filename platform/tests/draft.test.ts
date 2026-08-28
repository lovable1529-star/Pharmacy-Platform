import { describe, it, expect } from 'vitest';
import {
  generateResumeToken, resumeExpiry, tokensMatch, isExpired, buildFormUrl,
  RESUME_WINDOW_DAYS,
} from '@/lib/forms/draft';
import { readIdentity } from '@/lib/patients/identify';

describe('resume tokens', () => {
  it('produces a different token every time', () => {
    // The token is the only credential protecting a patient's medical answers.
    // A collision or a predictable sequence would be a data breach, not a bug.
    const tokens = new Set(Array.from({ length: 500 }, () => generateResumeToken()));
    expect(tokens.size).toBe(500);
  });

  it('carries at least 256 bits of entropy', () => {
    // 32 random bytes in base64url is 43 characters. Anything materially
    // shorter would mean somebody had quietly weakened the generator.
    expect(generateResumeToken().length).toBeGreaterThanOrEqual(43);
  });

  it('is URL-safe so mail clients cannot mangle the link', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateResumeToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('expires the configured number of days out', () => {
    const from = new Date('2026-08-28T10:00:00Z');
    const expires = resumeExpiry(from);
    const days = (expires.getTime() - from.getTime()) / (24 * 60 * 60_000);
    expect(days).toBeCloseTo(RESUME_WINDOW_DAYS, 5);
  });
});

describe('tokensMatch', () => {
  it('matches an identical token', () => {
    const token = generateResumeToken();
    expect(tokensMatch(token, token)).toBe(true);
  });

  it('rejects a different token of the same length', () => {
    expect(tokensMatch('abcdef', 'abcdeg')).toBe(false);
  });

  it('rejects on length mismatch rather than throwing', () => {
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });

  it('treats null and empty as no match', () => {
    expect(tokensMatch(null, 'abc')).toBe(false);
    expect(tokensMatch('abc', null)).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-08-28T12:00:00Z');

  it('treats a null expiry as never expiring', () => {
    // Rows created before resume tokens existed have no expiry, and must not
    // become unopenable the moment the column was added.
    expect(isExpired(null, now)).toBe(false);
  });

  it('is expired at exactly the expiry instant', () => {
    expect(isExpired(new Date('2026-08-28T12:00:00Z'), now)).toBe(true);
  });

  it('is not expired a second before', () => {
    expect(isExpired(new Date('2026-08-28T12:00:01Z'), now)).toBe(false);
  });
});

describe('buildFormUrl', () => {
  it('encodes the token into the query string', () => {
    const url = buildFormUrl('https://karsons.im', 'flu-vaccination', 'ab-cd_ef');
    expect(url).toBe('https://karsons.im/f/flu-vaccination?s=ab-cd_ef');
  });

  it('does not double the slash when the base URL has a trailing one', () => {
    expect(buildFormUrl('https://karsons.im/', 'flu', 'x')).toBe(
      'https://karsons.im/f/flu?s=x',
    );
  });
});

describe('readIdentity', () => {
  const full = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '1985-12-10',
    email: 'ada@example.com',
    phone: '+447700900123',
  };

  it('reads a complete identity', () => {
    expect(readIdentity(full)).toEqual(full);
  });

  it('trims surrounding whitespace', () => {
    const identity = readIdentity({ ...full, firstName: '  Ada  ' });
    expect(identity?.firstName).toBe('Ada');
  });

  it('returns null without a date of birth', () => {
    // A patient record with no date of birth can never be safely matched
    // against later, so creating one is worse than creating nothing.
    const { dateOfBirth, ...rest } = full;
    void dateOfBirth;
    expect(readIdentity(rest)).toBeNull();
  });

  it('returns null when a name is blank or whitespace', () => {
    expect(readIdentity({ ...full, lastName: '   ' })).toBeNull();
    expect(readIdentity({ ...full, firstName: '' })).toBeNull();
  });

  it('rejects a malformed date of birth rather than storing it', () => {
    expect(readIdentity({ ...full, dateOfBirth: '10/12/1985' })).toBeNull();
    expect(readIdentity({ ...full, dateOfBirth: '1985-12' })).toBeNull();
  });

  it('allows missing contact details', () => {
    const { email, phone, ...rest } = full;
    void email;
    void phone;
    const identity = readIdentity(rest);
    expect(identity).not.toBeNull();
    expect(identity?.email).toBeNull();
    expect(identity?.phone).toBeNull();
  });

  it('ignores non-string answers rather than coercing them', () => {
    expect(readIdentity({ ...full, firstName: 42 })).toBeNull();
  });
});
