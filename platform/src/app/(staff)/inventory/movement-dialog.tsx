'use client';

/**
 * Move stock — §9.2.
 *
 * The quantity field is always positive. Direction belongs to the kind, so a
 * pharmacist recording two damaged vials types 2, not -2, and cannot
 * accidentally add them to the shelf. The one exception is a count adjustment,
 * where the sign IS the correction and the field says so.
 *
 * The resulting figure is shown live, before anything is saved, because "what
 * will this leave me with" is the question actually being asked and working it
 * out afterwards is how a mistake gets committed first and noticed second.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { X, Boxes, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  MOVEMENT_KINDS, MOVEMENT_LABELS, checkMovement, isWriteOff, movementDelta,
  type MovementKind,
} from '@/lib/inventory/movements';
import { recordMovement } from './movement-actions';

const control =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-300 focus:shadow-[0_0_0_3px_var(--color-brand-50)]';

/** Grouped so the common ones are not buried among the rare ones. */
const GROUPS: { label: string; kinds: MovementKind[] }[] = [
  { label: 'In', kinds: ['RECEIPT', 'RETURN_IN', 'TRANSFER_IN'] },
  { label: 'Out', kinds: ['ADMINISTRATION', 'TRANSFER_OUT', 'RETURN_OUT'] },
  { label: 'Write-off', kinds: ['EXPIRED', 'DAMAGED', 'WASTE'] },
  { label: 'Correction', kinds: ['ADJUSTMENT'] },
];

export function MovementDialog({
  batchId,
  branchId,
  companyId,
  productName,
  batchNumber,
  currentQuantity,
  recalled,
  onClose,
}: {
  batchId: string;
  branchId: string;
  companyId: string | null;
  productName: string;
  batchNumber: string;
  currentQuantity: number;
  recalled: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<MovementKind>('RECEIPT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const amount = Number.parseInt(quantity, 10);
  const valid = Number.isFinite(amount) && amount !== 0;
  const preview = valid ? checkMovement(kind, amount, currentQuantity) : null;
  const adding = valid && movementDelta(kind, amount) > 0;

  // A recalled batch may still go out — it has to, or recalled stock could
  // never be written off — but nothing may be added back to it.
  const blockedByRecall = recalled && adding;

  const ready = valid && preview?.ok === true && !blockedByRecall && !busy;

  async function submit() {
    setBusy(true);
    setError(null);

    const result = await recordMovement({
      batchId, branchId, companyId, kind,
      quantity: amount,
      reason: reason || null,
      reference: reference || null,
    });

    setBusy(false);
    if (!result.ok) { setError(result.error); return; }

    onClose();
    router.refresh();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move stock"
        className="max-h-[90dvh] w-full max-w-[460px] overflow-y-auto rounded-t-panel border border-line bg-surface p-5 shadow-lift sm:rounded-panel"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">Move stock</h2>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              {productName} · {batchNumber}
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="shrink-0 rounded-control p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {recalled ? (
          <p className="mb-4 rounded-control border border-stop-200 bg-stop-50 px-3 py-2 text-[13px] text-stop-700">
            This batch is recalled. You can write it off or return it, but nothing
            can be added back to it.
          </p>
        ) : null}

        <div className="grid gap-4">
          <div>
            <label htmlFor="kind" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
              What happened
            </label>
            <select
              id="kind" className={control} value={kind}
              onChange={(e) => setKind(e.target.value as MovementKind)}
            >
              {GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.kinds.map((k) => (
                    <option key={k} value={k}>{MOVEMENT_LABELS[k]}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {isWriteOff(kind) ? (
              <p className="mt-1.5 text-[12px] text-ink-faint">
                Reported as loss, separately from stock given to patients.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="quantity" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
              {kind === 'ADJUSTMENT' ? 'Correction (+ or −)' : 'How many'}
            </label>
            <input
              id="quantity"
              type="number"
              inputMode="numeric"
              className={control}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={kind === 'ADJUSTMENT' ? 'e.g. -2' : 'e.g. 20'}
            />
            {kind !== 'ADJUSTMENT' ? (
              <p className="mt-1.5 text-[12px] text-ink-faint">
                Always a positive number — “{MOVEMENT_LABELS[kind]}” already knows
                which way it goes.
              </p>
            ) : null}
          </div>

          {/* What this will leave, before it is saved. */}
          {valid && preview ? (
            <div
              className={cn(
                'flex items-center gap-2.5 rounded-control border px-3 py-2.5',
                preview.ok && !blockedByRecall
                  ? 'border-line bg-sunk'
                  : 'border-stop-200 bg-stop-50',
              )}
            >
              <span className="tabular font-mono text-[15px] text-ink-faint">{currentQuantity}</span>
              <ArrowRight size={14} strokeWidth={2.2} className="text-ink-faint" />
              <span
                className={cn(
                  'tabular font-mono text-[17px] font-semibold',
                  preview.ok && !blockedByRecall ? 'text-ink' : 'text-stop-700',
                )}
              >
                {preview.resulting}
              </span>
              <span className="ml-auto text-[12.5px] text-ink-faint">after this</span>
            </div>
          ) : null}

          <div>
            <label htmlFor="reason" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
              Reason
            </label>
            <input
              id="reason" className={control} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isWriteOff(kind) ? 'What happened to it?' : 'Optional'}
            />
          </div>

          <div>
            <label htmlFor="reference" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
              Reference
            </label>
            <input
              id="reference" className={control} value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Delivery note, invoice, transfer number"
            />
          </div>
        </div>

        {blockedByRecall ? (
          <p className="mt-4 text-[13px] text-stop-700">
            Stock cannot be added to a recalled batch.
          </p>
        ) : null}

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3 py-2.5">
            <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-stop-600" />
            <p className="text-[13px] text-stop-700">{error}</p>
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button" disabled={!ready} onClick={submit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-brand-600 px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Boxes size={14} strokeWidth={2.2} />
            {busy ? 'Saving…' : 'Record movement'}
          </button>
          <button
            type="button" onClick={onClose}
            className="rounded-control border border-line px-3.5 py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
