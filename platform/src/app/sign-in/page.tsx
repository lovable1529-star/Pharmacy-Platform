'use client';

/**
 * Staff sign-in.
 *
 * Email and password. There is no public sign-up anywhere in this application —
 * accounts are created by an administrator and the account holder sets their own
 * password from the invitation link. A pharmacy system holding special-category
 * health data should never have a door that anybody can walk through.
 *
 * Errors report what actually went wrong, but deliberately do not distinguish
 * "no such account" from "wrong password" — that difference tells an attacker
 * which addresses are real.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * This is the only screen most people see before they trust the product with a
 * patient list, so it gets the one piece of real staging in the whole
 * application: two soft brand blooms behind the card, and the card itself
 * rising into place. Nothing moves after that first half-second.
 *
 * Every input now shows a focus RING rather than only a border colour change.
 * On a login form specifically, "which box am I typing in" has to survive being
 * glanced at rather than looked at.
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, AlertTriangle, Lock } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

function friendlyError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'That email and password do not match. Check both and try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'This account has not been activated yet. Use the link in your invitation email.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (lower.includes('no staff account')) return message;
  return message;
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();

  const notice = params.get('notice');
  const linkError = params.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? friendlyError(decodeURIComponent(linkError)) : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      setError('Supabase is not configured — check NEXT_PUBLIC_SUPABASE_URL and the anon key.');
      setBusy(false);
      return;
    }

    try {
      const supabase = createBrowserClient(url, anonKey);
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(friendlyError(authError.message));
        setBusy(false);
        return;
      }

      // Full navigation rather than a client push, so the middleware runs and
      // the session cookie is present on the very first request.
      window.location.assign('/');
    } catch {
      setError('We could not reach the sign-in service. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-5">
      {/* Two blooms, off opposite corners. Purely atmospheric — pointer-events
          are off so they can never sit between a cursor and the form. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(760px_420px_at_18%_8%,var(--color-brand-100)_0%,transparent_62%),radial-gradient(680px_380px_at_88%_94%,var(--color-brand-50)_0%,transparent_60%)]"
      />

      <div className="relative w-full max-w-[412px] animate-rise">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] bg-gradient-to-br from-brand-500 to-brand-700 font-display text-[16px] font-bold text-white shadow-[0_6px_18px_-8px_rgba(91,58,142,0.8)]">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold text-ink">Karsons Pharmacy</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
              Clinical Services
            </div>
          </div>
        </div>

        <div className="rounded-[14px] border border-line bg-surface p-[26px] shadow-panel">
          <form onSubmit={submit}>
            <h1 className="mb-1.5 text-[20px] text-ink">Sign in</h1>
            <p className="mb-5 text-[13.5px] text-ink-soft">
              Staff accounts only. Ask an administrator if you need access.
            </p>

            {notice ? (
              <div className="mb-4 rounded-control border border-safe-200 bg-safe-50 px-3 py-2.5 text-[13px] text-safe-700">
                {decodeURIComponent(notice)}
              </div>
            ) : null}

            <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@karsonspharmacy.co.uk"
              className="mb-4 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
            />

            <div className="mb-1.5 flex items-baseline justify-between">
              <label htmlFor="password" className="text-[13px] font-medium text-ink">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-[12.5px] text-brand-700 transition-colors hover:text-brand-800"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-5 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
            />

            {error ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3 py-2.5 text-[13px] leading-snug text-stop-700"
              >
                <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-control bg-gradient-to-br from-brand-500 to-brand-700 px-4 py-3 text-[14.5px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(91,58,142,0.9)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_12px_26px_-10px_rgba(91,58,142,0.95)] disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              Sign in
            </button>
          </form>
        </div>

        <p className="mt-4 flex items-start gap-1.5 px-1 text-[12.5px] leading-snug text-ink-faint">
          <Lock size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
          There is no public sign-up. Accounts are created by an administrator and invited by email.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
