'use client';

/**
 * Sending records to GP practices by hand.
 *
 * The nightly batch covers the normal case. This covers the ones that actually
 * cause phone calls: a record amended after the practice was told, a patient
 * whose surgery was recorded wrongly and has now been fixed, or a day the
 * batch missed.
 *
 * Selection is grouped by practice on send, not here, because eleven separate
 * emails about eleven patients is unusable at the surgery end — one table per
 * practice is what he asked for.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Check, Loader2, Mail, RefreshCw, Send,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import { getGpRecords, sendToGp, type GpRecord } from './actions';

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60_000);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: PHARMACY_TIMEZONE,
  }).format(d);
}

function shortDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(date));
}

const control =
  'rounded-[7px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-brand-400';

export function GpSendClient() {
  const router = useRouter();

  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [surgeryId, setSurgeryId] = useState('');
  const [excludeSent, setExcludeSent] = useState(true);

  const [records, setRecords] = useState<GpRecord[] | null>(null);
  const [surgeries, setSurgeries] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRecords(null);
    getGpRecords({ from, to, gpSurgeryId: surgeryId || null, excludeSent }).then((r) => {
      if (!live) return;
      if (r.ok && r.records) {
        setRecords(r.records);
        if (r.surgeries) setSurgeries(r.surgeries);
        // Pre-select everything routable — the common action is "send all of
        // these", and unticking two is faster than ticking forty.
        setSelected(
          new Set(r.records.filter((x) => x.gpSurgeryEmail).map((x) => x.consultationId)),
        );
      } else setError(r.error ?? 'Could not load records.');
    });
    return () => {
      live = false;
    };
  }, [from, to, surgeryId, excludeSent]);

  const routable = (records ?? []).filter((r) => r.gpSurgeryEmail);
  const unroutable = (records ?? []).filter((r) => !r.gpSurgeryEmail);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);

    const result = await sendToGp([...selected]);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not send those records.');
      return;
    }

    setDone(
      `Queued ${result.queued} record${result.queued === 1 ? '' : 's'} to ` +
        `${result.practices} practice${result.practices === 1 ? '' : 's'}.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filters ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-line bg-surface p-4">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft" htmlFor="gp-from">
            From
          </label>
          <input
            id="gp-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={cn(control, 'font-mono')}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft" htmlFor="gp-to">
            To
          </label>
          <input
            id="gp-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={cn(control, 'font-mono')}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft" htmlFor="gp-surgery">
            Practice
          </label>
          <select
            id="gp-surgery"
            value={surgeryId}
            onChange={(e) => setSurgeryId(e.target.value)}
            className={cn(control, 'w-full')}
          >
            <option value="">All practices</option>
            {surgeries.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={excludeSent}
            onChange={(e) => setExcludeSent(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
          />
          Hide already sent
        </label>
      </div>

      {error ? (
        <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      {done ? (
        <div className="flex items-center gap-2 rounded-[9px] border border-safe-200 bg-safe-50 px-4 py-2.5 text-[13.5px] text-safe-700">
          <Check size={14} strokeWidth={2.6} />
          {done}
        </div>
      ) : null}

      {unroutable.length > 0 ? (
        <div className="rounded-[9px] border border-review-200 bg-review-50 px-4 py-3 text-[13.5px] text-review-700">
          <p className="m-0 flex items-center gap-1.5 font-medium">
            <AlertTriangle size={13} strokeWidth={2.4} />
            {unroutable.length} record{unroutable.length === 1 ? ' has' : 's have'} no GP
            practice recorded
          </p>
          <p className="m-0 mt-1 text-ink-soft">
            {unroutable.map((r) => r.patientName).join(', ')} — set their practice on
            the patient record and they will appear here.
          </p>
        </div>
      ) : null}

      {/* ── Records ─────────────────────────────────────── */}
      {records === null ? (
        <p className="flex items-center gap-2 px-1 py-10 text-[13.5px] text-ink-faint">
          <Loader2 size={14} className="animate-spin" /> Loading records…
        </p>
      ) : routable.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-14 text-center">
          <Mail size={24} strokeWidth={1.6} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-[15px] font-medium text-ink">Nothing to send</p>
          <p className="mt-1 text-[13.5px] text-ink-faint">
            {excludeSent
              ? 'Every record in this range has already gone to its practice.'
              : 'No completed consultations in this range.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-sunk px-4 py-2.5">
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              <input
                type="checkbox"
                checked={selected.size === routable.length && routable.length > 0}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(routable.map((r) => r.consultationId))
                      : new Set(),
                  )
                }
                className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
              />
              {selected.size} of {routable.length} selected
            </label>

            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={submit}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700',
                (busy || selected.size === 0) &&
                  'cursor-not-allowed opacity-40 hover:bg-brand-600',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Send to practices
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="w-9 px-4 py-2" />
                  <th className="px-2 py-2 font-medium text-ink-soft">Patient</th>
                  <th className="px-2 py-2 font-medium text-ink-soft">Practice</th>
                  <th className="px-2 py-2 font-medium text-ink-soft">Service</th>
                  <th className="px-2 py-2 font-medium text-ink-soft">Seen</th>
                  <th className="px-2 py-2 pr-4 font-medium text-ink-soft">Sent</th>
                </tr>
              </thead>
              <tbody>
                {routable.map((r) => (
                  <tr
                    key={r.consultationId}
                    className="border-b border-line-soft last:border-b-0"
                  >
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.patientName}`}
                        checked={selected.has(r.consultationId)}
                        onChange={() => toggle(r.consultationId)}
                        className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <span className="block font-medium text-ink">{r.patientName}</span>
                      <span className="tabular block font-mono text-[11.5px] text-ink-faint">
                        {r.dateOfBirth}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-ink-soft">{r.gpSurgeryName}</td>
                    <td className="px-2 py-2 text-ink-soft">
                      {r.serviceName}
                      {r.batchNumber ? (
                        <span className="block font-mono text-[11.5px] text-ink-faint">
                          {r.batchNumber}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular px-2 py-2 text-ink-soft">
                      {shortDate(r.completedAt)}
                    </td>
                    <td className="px-2 py-2 pr-4">
                      {r.gpNotifiedAt ? (
                        <span className="inline-flex items-center gap-1 rounded-[5px] bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-faint">
                          <RefreshCw size={9} />
                          {r.gpNotifyCount}× · {shortDate(r.gpNotifiedAt)}
                        </span>
                      ) : (
                        <span className="rounded-[5px] bg-review-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-review-700">
                          Not sent
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
