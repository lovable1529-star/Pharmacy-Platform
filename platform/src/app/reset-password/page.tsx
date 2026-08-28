'use client';

/**
 * Set a new password.
 *
 * Reached two ways, and both land here with a session already established by the
 * auth callback:
 *
 *   · an invited colleague clicking their invitation for the first time
 *   · somebody who asked to reset a forgotten password
 *
 * So this page never asks for the old password — possession of the emailed link
 * is the proof. It does require the new one twice, because a typo here locks
 * somebody out of a system they need for work.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { cn } from '@/lib/cn';

const MIN_LENGTH = 10;

function strength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= MIN_LENGTH) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, label: 'Weak' };
  if (score === 3) return { score, label: 'Reasonable' };
  if (score === 4) return { score, label: 'Strong' };
  return { score, label: 'Very strong' };
}

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!url || !anonKey) { setReady(true); return; }

    const supabase = createBrowserClient(url, anonKey);
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(Boolean(data.user));
      setReady(true);
    });
  }, [url, anonKey]);

  const meter = strength(password);
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_LENGTH && confirm === password && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !anonKey) return;

    setBusy(true);
    setError(null);

    try {
      const supabase = createBrowserClient(url, anonKey);
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(
          updateError.message.toLowerCase().includes('same')
            ? 'That is the password you already have. Choose a different one.'
            : updateError.message,
        );
        setBusy(false);
        return;
      }

      setDone(true);
      // Sign out so the new password is actually used to get back in.
      await supabase.auth.signOut();
      setTimeout(() => {
        window.location.assign(
          '/sign-in?notice=' + encodeURIComponent('Password set. You can sign in now.'),
        );
      }, 1400);
    } catch {
      setError('We could not set that password. Please try the link again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-600 font-display text-[15px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold text-ink">Karsons Pharmacy</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
              Clinical Services
            </div>
          </div>
        </div>

        <div className="rounded-panel border border-line bg-surface p-6 shadow-panel">
          {!ready ? (
            <p className="flex items-center gap-2 py-6 text-[14px] text-ink-faint">
              <Loader2 size={15} className="animate-spin" /> Checking your link…
            </p>
          ) : done ? (
            <>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-safe-100 text-safe-700">
                <Check size={22} strokeWidth={2.4} />
              </div>
              <h1 className="mb-2 text-[19px] text-ink">Password set</h1>
              <p className="text-[14px] text-ink-soft">Taking you to sign in…</p>
            </>
          ) : !hasSession ? (
            <>
              <AlertTriangle size={20} strokeWidth={2} className="mb-3 text-review-700" />
              <h1 className="mb-2 text-[19px] text-ink">This link has expired</h1>
              <p className="mb-4 text-[14px] leading-relaxed text-ink-soft">
                Reset links work once and expire quickly. Request a new one and open it in this
                browser.
              </p>
              <a
                href="/forgot-password"
                className="inline-block rounded-control bg-brand-600 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Request a new link
              </a>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1 className="mb-1.5 text-[19px] text-ink">Choose a password</h1>
              <p className="mb-5 text-[13.5px] text-ink-soft">
                At least {MIN_LENGTH} characters. A short phrase you will remember beats a short
                jumble you will not.
              </p>

              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mb-2 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              {password.length > 0 ? (
                <div className="mb-4 flex items-center gap-2.5">
                  <div className="flex h-1 flex-1 gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-full flex-1 rounded-full transition-colors',
                          i < meter.score
                            ? meter.score <= 2
                              ? 'bg-stop-600'
                              : meter.score === 3
                                ? 'bg-review-600'
                                : 'bg-safe-600'
                            : 'bg-line',
                        )}
                      />
                    ))}
                  </div>
                  <span className="w-[84px] shrink-0 text-right font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
                    {meter.label}
                  </span>
                </div>
              ) : null}

              <label htmlFor="confirm" className="mb-1.5 block text-[13px] font-medium text-ink">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mb-3 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              {tooShort ? (
                <p className="mb-3 text-[13px] text-review-700">
                  A few more characters — {MIN_LENGTH} is the minimum.
                </p>
              ) : null}
              {mismatch ? (
                <p className="mb-3 text-[13px] text-stop-700">Those two do not match.</p>
              ) : null}
              {error ? (
                <div
                  role="alert"
                  className="mb-3 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3 py-2.5 text-[13px] text-stop-700"
                >
                  <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-control px-4 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
                  canSubmit ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-ink-faint',
                )}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                Set password
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 flex items-start gap-1.5 px-1 text-[12.5px] leading-snug text-ink-faint">
          <ShieldCheck size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
          Nobody at the pharmacy can see your password, including administrators.
        </p>
      </div>
    </div>
  );
}
