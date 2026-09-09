import { describe, it, expect } from 'vitest';
import { invitationPending } from '../src/lib/users/invitation-state';

const SOMETIME = new Date('2026-09-01T09:00:00Z');

describe('invitationPending', () => {
  it('flags an account that exists but has never been signed into', () => {
    expect(invitationPending({ known: true, lastSignInAt: null, disabledAt: null })).toBe(true);
  });

  it('says nothing about an account that has been used', () => {
    expect(invitationPending({ known: true, lastSignInAt: SOMETIME, disabledAt: null })).toBe(false);
  });

  /*
   * The one that matters. An auth lookup that fails must not read as "nobody
   * has ever signed in" — that would badge every colleague in the pharmacy at
   * once and invite an administrator to re-send a dozen password links.
   */
  it('stays silent when the sign-in state could not be read', () => {
    expect(invitationPending({ known: false, lastSignInAt: null, disabledAt: null })).toBe(false);
  });

  it('does not chase a disabled account, signed in or not', () => {
    expect(invitationPending({ known: true, lastSignInAt: null, disabledAt: SOMETIME })).toBe(false);
    expect(invitationPending({ known: true, lastSignInAt: SOMETIME, disabledAt: SOMETIME })).toBe(false);
  });

  it('treats unknown as unknown even when other fields look conclusive', () => {
    expect(invitationPending({ known: false, lastSignInAt: SOMETIME, disabledAt: null })).toBe(false);
  });
});
