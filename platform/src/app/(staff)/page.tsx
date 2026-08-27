/**
 * Today — the screen a pharmacist opens and works from.
 *
 * His feedback on the previous build, verbatim: "At the moment, it's unclear
 * where the pharmacist needs to go. Perhaps useful to have a home page, and the
 * pharmacist can search for the patient name or DOB straight away."
 *
 * So: search first, then what needs a decision, then what is happening today.
 */

import Link from 'next/link';
import { AlertTriangle, PackageX, CalendarClock, ArrowRight } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { getTodaySnapshot, getPatients } from '@/lib/queries/clinical';
import { getReviewQueue } from '@/lib/queries/reviews';
import { can } from '@/lib/tenancy/scope';
import { formatDate } from '@/lib/units';
import { PatientSearch } from './patient-search';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { actor, activeBranch } = await getStaffContext();

  const [snapshot, patients, queue] = await Promise.all([
    getTodaySnapshot(actor.organisationId, activeBranch?.id ?? null),
    getPatients(actor.organisationId),
    can(actor, 'repeat_care:edit') ? getReviewQueue(actor.organisationId) : Promise.resolve([]),
  ]);

  const blocked = queue.filter((q) => q.outcome === 'RED');

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-8">
      <div className="mb-7">
        <h1 className="text-[28px] leading-tight text-ink">
          Today at {activeBranch?.name ?? 'your pharmacy'}
        </h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          {new Intl.DateTimeFormat('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            timeZone: 'Europe/Isle_of_Man',
          }).format(new Date())}
        </p>
      </div>

      <PatientSearch
        patients={patients.map((p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth,
          postcode: p.postcode,
          phone: p.phone,
          email: p.email,
        }))}
      />

      {/* Counters */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Completed today" value={snapshot.completedToday} />
        <Stat label="Awaiting a decision" value={snapshot.submissionsAwaiting} tone={snapshot.submissionsAwaiting > 0 ? 'review' : undefined} />
        <Stat label="Blocked on safety" value={blocked.length} tone={blocked.length > 0 ? 'stop' : undefined} />
      </div>

      {/* Blocked requests */}
      {blocked.length > 0 ? (
        <section className="mb-6 overflow-hidden rounded-[10px] border border-stop-200 bg-surface">
          <div className="flex items-center gap-2 border-b border-stop-100 bg-stop-50 px-4 py-2.5">
            <AlertTriangle size={15} strokeWidth={2.1} className="text-stop-700" />
            <h2 className="font-display text-[14px] font-semibold text-stop-700">
              {blocked.length} repeat request{blocked.length === 1 ? '' : 's'} blocked on safety grounds
            </h2>
            <Link href="/repeat-care" className="ml-auto flex items-center gap-1 text-[12.5px] font-medium text-stop-700">
              Review <ArrowRight size={12} strokeWidth={2.2} />
            </Link>
          </div>
          {blocked.slice(0, 4).map((item) => (
            <div key={item.submissionId} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">
                  {item.patientName ?? 'Unmatched patient'}
                </span>
                <span className="block truncate text-[12.5px] text-ink-faint">
                  {item.trace.find((t) => t.ruleId === item.decidingRuleId)?.label ?? item.serviceName}
                </span>
              </span>
              <Link
                href="/repeat-care"
                className="shrink-0 rounded-[6px] border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
              >
                Why?
              </Link>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Stock warnings */}
        <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <CalendarClock size={15} strokeWidth={2} className="text-ink-faint" />
            <h2 className="font-display text-[14.5px] font-semibold text-ink">Stock needing attention</h2>
            <Link href="/inventory" className="ml-auto text-[12.5px] text-ink-faint hover:text-ink">
              Inventory
            </Link>
          </div>
          {snapshot.expiringSoon.length === 0 && snapshot.lowStock.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13.5px] text-ink-faint">
              Nothing expiring soon or running low.
            </p>
          ) : (
            <>
              {snapshot.expiringSoon.slice(0, 4).map((s) => (
                <div key={`exp-${s.batchId}-${s.branchId}`} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{s.productName}</span>
                    <span className="tabular block font-mono text-[11.5px] text-ink-faint">
                      Batch {s.batchNumber} · expires {formatDate(s.expiryDate)}
                    </span>
                  </span>
                  <span className={`tabular shrink-0 rounded-[5px] px-2 py-0.5 font-mono text-[10.5px] ${s.daysToExpiry <= 30 ? 'bg-stop-100 text-stop-700' : 'bg-review-100 text-review-700'}`}>
                    {s.daysToExpiry}d
                  </span>
                </div>
              ))}
              {snapshot.lowStock.slice(0, 3).map((s) => (
                <div key={`low-${s.batchId}-${s.branchId}`} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                  <PackageX size={14} strokeWidth={2} className="shrink-0 text-review-600" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{s.productName}</span>
                  <span className="tabular shrink-0 font-mono text-[12px] text-review-700">{s.quantity} left</span>
                </div>
              ))}
            </>
          )}
        </section>

        {/* Today's consultations */}
        <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="font-display text-[14.5px] font-semibold text-ink">Seen today</h2>
            <Link href="/consultations" className="ml-auto text-[12.5px] text-ink-faint hover:text-ink">
              All consultations
            </Link>
          </div>
          {snapshot.recentConsultations.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13.5px] text-ink-faint">
              Nobody seen yet today.
            </p>
          ) : (
            snapshot.recentConsultations.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{c.patientName}</span>
                  <span className="block truncate text-[12px] text-ink-faint">
                    {c.productName ?? c.serviceName}
                    {c.clinicianName ? ` · ${c.clinicianName}` : ''}
                  </span>
                </span>
                {c.fundedBy ? (
                  <span className="shrink-0 rounded-[5px] bg-sunk px-2 py-0.5 font-mono text-[10px] uppercase text-ink-faint">
                    {c.fundedBy}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: number; tone?: 'review' | 'stop' }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">{label}</div>
      <div
        className={`tabular mt-1 font-display text-[26px] font-semibold ${
          tone === 'stop' ? 'text-stop-700' : tone === 'review' ? 'text-review-700' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
