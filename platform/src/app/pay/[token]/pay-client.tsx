'use client';

/**
 * The pay button.
 *
 * In demonstration mode this deliberately collects nothing. No card number, no
 * expiry, no CVC, not even a placeholder for them. The banner says what the
 * screen is, and the button says what it does.
 *
 * That is a design decision, not a shortcut. A convincing imitation of a card
 * form would be a page that functions as the real thing if it ever left this
 * demo, and it would train staff to trust a screen that is lying to them. When
 * Stripe keys are added, this is replaced by their hosted checkout — which
 * takes card details on their infrastructure, under their compliance, and never
 * on ours.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { payDemo } from './actions';

export function PayClient({
  paymentId,
  token,
  demo,
}: {
  paymentId: string;
  token: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    const result = await payDemo(token);
    setBusy(false);

    if (!result.ok) setError(result.error ?? 'Something went wrong.');
    else router.refresh();
  }

  if (!demo) {
    // Stripe is configured. Checkout is theirs to render — card details belong
    // on their infrastructure, never on ours.
    return (
      <div className="rounded-[9px] border border-line bg-sunk px-4 py-5 text-center">
        <CreditCard size={20} strokeWidth={1.8} className="mx-auto mb-2 text-ink-faint" />
        <p className="text-[14px] font-medium text-ink">Card payment</p>
        <p className="mt-1 text-[13px] text-ink-faint">
          Secure checkout opens in a moment. If it does not, call the pharmacy and
          we will take payment over the phone.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-start gap-2.5 rounded-[9px] border border-review-200 bg-review-50 px-4 py-3">
        <Info size={15} strokeWidth={2.2} className="mt-0.5 shrink-0 text-review-700" />
        <div>
          <p className="m-0 text-[13.5px] font-semibold text-review-700">
            Demonstration mode
          </p>
          <p className="m-0 mt-0.5 text-[13px] text-ink-soft">
            No card details are collected and no money is taken. This button
            records the invoice as paid so the rest of the workflow can be shown.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-3 rounded-control border border-stop-200 bg-stop-50 px-3 py-2 text-[13.5px] text-stop-700">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={pay}
        disabled={busy}
        aria-describedby={`pay-note-${paymentId}`}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-control bg-brand-600 px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-700',
          busy && 'cursor-not-allowed opacity-60 hover:bg-brand-600',
        )}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        Mark as paid (demonstration)
      </button>

      <p id={`pay-note-${paymentId}`} className="mt-2 text-center text-[12px] text-ink-faint">
        Replaced by real card checkout once payment keys are added.
      </p>
    </>
  );
}
