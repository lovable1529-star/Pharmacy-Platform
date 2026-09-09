'use client';

/**
 * When a staff screen throws.
 *
 * Placed inside the (staff) group deliberately, so it renders WITHIN the shell:
 * the navigation, the branch switcher and the sign-out button all survive, and
 * somebody who hits this can go somewhere else instead of reaching for the back
 * button. A boundary at the root would have replaced the whole application with
 * a blank page.
 *
 * The reference is the point of the small print. A tester writing "it crashed"
 * gives us nothing to search for; a tester writing the digest gives us the exact
 * server log line. Next.js generates it precisely so the real message can stay
 * out of the browser, so it is shown rather than hidden.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, TriangleAlert, Lock, ArrowLeft } from 'lucide-react';
import { describeAppError } from '@/lib/errors/describe';

export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Next.js only logs this on the server for server-component errors. One
  // thrown in the browser would otherwise leave no trace at all.
  useEffect(() => {
    console.error('[staff] screen failed:', error);
  }, [error]);

  const described = describeAppError(error.message);

  return (
    <div className="page-shell mx-auto max-w-[620px] animate-rise px-7 pb-11 pt-16">
      <div className="rounded-panel border border-line bg-surface p-7 shadow-panel">
        <div
          className={
            described.denied
              ? 'mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700'
              : 'mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-stop-50 text-stop-700'
          }
        >
          {described.denied
            ? <Lock size={19} strokeWidth={1.9} />
            : <TriangleAlert size={19} strokeWidth={1.9} />}
        </div>

        <h1 className="mb-2 text-[21px] leading-tight text-ink">{described.title}</h1>
        <p className="text-[14px] leading-relaxed text-ink-soft">{described.body}</p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          {described.retryable ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <RefreshCw size={14} strokeWidth={2.2} />
              Try again
            </button>
          ) : null}

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-control border border-line px-4 py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:border-brand-200 hover:text-brand-700"
          >
            <ArrowLeft size={14} strokeWidth={2.2} />
            Back to Today
          </Link>
        </div>

        {/*
          Shown, not buried. This is the only thing that connects what somebody
          saw on screen to the line in the server log that explains it.
        */}
        {error.digest ? (
          <div className="mt-6 border-t border-line-soft pt-4">
            <p className="text-[12.5px] leading-[1.5] text-ink-faint">
              Quote this reference if you report it:{' '}
              <span className="font-mono text-[12px] text-ink-soft">{error.digest}</span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
