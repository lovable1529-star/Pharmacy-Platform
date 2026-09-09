import { describe, it, expect } from 'vitest';
import { describeAppError } from '../src/lib/errors/describe';

describe('describeAppError', () => {
  it('treats a permission boundary as a locked door, not a fault', () => {
    const d = describeAppError('NOT_AUTHORISED');
    expect(d.denied).toBe(true);
    expect(d.retryable).toBe(false);
    expect(d.title.toLowerCase()).toContain('access');
  });

  it('does not offer "try again" for anything retrying cannot fix', () => {
    for (const raw of ['NOT_AUTHORISED', 'You are not signed in.']) {
      expect(describeAppError(raw).retryable, raw).toBe(false);
    }
  });

  it('recognises the Seoul connection failures as worth retrying', () => {
    for (const raw of [
      'connect ETIMEDOUT 13.125.0.1:5432',
      'ECONNREFUSED',
      'Connection terminated unexpectedly',
      'Query read timeout',
    ]) {
      const d = describeAppError(raw);
      expect(d.retryable, raw).toBe(true);
      expect(d.denied, raw).toBe(false);
    }
  });

  /*
   * In production Next.js replaces a server-component error's message with a
   * generic string and passes the digest separately, so most real failures
   * arrive here unrecognisable. The fallback has to stand on its own.
   */
  it('gives something actionable for an error it cannot identify', () => {
    for (const raw of ['', null, undefined, 'kaboom', 'TypeError: x is not a function']) {
      const d = describeAppError(raw);
      expect(d.title.length, String(raw)).toBeGreaterThan(0);
      expect(d.body.length, String(raw)).toBeGreaterThan(20);
      expect(d.retryable, String(raw)).toBe(true);
      expect(d.denied, String(raw)).toBe(false);
    }
  });

  // These are read by a pharmacist mid-shift, not by whoever wrote the code.
  it('never shows a stack trace, a table name or a framework word', () => {
    const samples = [
      describeAppError('NOT_AUTHORISED'),
      describeAppError('ECONNREFUSED'),
      describeAppError('kaboom'),
      describeAppError('You are not signed in.'),
    ];

    for (const d of samples) {
      const text = `${d.title} ${d.body}`.toLowerCase();
      for (const leak of [
        'next.js', 'react', 'supabase', 'drizzle', 'postgres', 'undefined',
        'null', 'stack', 'exception', 'econnrefused',
      ]) {
        expect(text, `${leak} in "${text}"`).not.toContain(leak);
      }
    }
  });

  it('tells somebody signed out to sign in rather than to report a bug', () => {
    const d = describeAppError('You are not signed in.');
    expect(d.denied).toBe(true);
    expect(d.body.toLowerCase()).toContain('sign in');
  });
});
