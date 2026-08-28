/**
 * Where the deployment thinks it lives.
 *
 * Worth testing because the failure is silent. Every patient-facing link is
 * built from this — booking confirmations, questionnaire links, payment links,
 * staff invitations — and a wrong answer does not throw, it just sends people
 * somewhere they cannot reach. That is precisely what happened in production:
 * NEXT_PUBLIC_APP_URL was not set on Vercel and eight call sites each fell back
 * to localhost, so the deployed site handed real patients a link to a machine
 * that was not theirs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAppUrl } from '../src/lib/app-url';

const KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveAppUrl', () => {
  it('prefers an explicit URL over everything else', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://booking.karsonspharmacy.co.uk';
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'karsons.vercel.app';

    // A custom domain can only ever come from the explicit variable, so it has
    // to win even when Vercel is also offering an answer.
    expect(resolveAppUrl()).toBe('https://booking.karsonspharmacy.co.uk');
  });

  it('strips a trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://karsons.vercel.app/';
    // Otherwise every generated link becomes https://host//f/flu-vaccination.
    expect(resolveAppUrl()).toBe('https://karsons.vercel.app');
  });

  it('ignores an empty or whitespace-only value', () => {
    // An environment variable added in the dashboard but left blank is a very
    // easy mistake, and it must not beat the Vercel fallback.
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'karsons.vercel.app';

    expect(resolveAppUrl()).toBe('https://karsons.vercel.app');
  });

  it('uses the stable production domain in production', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'karsons.vercel.app';
    // The per-deployment URL also exists in production and is the wrong choice:
    // it changes on every deploy, so any link that outlives one would break.
    process.env.VERCEL_URL = 'karsons-a1b2c3.vercel.app';

    expect(resolveAppUrl()).toBe('https://karsons.vercel.app');
  });

  it('keeps a preview deployment inside itself', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'karsons-git-branch-x.vercel.app';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'karsons.vercel.app';

    // A link generated while testing a branch should lead back to that branch,
    // not to live production.
    expect(resolveAppUrl()).toBe('https://karsons-git-branch-x.vercel.app');
  });

  it('adds the protocol Vercel omits', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'karsons.vercel.app';

    expect(resolveAppUrl()).toMatch(/^https:\/\//);
  });

  it('falls back to localhost only when nothing else is available', () => {
    // Development, where localhost is the true answer rather than a mistake.
    expect(resolveAppUrl()).toBe('http://localhost:3100');
  });
});
