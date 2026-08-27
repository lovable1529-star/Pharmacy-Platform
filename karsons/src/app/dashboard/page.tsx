'use client';

/**
 * Dashboard.
 *
 * Answers one question: what needs my attention right now?
 *
 * Ordered by urgency rather than by module. Safety and expiry alerts sit above
 * today's list, because a recalled batch matters more than the 11am appointment.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/shell/shell-provider';
import {
  APPOINTMENTS, BATCHES, CONSULTATIONS, MESSAGES, REPEAT_REQUESTS,
  WALK_INS, patientName,
} from '@/lib/demo/data';
import { buildQueue, longWaits } from '@/lib/scheduling/slots';
import { forecastExpiry } from '@/lib/inventory/stock';
import { detectDeliveryProblems } from '@/lib/communications/batching';
import { evaluateRuleset } from '@/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import { deriveValues } from '@/lib/clinical/derived';

function Stat({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const body = (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="mt-1 font-display text-3xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default function DashboardPage() {
  const { branchId, branchName } = useShell();

  const appointments = APPOINTMENTS.filter((a) => a.branchId === branchId);
  const upcoming = appointments.filter((a) => a.status === 'BOOKED' || a.status === 'ARRIVED');

  const queue = useMemo(
    () => buildQueue(WALK_INS.filter((w) => w.branchId === branchId), { activeClinicians: 2 }),
    [branchId],
  );

  const expiryAlerts = useMemo(
    () =>
      forecastExpiry(
        BATCHES.filter((b) => (b.stock[branchId] ?? 0) > 0).map((b) => ({
          batchId: b.id,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
          quantity: b.stock[branchId] ?? 0,
          productName: b.productName,
          branchName,
          dailyUsageRate: 2.5,
          recalledAt: b.recalledAt,
        })),
      ),
    [branchId, branchName],
  );

  // Triage every outstanding request so the dashboard shows real counts, not
  // placeholders. Cheap because evaluation is pure and in-memory.
  const triaged = useMemo(
    () =>
      REPEAT_REQUESTS.filter((r) => !r.reviewed).map((request) => {
        const derived = deriveValues({
          medicine: request.medicine,
          currentStrength: request.currentStrength,
          requestedStrength: request.requestedStrength,
          weightKg: request.weightKg,
          heightCm: request.heightCm,
          dateOfBirth: request.dateOfBirth,
          previousSupplies: request.previousSupplies,
        });
        const result = evaluateRuleset(GLP1_REPEAT_RULESET, {
          answers: request.answers,
          derived: { ...derived },
        });
        return { request, outcome: result.outcome };
      }),
    [],
  );

  const reds = triaged.filter((t) => t.outcome === 'RED');
  const ambers = triaged.filter((t) => t.outcome === 'AMBER');

  const deliveryAlerts = detectDeliveryProblems(
    MESSAGES.map((m) => ({
      messageId: m.id, recipient: m.recipient, status: m.status, sentAt: m.sentAt,
    })),
  );

  const todayConsultations = CONSULTATIONS.filter(
    (c) => c.branchId === branchId && c.completedAt.toDateString() === new Date().toDateString(),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl">Today at {branchName}</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      {/* Urgent first — a recalled batch matters more than the 11am booking. */}
      {(reds.length > 0 || deliveryAlerts.length > 0 || expiryAlerts.some((a) => a.severity !== 'SOON')) && (
        <section className="mb-6 space-y-2">
          {reds.length > 0 && (
            <Link href="/repeat-care" className="block rounded-card border border-triage-red-700 bg-triage-red-100 p-4">
              <span className="font-semibold text-triage-red-700">
                {reds.length} repeat request{reds.length === 1 ? '' : 's'} blocked on safety grounds
              </span>
              <span className="mt-0.5 block text-sm text-ink-soft">
                {reds.map((r) => r.request.patientName).join(', ')} — review and contact.
              </span>
            </Link>
          )}

          {deliveryAlerts.filter((a) => a.severity === 'HIGH').map((alert) => (
            <Link key={alert.code} href="/communications" className="block rounded-card border border-triage-red-700 bg-triage-red-100 p-4">
              <span className="font-semibold text-triage-red-700">{alert.message}</span>
              <span className="mt-0.5 block text-sm text-ink-soft">{alert.affected.join(', ')}</span>
            </Link>
          ))}

          {expiryAlerts.filter((a) => a.severity !== 'SOON').map((alert) => (
            <Link key={alert.batchId} href="/inventory" className="block rounded-card border border-triage-amber-700 bg-triage-amber-100 p-4">
              <span className="font-semibold text-triage-amber-700">
                {alert.productName} batch {alert.batchNumber} expires in {alert.daysRemaining} days
              </span>
              <span className="mt-0.5 block text-sm text-ink-soft">
                {alert.quantity} in stock
                {alert.projectedWaste !== null
                  ? ` · at your current rate about ${alert.projectedWaste} would be wasted`
                  : ''}
              </span>
            </Link>
          ))}
        </section>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Booked today" value={upcoming.length} sub={`${appointments.length} total`} href="/appointments" />
        <Stat label="Waiting now" value={queue.length} sub={longWaits(queue, 20).length > 0 ? `${longWaits(queue, 20).length} over 20 min` : 'No long waits'} />
        <Stat label="Needs review" value={ambers.length + reds.length} sub={`${reds.length} blocked`} href="/repeat-care" />
        <Stat label="Completed today" value={todayConsultations.length} sub={`${todayConsultations.filter((c) => c.fundingType === 'NHS').length} NHS`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base">Appointments</h2>
            <Link href="/appointments" className="text-sm font-semibold text-brand-600">View all</Link>
          </div>
          <ul className="divide-y divide-line">
            {upcoming.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-ink-soft">Nothing else booked today.</li>
            )}
            {upcoming.map((appointment) => (
              <li key={appointment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{patientName(appointment.patientId)}</div>
                  <div className="text-xs text-ink-soft">{appointment.serviceName}</div>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <span className="font-mono text-sm">
                    {appointment.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {appointment.status === 'ARRIVED' ? (
                    <Link
                      href={`/consultations/new?patient=${appointment.patientId}`}
                      className="rounded-full bg-clinical-green-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Start
                    </Link>
                  ) : (
                    <span className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft">
                      Booked
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-base">Walk-in queue</h2>
          </div>
          <ul className="divide-y divide-line">
            {queue.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-ink-soft">Nobody waiting.</li>
            )}
            {queue.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-100 font-mono text-xs font-bold text-brand-700">
                    {entry.position}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {entry.patientName}
                      {entry.priority && (
                        <span className="ml-2 rounded bg-triage-amber-100 px-1.5 py-0.5 text-[11px] text-triage-amber-700">
                          priority
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-soft">{entry.serviceName}</div>
                  </div>
                </div>
                <span className={`flex-none text-sm ${entry.waitingMinutes >= 20 ? 'font-semibold text-triage-amber-700' : 'text-ink-soft'}`}>
                  {entry.waitingMinutes} min
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
