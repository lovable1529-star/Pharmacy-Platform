'use client';

/**
 * What is owed and what has been paid.
 *
 * The demonstration banner is not decoration. Without it, a screen full of
 * "PAID" is indistinguishable from a screen full of money that actually
 * arrived, and that is exactly the confusion a stub should not create — for the
 * pharmacy or for anyone being shown the system.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Banknote, Check, Info, Link2, Loader2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import {
  getPayments, recordInPersonPayment, cancelPayment, type PaymentRow,
} from './actions';

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(
    minor / 100,
  );
}

function shortDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(date));
}

const TABS = [
  { key: 'PENDING', label: 'Awaiting payment' },
  { key: 'PAID', label: 'Paid' },
  { key: '', label: 'All' },
] as const;

export function PaymentsClient({ demo, appUrl }: { demo: boolean; appUrl: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<string>('PENDING');
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    getPayments(tab || undefined).then((r) => {
      if (!live) return;
      if (r.ok && r.payments) setRows(r.payments);
      else setError(r.error ?? 'Could not load payments.');
    });
    return () => {
      live = false;
    };
  }, [tab]);

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) setError(result.error ?? 'Something went wrong.');
    else {
      const refreshed = await getPayments(tab || undefined);
      if (refreshed.ok && refreshed.payments) setRows(refreshed.payments);
      router.refresh();
    }
  }

  async function copyLink(row: PaymentRow) {
    try {
      await navigator.clipboard.writeText(`${appUrl}/pay/${row.accessToken}`);
      setCopied(row.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy. The link is in the patient’s approval email.');
    }
  }

  const outstanding = (rows ?? [])
    .filter((r) => r.status === 'PENDING')
    .reduce((sum, r) => sum + r.amountMinor, 0);

  return (
    <div className="flex flex-col gap-4">
      {demo ? (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-review-200 bg-review-50 px-4 py-3">
          <Info size={15} strokeWidth={2.2} className="mt-0.5 shrink-0 text-review-700" />
          <div>
            <p className="m-0 text-[13.5px] font-semibold text-review-700">
              Payments are in demonstration mode
            </p>
            <p className="m-0 mt-0.5 text-[13px] text-ink-soft">
              No card details are collected and no money moves. Everything else —
              the link, the gate, the receipt, the prescription — behaves exactly
              as it will with a real provider. Anything marked paid here is
              recorded against the DEMO provider, so it can never be mistaken for
              real income in a report.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-[9px] bg-sunk p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-[6px] px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.key
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'PENDING' && outstanding > 0 ? (
          <span className="tabular font-mono text-[13px] text-ink-faint">
            {money(outstanding, 'GBP')} outstanding
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      {rows === null ? (
        <p className="flex items-center gap-2 px-1 py-10 text-[13.5px] text-ink-faint">
          <Loader2 size={14} className="animate-spin" /> Loading payments…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-14 text-center">
          <Banknote size={24} strokeWidth={1.6} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-[15px] font-medium text-ink">Nothing here</p>
          <p className="mt-1 text-[13.5px] text-ink-faint">
            Payment requests are raised when a pharmacist approves a priced
            request.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0"
            >
              <span className="tabular w-[86px] shrink-0 font-mono text-[14px] font-semibold text-ink">
                {money(r.amountMinor, r.currency)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">
                  {r.patientName ?? 'Patient not yet identified'}
                </span>
                <span className="block truncate text-[12.5px] text-ink-faint">
                  {r.description}
                  {r.branchName ? ` · ${r.branchName}` : ''} · raised{' '}
                  {shortDate(r.createdAt)}
                </span>
              </span>

              {r.provider === 'DEMO' && r.status === 'PAID' ? (
                <span className="rounded-[5px] bg-review-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-review-700">
                  Demo
                </span>
              ) : null}

              <span
                className={cn(
                  'rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                  r.status === 'PAID'
                    ? 'bg-safe-100 text-safe-700'
                    : r.status === 'PENDING'
                      ? 'bg-review-100 text-review-700'
                      : 'bg-sunk text-ink-faint',
                )}
              >
                {r.status === 'PAID' ? `Paid ${shortDate(r.paidAt)}` : r.status}
              </span>

              {r.status === 'PENDING' ? (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyLink(r)}
                    className="flex items-center gap-1 rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
                  >
                    <Link2 size={11} />
                    {copied === r.id ? 'Copied' : 'Link'}
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => run(r.id, () => recordInPersonPayment(r.id))}
                    className="flex items-center gap-1 rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-soft transition-colors hover:border-safe-200 hover:text-safe-700"
                  >
                    {busy === r.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Check size={11} strokeWidth={2.6} />
                    )}
                    Paid at till
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    aria-label="Cancel this payment request"
                    onClick={() => {
                      if (window.confirm('Cancel this payment request?')) {
                        run(r.id, () => cancelPayment(r.id));
                      }
                    }}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-line text-ink-faint hover:border-stop-200 hover:text-stop-700"
                  >
                    <XCircle size={12} />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
