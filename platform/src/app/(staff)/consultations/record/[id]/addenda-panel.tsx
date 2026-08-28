'use client';

/**
 * Corrections attached to a closed consultation.
 *
 * Shown above the record rather than below it. If a batch number was wrong, the
 * person reading this needs to know before they read the wrong number, not
 * after — the whole point of an addendum is that it travels with the original.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import { addAddendum } from './addendum-actions';

export interface AddendumRow {
  id: string;
  reason: string;
  corrections: Record<string, unknown>;
  occurredAt: Date;
  authorName: string | null;
}

/** The fields it is meaningful to correct after the fact. */
const CORRECTABLE = [
  { key: 'batchNumber', label: 'Batch number' },
  { key: 'productName', label: 'Product given' },
  { key: 'siteOfAdministration', label: 'Site of administration' },
  { key: 'injectionType', label: 'Type of injection' },
  { key: 'clinicianName', label: 'Pharmacist' },
  { key: 'fundedBy', label: 'Funded by' },
] as const;

function stamp(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(date));
}

const input =
  'w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand-400';

export function AddendaPanel({
  consultationId,
  addenda,
}: {
  consultationId: string;
  addenda: AddendumRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await addAddendum({ consultationId, reason, corrections });
    setBusy(false);

    if (!result.ok) setError(result.error ?? 'Could not save that correction.');
    else {
      setReason('');
      setCorrections({});
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <section className="mb-5">
      {addenda.length > 0 ? (
        <div className="mb-3 overflow-hidden rounded-[10px] border border-review-200 bg-review-50">
          <div className="border-b border-review-200 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-review-700">
            {addenda.length} correction{addenda.length === 1 ? '' : 's'} on this record
          </div>
          <ul className="m-0 list-none p-0">
            {addenda.map((a) => (
              <li key={a.id} className="border-b border-review-200/60 px-4 py-3 last:border-b-0">
                <p className="m-0 text-[14px] text-ink">{a.reason}</p>

                {Object.keys(a.corrections).length > 0 ? (
                  <dl className="mt-1.5 flex flex-col gap-0.5">
                    {Object.entries(a.corrections).map(([key, value]) => {
                      const field = CORRECTABLE.find((c) => c.key === key);
                      return (
                        <div key={key} className="flex flex-wrap gap-x-2 text-[13px]">
                          <dt className="font-medium text-review-700">
                            {field?.label ?? key}
                          </dt>
                          <dd className="m-0 text-ink-soft">should read: {String(value)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : null}

                <p className="mt-1 font-mono text-[11px] text-ink-faint">
                  {a.authorName ?? 'Unknown user'} · {stamp(a.occurredAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      {open ? (
        <div className="rounded-[10px] border border-line bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold text-ink">
              Add a correction
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-faint hover:bg-sunk hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>

          <p className="mb-3 text-[13px] text-ink-faint">
            The original record stays exactly as it is. Your correction is added
            beside it, so both are visible to anyone reading this afterwards.
          </p>

          <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="ad-reason">
            What was wrong?
          </label>
          <textarea
            id="ad-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={input}
            placeholder="Batch number was taken from the wrong box — the dose given was from 3051270."
          />

          <p className="mb-2 mt-4 text-[13px] font-medium text-ink-soft">
            Corrected values <span className="font-normal text-ink-faint">(optional)</span>
          </p>
          <div className="flex flex-col gap-2.5">
            {CORRECTABLE.map((field) => (
              <div key={field.key} className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor={`ad-${field.key}`}
                  className="min-w-[150px] text-[13px] text-ink-soft"
                >
                  {field.label}
                </label>
                <input
                  id={`ad-${field.key}`}
                  value={corrections[field.key] ?? ''}
                  onChange={(e) =>
                    setCorrections((c) => ({ ...c, [field.key]: e.target.value }))
                  }
                  className={cn(input, 'flex-1')}
                  placeholder="Leave blank if unchanged"
                />
              </div>
            ))}
          </div>

          <p className="mt-3 text-[12.5px] text-ink-faint">
            Correcting a batch does not move the stock movement — the dose left
            the fridge either way. Adjust stock separately in Inventory.
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[7px] border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={submit}
              className={cn(
                'flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700',
                (busy || !reason.trim()) && 'cursor-not-allowed opacity-40 hover:bg-brand-600',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Save correction
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
        >
          <FilePlus2 size={13} strokeWidth={2.2} />
          Add a correction
        </button>
      )}
    </section>
  );
}
