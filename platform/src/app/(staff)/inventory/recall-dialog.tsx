'use client';

/**
 * Recall impact.
 *
 * The client never asked for this. He asked whether he could log quantities and
 * have them decrement — but the moment a batch is recalled, "how many are left"
 * is the least urgent of the three questions, and the one nobody thinks of until
 * it is too late is which patients have no way of being contacted.
 */

import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, PhoneOff, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Portal } from '@/components/ui/portal';
import { formatDate } from '@/lib/units';
import { getRecallImpact, recallBatch, type RecallImpact } from './actions';

export function RecallDialog({
  batchId, branchId, companyId, onClose,
}: {
  batchId: string;
  branchId: string;
  companyId: string;
  onClose: (recalled: boolean) => void;
}) {
  const [impact, setImpact] = useState<RecallImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    getRecallImpact(batchId).then((result) => {
      if (!live) return;
      setImpact(result);
      setLoading(false);
    });
    return () => { live = false; };
  }, [batchId]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await recallBatch({ batchId, reason, branchId, companyId });
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(result.error);
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-ink/30" onClick={() => onClose(done)} aria-hidden="true" />

      <div
        role="dialog"
        aria-label="Recall batch"
        className="relative flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-panel bg-surface shadow-pop"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <AlertTriangle size={18} strokeWidth={2.1} className="mt-0.5 shrink-0 text-stop-700" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[17px] font-semibold text-ink">Recall this batch</h2>
            {impact ? (
              <p className="truncate text-[12.5px] text-ink-faint">
                {impact.productName} · batch {impact.batchNumber}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onClose(done)}
            aria-label="Close"
            className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-[14px] text-ink-faint">
              <Loader2 size={15} className="animate-spin" /> Working out the impact…
            </p>
          ) : !impact ? (
            <p className="py-8 text-[14px] text-stop-700">Could not load the impact.</p>
          ) : done ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-safe-100 text-safe-700">
                <Check size={22} strokeWidth={2.4} />
              </div>
              <p className="text-[15px] font-medium text-ink">Batch recalled</p>
              <p className="mt-1 text-[13.5px] text-ink-soft">
                Remaining stock has been quarantined and the consultation screen will refuse it.
              </p>
              {impact.patientsAffected > 0 ? (
                <p className="mt-3 text-[13.5px] text-review-700">
                  {impact.patientsAffected} patient{impact.patientsAffected === 1 ? '' : 's'} still
                  need contacting.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Figure label="Patients given it" value={impact.patientsAffected}
                  tone={impact.patientsAffected > 0 ? 'stop' : undefined} />
                <Figure label="Still on shelves" value={impact.totalRemaining} />
                <Figure label="No contact details" value={impact.patientsWithoutContact}
                  tone={impact.patientsWithoutContact > 0 ? 'review' : undefined} />
              </div>

              {impact.patientsWithoutContact > 0 ? (
                <div className="mb-4 flex items-start gap-2.5 rounded-control border border-review-200 bg-review-50 px-3.5 py-3">
                  <PhoneOff size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-review-700" />
                  <p className="text-[13px] leading-snug text-review-700">
                    {impact.patientsWithoutContact} of these patients have no phone number or email
                    on file. They cannot be reached electronically and will need chasing another
                    way.
                  </p>
                </div>
              ) : null}

              {impact.remainingByBranch.length > 0 ? (
                <div className="mb-4">
                  <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                    Where the remaining stock is
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {impact.remainingByBranch.map((b) => (
                      <li key={b.branchName} className="flex justify-between text-[13.5px]">
                        <span className="text-ink-soft">{b.branchName}</span>
                        <span className="tabular font-mono text-ink">{b.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {impact.recipients.length > 0 ? (
                <div className="mb-4">
                  <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                    Who received it
                  </h3>
                  <ul className="flex max-h-[180px] flex-col gap-1 overflow-y-auto">
                    {impact.recipients.map((r) => (
                      <li key={r.patientId} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate text-ink">{r.name}</span>
                        <span
                          className={cn(
                            'shrink-0 font-mono text-[11.5px]',
                            r.phone || r.email ? 'text-ink-faint' : 'text-review-700',
                          )}
                        >
                          {r.phone ?? r.email ?? 'no contact details'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <label htmlFor="reason" className="mb-1.5 block text-[13px] font-medium text-ink">
                Why is this being recalled?
              </label>
              <textarea
                id="reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. MHRA recall notice, cold chain failure"
                className="w-full resize-y rounded-control border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              {error ? (
                <p role="alert" className="mt-2 text-[13px] text-stop-700">{error}</p>
              ) : null}
            </>
          )}
        </div>

        {!done && !loading && impact ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3.5">
            <p className="text-[12px] text-ink-faint">
              Nothing is deleted — the batch stays, flagged.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || !reason.trim()}
                className={cn(
                  'flex items-center gap-1.5 rounded-control px-4 py-2 text-[13.5px] font-semibold text-white transition-colors',
                  busy || !reason.trim() ? 'cursor-not-allowed bg-ink-faint' : 'bg-stop-700 hover:brightness-110',
                )}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Recall batch
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
    </Portal>
  );
}

function Figure({
  label, value, tone,
}: { label: string; value: number; tone?: 'stop' | 'review' }) {
  return (
    <div className="rounded-control border border-line bg-sunk px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-faint">{label}</div>
      <div
        className={cn(
          'tabular mt-0.5 font-display text-[22px] font-semibold',
          tone === 'stop' ? 'text-stop-700' : tone === 'review' ? 'text-review-700' : 'text-ink',
        )}
      >
        {value}
      </div>
    </div>
  );
}
