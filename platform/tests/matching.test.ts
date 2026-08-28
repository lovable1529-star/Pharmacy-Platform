import { describe, it, expect } from 'vitest';
import {
  isSamePatient, chooseMatch, normalisePhone, normaliseEmail,
} from '@/lib/patients/matching';

const ada = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1985-12-10',
  phone: '+447700900123',
  email: 'ada@example.com',
};

describe('normalisePhone', () => {
  it('treats the same number written three ways as one number', () => {
    // A pharmacy will genuinely see all of these for one patient.
    const forms = ['+44 7700 900123', '07700900123', '(07700) 900 123'];
    const normalised = forms.map(normalisePhone);
    expect(new Set(normalised).size).toBe(1);
  });

  it('matches a national number against its international form', () => {
    expect(normalisePhone('07700900123')).toBe(normalisePhone('+447700900123'));
  });

  it('ignores anything too short to be a phone number', () => {
    expect(normalisePhone('123')).toBeNull();
    expect(normalisePhone('n/a')).toBeNull();
  });

  it('treats empty and missing as missing', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });
});

describe('normaliseEmail', () => {
  it('is case and whitespace insensitive', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});

describe('isSamePatient', () => {
  it('matches when everything agrees', () => {
    const verdict = isSamePatient(ada, { ...ada });
    expect(verdict.same).toBe(true);
    if (verdict.same) expect(verdict.confirmedBy.sort()).toEqual(['email', 'phone']);
  });

  it('rejects a different date of birth outright', () => {
    const verdict = isSamePatient(ada, { ...ada, dateOfBirth: '1985-12-11' });
    expect(verdict).toEqual({ same: false, reason: 'name-or-dob-differs' });
  });

  it('is case insensitive on names', () => {
    expect(isSamePatient(ada, { ...ada, firstName: 'ADA', lastName: '  lovelace ' }).same).toBe(true);
  });

  // ── The scenario this whole module exists for ──────────
  it('separates two people who share a name and a birthday but not a phone', () => {
    const other = { ...ada, phone: '+447700900999', email: 'other@example.com' };
    expect(isSamePatient(ada, other)).toEqual({ same: false, reason: 'phone-differs' });
  });

  it('separates them on email when the phone cannot be compared', () => {
    const candidate = { ...ada, phone: null };
    const incoming = { ...ada, phone: null, email: 'someone.else@example.com' };
    expect(isSamePatient(candidate, incoming)).toEqual({
      same: false,
      reason: 'email-differs',
    });
  });

  it('checks phone before email, and stops at the first contradiction', () => {
    const incoming = { ...ada, phone: '+447700900999', email: 'different@example.com' };
    expect(isSamePatient(ada, incoming)).toEqual({ same: false, reason: 'phone-differs' });
  });

  // ── Absence is not contradiction ───────────────────────
  it('still matches when the existing record has no phone recorded', () => {
    // "We never asked for their number" is not evidence of a different person.
    // Treating it as such would create a duplicate for everyone who declined.
    const candidate = { ...ada, phone: null };
    const verdict = isSamePatient(candidate, ada);
    expect(verdict.same).toBe(true);
    if (verdict.same) expect(verdict.confirmedBy).toEqual(['email']);
  });

  it('still matches when the incoming form omitted the email', () => {
    const verdict = isSamePatient(ada, { ...ada, email: null });
    expect(verdict.same).toBe(true);
    if (verdict.same) expect(verdict.confirmedBy).toEqual(['phone']);
  });

  it('matches on name and date of birth alone when nothing else is comparable', () => {
    const bare = { firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1985-12-10' };
    const verdict = isSamePatient(bare, bare);
    expect(verdict.same).toBe(true);
    if (verdict.same) expect(verdict.confirmedBy).toEqual([]);
  });

  it('matches a phone written differently on each side', () => {
    const candidate = { ...ada, phone: '07700900123' };
    const incoming = { ...ada, phone: '+44 7700 900123' };
    expect(isSamePatient(candidate, incoming).same).toBe(true);
  });
});

describe('chooseMatch', () => {
  const strong = { id: 'strong', ...ada };
  const weak = { id: 'weak', ...ada, phone: null, email: null };
  const different = { id: 'different', ...ada, phone: '+447700900999' };

  it('returns null when there are no candidates', () => {
    expect(chooseMatch([], ada)).toBeNull();
  });

  it('prefers the candidate confirmed by more identifiers', () => {
    // Order reversed so a naive "first match wins" would pick the weak one.
    const chosen = chooseMatch([weak, strong], ada);
    expect(chosen?.match.id).toBe('strong');
    expect(chosen?.confirmedBy.sort()).toEqual(['email', 'phone']);
  });

  it('skips candidates that contradict, and takes the one that agrees', () => {
    const chosen = chooseMatch([different, strong], ada);
    expect(chosen?.match.id).toBe('strong');
  });

  it('returns null when every candidate contradicts', () => {
    // The correct outcome is a new record: these are two different people who
    // happen to share a name and a birthday.
    expect(chooseMatch([different], ada)).toBeNull();
  });
});
