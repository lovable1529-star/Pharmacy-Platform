'use client';

/**
 * The physical supply: what pack, and how it reached the patient.
 *
 * A separate panel from the dispensing sign-off because they answer different
 * questions. Dispensing is "a pharmacist checked this is right"; this is "this
 * box, this batch, went out this way on this day" — and it is the half a
 * recall reads.
 *
 * Nothing here can be moved forward without a batch number and an expiry.
 * That rule lives in three places on purpose: a database constraint that makes
 * it true whoever writes the row, a server check that makes the refusal
 * legible, and this, which stops a pharmacist reaching a dead button.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Package, Truck, Check, Loader2, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/units';
import { transitionProblem, type FulfilmentStatus } from '@/lib/fulfilment/transitions';
import {
  getFulfilment, recordPackDetails, advanceFulfilment, type FulfilmentRow,
} from './fulfilment-actions';

const inputClass =
  'w-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none transition-[border-color] focus:border-brand-400';

/** What each move is called on a button, in the pharmacist's words. */
const MOVE_LABEL: Record<FulfilmentStatus, string> = {
  PENDING: 'Reset',
  ASSEMBLING: 'Start assembling',
  READY: 'Mark ready',
  DISPATCHED: 'Mark dispatched',
  COLLECTED: 'Record collection',
  SUPPLIED: 'Mark supplied',
  CANCELLED: 'Cancel',
};

const STATUS_TONE: Record<FulfilmentStatus, string> = {
  PENDING: 'bg-sunk text-ink-faint',
  ASSEMBLING: 'bg-sunk text-ink-soft',
  READY: 'bg-brand-100 text-brand-700',
  DISPATCHED: 'bg-safe-100 text-safe-700',
  COLLECTED: 'bg-safe-100 text-safe-700',
  SUPPLIED: 'bg-safe-100 text-safe-700',
  CANCELLED: 'bg-stop-100 text-stop-700',
};

export function FulfilmentPanel({
  prescriptionId, branchId, companyId,
}: {
  prescriptionId: string;
  branchId?: string | null;
  companyId?: string | null;
}) {
  const router = useRouter();
  // A separate flag rather than a sentinel value: "loading" as a member of
  // the row type has to be narrowed away at every use, and the assertions that
  // takes are exactly how a null slips through.
  const [row, setRow] = useState<FulfilmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState<string | null>(null);

  async function load() {
    const found = await getFulfilment(prescriptionId);
    setRow(found);
    if (found) {
      setBatchNumber(found.batchNumber ?? '');
      setExpiryDate(found.expiryDate ?? '');
      setCarrier(found.carrier ?? '');
      setTracking(found.trackingNumber ?? '');
    }
  }

  useEffect(() => {
    let live = true;
    getFulfilment(prescriptionId).then((found) => {
      if (!live) return;
      setRow(found);
      if (found) {
        setBatchNumber(found.batchNumber ?? '');
        setExpiryDate(found.expiryDate ?? '');
        setCarrier(found.carrier ?? '');
        setTracking(found.trackingNumber ?? '');
      }
      setLoading(false);
    });
    return () => { live = false; };
  }, [prescriptionId]);

  if (loading) {
    return <p className="text-[12.5px] text-ink-faint">Loading supply record…</p>;
  }

  /*
   * A prescription raised before this existed has no fulfilment record. Said
   * plainly rather than shown as an empty panel, because "there is nothing
   * here" and "this is older than the feature" look identical otherwise.
   */
  if (!row) {
    return (
      <p className="text-[12.5px] text-ink-faint">
        No supply record — this prescription was issued before collection and delivery were
        tracked separately.
      </p>
    );
  }

  // Captured so the null guard above survives into the async handlers below.
  // Reading state directly inside them cannot be narrowed, and asserting past
  // it is how a null reaches the server action.
  const record = row;
  const delivery = record.method === 'DELIVERY';
  const finished = record.status === 'SUPPLIED' || record.status === 'CANCELLED';

  async function savePack() {
    setBusy(true);
    setError(null);
    const result = await recordPackDetails({
      fulfilmentId: record.id, batchNumber, expiryDate, branchId, companyId,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    await load();
    router.refresh();
  }

  async function move(to: FulfilmentStatus) {
    setBusy(true);
    setError(null);
    const result = await advanceFulfilment({
      fulfilmentId: record.id,
      to,
      carrier: delivery ? carrier : null,
      trackingNumber: delivery ? tracking : null,
      branchId,
      companyId,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }

    /*
     * Supply is what opens repeat care. Saying so here is the only place a
     * pharmacist finds out it happened, and the gaps matter — an enrolment
     * without a starting weight silently disables the rules that read it.
     */
    if (result.enrolment?.created) {
      setEnrolled(
        result.enrolment.gaps.length > 0
          ? `Repeat care is now open for this patient, but the baseline is missing ${result.enrolment.gaps.join('; ')}.`
          : 'Repeat care is now open for this patient.',
      );
    }

    await load();
    router.refresh();
  }

  return (
    <div className="rounded-control border border-line bg-sunk px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {delivery
          ? <Truck size={13} strokeWidth={2.2} className="text-ink-faint" />
          : <Package size={13} strokeWidth={2.2} className="text-ink-faint" />}
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
          {delivery ? 'For delivery' : 'For collection'}
        </span>
        <span
          className={cn(
            'rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
            STATUS_TONE[record.status],
          )}
        >
          {record.status.toLowerCase()}
        </span>
        {record.batchNumber && record.expiryDate ? (
          <span className="tabular font-mono text-[10.5px] text-ink-faint">
            {record.batchNumber} · exp {formatDate(record.expiryDate)}
          </span>
        ) : null}
      </div>

      {delivery && record.deliveryAddressSnapshot ? (
        <p className="m-0 mb-2 text-[12px] leading-snug text-ink-soft">
          {record.deliveryAddressSnapshot}
        </p>
      ) : null}

      {!finished ? (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <input
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="Batch number"
              aria-label="Batch number"
              className={inputClass}
            />
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              aria-label="Pack expiry date"
              className={cn(inputClass, 'tabular')}
            />
          </div>

          {delivery ? (
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Carrier — optional"
                aria-label="Carrier"
                className={inputClass}
              />
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Tracking — optional"
                aria-label="Tracking number"
                className={inputClass}
              />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mb-2 flex items-start gap-1.5 text-[12px] text-stop-700">
              <AlertTriangle size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={savePack}
              disabled={busy}
              className="flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} strokeWidth={2.6} />}
              Save pack
            </button>

            {record.next.filter((t) => t !== 'CANCELLED').map((target) => {
              /*
               * The same rule the server will apply, asked here so the reason
               * a step is unavailable is visible on the button rather than
               * discovered by pressing it.
               */
              const blocked = transitionProblem(
                { ...record, batchNumber, expiryDate: expiryDate || null },
                target,
              );

              return (
                <button
                  key={target}
                  type="button"
                  onClick={() => move(target)}
                  disabled={busy || blocked !== null}
                  title={blocked ?? undefined}
                  className="flex items-center gap-1 rounded-[6px] bg-brand-600 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {MOVE_LABEL[target]}
                  <ChevronRight size={11} strokeWidth={2.4} />
                </button>
              );
            })}
          </div>

          {/*
            The reason the next step is unavailable, spelled out rather than
            left to a tooltip nobody hovers.
          */}
          {record.next.length > 0 ? (() => {
            const target = record.next.find((t) => t !== 'CANCELLED');
            if (!target) return null;
            const blocked = transitionProblem(
              { ...record, batchNumber, expiryDate: expiryDate || null },
              target,
            );
            return blocked ? (
              <p className="m-0 mt-2 text-[11.5px] leading-snug text-ink-faint">{blocked}</p>
            ) : null;
          })() : null}
        </>
      ) : null}

      {enrolled ? (
        <p className="m-0 mt-2 rounded-control bg-safe-50 px-2.5 py-1.5 text-[12px] leading-snug text-safe-900">
          {enrolled}
        </p>
      ) : null}
    </div>
  );
}
