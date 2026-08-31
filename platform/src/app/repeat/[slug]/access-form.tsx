'use client';

/**
 * Two fields and a button.
 *
 * A patient reaching this is usually on a phone, often standing up, and has
 * done it before. So: no account, no password, large targets, and the ID field
 * accepts whatever case and spacing is printed on their paperwork.
 *
 * The failure message deliberately does not say which field was wrong, and it
 * ends with the thing they can actually do about it — start as a new patient.
 * "Details not recognised" on its own leaves a patient stuck.
 */

import { useState } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { startRepeatRequest } from './actions';

export function RepeatAccessForm({
  slug,
  serviceName,
}: {
  slug: string;
  serviceName: string;
}) {
  const [repeatCareId, setRepeatCareId] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = repeatCareId.trim().length > 0 && email.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);

    const result = await startRepeatRequest(slug, repeatCareId, email);

    if (!result.ok || !result.formUrl) {
      setError(result.error ?? 'Something went wrong.');
      setBusy(false);
      return;
    }

    // A full navigation, not a client push: the questionnaire is a different
    // part of the app and should start with a clean slate.
    window.location.href = result.formUrl;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center px-6 py-12">
      <div className="rounded-panel border border-line bg-surface px-6 py-7 shadow-panel">
        <p className="mb-1.5 font-mono text-[11.5px] uppercase tracking-[0.12em] text-brand-600">
          Repeat care
        </p>
        <h1 className="mb-2 text-[24px] font-semibold leading-tight text-ink">
          {serviceName}
        </h1>
        <p className="mb-6 text-[14.5px] text-ink-soft">
          Enter the Repeat Care ID from your paperwork and the email address we hold
          for you. There is no password.
        </p>

        <form onSubmit={submit} className="grid gap-4">
          <div>
            <label
              htmlFor="repeat-id"
              className="mb-1.5 block text-[13px] font-medium text-ink-soft"
            >
              Repeat Care ID
            </label>
            <input
              id="repeat-id"
              value={repeatCareId}
              onChange={(e) => setRepeatCareId(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="e.g. RC-4H7K-M2PQ"
              className="w-full rounded-control border border-line bg-canvas px-3.5 py-3 text-[15px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-300 focus:shadow-[0_0_0_3px_var(--color-brand-50)]"
            />
          </div>

          <div>
            <label
              htmlFor="repeat-email"
              className="mb-1.5 block text-[13px] font-medium text-ink-soft"
            >
              Email address
            </label>
            <input
              id="repeat-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              className="w-full rounded-control border border-line bg-canvas px-3.5 py-3 text-[15px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-300 focus:shadow-[0_0_0_3px_var(--color-brand-50)]"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3.5 py-3"
            >
              <AlertCircle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-stop-600" />
              <div className="text-[13.5px] text-stop-700">
                <p>{error}</p>
                <a
                  href="/book"
                  className="mt-1.5 inline-block font-medium underline underline-offset-2"
                >
                  Book an appointment instead
                </a>
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!ready || busy}
            className="mt-1 flex items-center justify-center gap-2 rounded-control bg-brand-600 px-4 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? 'Checking…' : 'Continue'}
            {busy ? null : <ArrowRight size={16} strokeWidth={2.2} />}
          </button>
        </form>

        {/*
          Points at the door they actually need. This offered to book an
          appointment, which is now wrong twice over: the service is remote,
          and somebody without an enrolment needs the new-patient form rather
          than a booking.
        */}
        <p className="mt-5 border-t border-line-soft pt-4 text-[13px] text-ink-faint">
          Not on repeat care yet?{' '}
          <a
            href="/f/weight-management-first"
            className="font-medium text-brand-600 underline underline-offset-2"
          >
            Start with the new patient form
          </a>{' '}
          and a pharmacist will be in touch.
        </p>
      </div>
    </main>
  );
}
