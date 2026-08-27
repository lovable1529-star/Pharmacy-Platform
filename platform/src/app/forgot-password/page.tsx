'use client';

/**
 * Forgot password.
 *
 * Always reports success, whether or not the address exists. Saying "no account
 * with that email" turns this form into a way of discovering which staff
 * addresses are real, which is worth more to an attacker than it is convenient
 * to a colleague who mistyped.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && anonKey) {
      try {
        const supabase = createBrowserClient(url, anonKey);
        await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
      } catch {
        // Deliberately swallowed — see the note above.
      }
    }

    setBusy(false);
    setSent(true);
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
          {sent ? (
            <>
              <Mail size={22} strokeWidth={1.8} className="mb-3 text-brand-600" />
              <h1 className="mb-2 text-[19px] text-ink">Check your email</h1>
              <p className="text-[14px] leading-relaxed text-ink-soft">
                If <strong className="text-ink">{email}</strong> belongs to a staff account, we have
                sent a link to reset the password. It expires shortly and works once.
              </p>
              <Link
                href="/sign-in"
                className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-700"
              >
                <ArrowLeft size={14} strokeWidth={2} />
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1 className="mb-1.5 text-[19px] text-ink">Reset your password</h1>
              <p className="mb-5 text-[13.5px] text-ink-soft">
                Enter your work email and we will send you a link.
              </p>

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

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-[7px] bg-brand-600 px-4 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                Send reset link
              </button>

              <Link
                href="/sign-in"
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
              >
                <ArrowLeft size={13} strokeWidth={2} />
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
