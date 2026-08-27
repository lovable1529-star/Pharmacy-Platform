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
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-600 font-display text-[15px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold text-ink">Karsons Pharmacy</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
              Clinical Services
            </div>
          </div>
        </div>

        <div className="rounded-[12px] border border-line bg-surface p-6 shadow-panel">
          <form onSubmit={submit}>
            <h1 className="mb-1.5 text-[19px] text-ink">Sign in</h1>
            <p className="mb-5 text-[13.5px] text-ink-soft">
              Staff accounts only. Ask an administrator if you need access.
            </p>

            {notice ? (
              <div className="mb-4 rounded-[7px] border border-safe-200 bg-safe-50 px-3 py-2.5 text-[13px] text-safe-700">
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
              className="mb-4 w-full rounded-[7px] border border-line bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
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
              className="mb-4 w-full rounded-[7px] border border-line bg-surface px-3 py-2.5 text-[15px] text-ink focus:border-brand-400 focus:outline-none"
            />

            {error ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-[7px] border border-stop-200 bg-stop-50 px-3 py-2.5 text-[13px] leading-snug text-stop-700"
              >
                <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-[7px] bg-brand-600 px-4 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
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
