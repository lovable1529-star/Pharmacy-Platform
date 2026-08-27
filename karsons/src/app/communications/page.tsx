'use client';

/**
 * Communications centre.
 *
 * Delivery status is the point of this screen. Every GP is a gov.im government
 * mailbox, and a bounced clinical notification means a practice has no record of
 * something that happened to their patient. Bounces are surfaced loudly.
 */

import { useMemo } from 'react';
import { MESSAGES, SURGERIES } from '@/lib/demo/data';
import { detectDeliveryProblems } from '@/lib/communications/batching';

const STATUS_STYLE: Record<string, string> = {
  DELIVERED: 'bg-clinical-green-100 text-clinical-green-700',
  SENT: 'bg-brand-100 text-brand-700',
  QUEUED: 'bg-canvas text-ink-soft',
  BOUNCED: 'bg-triage-red-100 text-triage-red-700',
  FAILED: 'bg-triage-red-100 text-triage-red-700',
};

export default function CommunicationsPage() {
  const alerts = useMemo(
    () =>
      detectDeliveryProblems(
        MESSAGES.map((m) => ({
          messageId: m.id, recipient: m.recipient, status: m.status, sentAt: m.sentAt,
        })),
      ),
    [],
  );

  const total = MESSAGES.reduce((sum, m) => sum + m.patientCount, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl">Communications</h1>
      <p className="mb-6 text-sm text-ink-soft">
        GP surgeries receive one email each at the end of the day, listing every patient of theirs
        you saw.
      </p>

      {alerts.length > 0 && (
        <section className="mb-5 space-y-2">
          {alerts.map((alert) => (
            <div key={alert.code}
              className={`rounded-card border p-4 ${
                alert.severity === 'HIGH'
                  ? 'border-triage-red-700 bg-triage-red-100'
                  : 'border-triage-amber-700 bg-triage-amber-100'
              }`}>
              <p className={`font-semibold ${alert.severity === 'HIGH' ? 'text-triage-red-700' : 'text-triage-amber-700'}`}>
                {alert.message}
              </p>
              <p className="mt-0.5 font-mono text-xs text-ink-soft">{alert.affected.join(', ')}</p>
            </div>
          ))}
        </section>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-ink-soft">Notifications today</div>
          <div className="mt-1 font-display text-3xl">{MESSAGES.length}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-ink-soft">Patients covered</div>
          <div className="mt-1 font-display text-3xl">{total}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-ink-soft">Surgeries configured</div>
          <div className="mt-1 font-display text-3xl">{SURGERIES.length}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Surgery</th>
              <th className="px-4 py-3 font-semibold">Address</th>
              <th className="px-4 py-3 font-semibold">Patients</th>
              <th className="px-4 py-3 font-semibold">Sent</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {MESSAGES.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-semibold">{m.surgeryName}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">{m.recipient}</td>
                <td className="px-4 py-3">{m.patientCount}</td>
                <td className="px-4 py-3 text-ink-soft">
                  {m.sentAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[m.status]}`}>
                    {m.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {(m.status === 'BOUNCED' || m.status === 'FAILED') && (
                    <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-soft">
        A bounce almost always means the address is wrong. Correct it under Settings → GP surgeries
        before retrying.
      </p>
    </div>
  );
}
