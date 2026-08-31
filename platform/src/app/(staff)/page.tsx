/**
 * Today — the screen a pharmacist opens and works from.
 *
 * His feedback on the previous build, verbatim: "At the moment, it's unclear
 * where the pharmacist needs to go. Perhaps useful to have a home page, and the
 * pharmacist can search for the patient name or DOB straight away."
 *
 * So: search first, then what needs a decision, then what is happening today.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * The greeting, the date and the search are now one raised panel rather than
 * three stacked blocks, so the screen opens with a single obvious place to put
 * your hands. Everything below it is reference.
 *
 * Two things in the design were deliberately NOT built, because nothing in the
 * system currently knows them and inventing them on a clinical dashboard is
 * indefensible:
 *
 *   - the "Clinic open" live pill. Opening hours exist in Settings but are not
 *     read here, and a badge asserting the clinic is open when it is not is
 *     worse than no badge.
 *   - the sparklines and "+18% vs last Friday" deltas on the counters. There is
 *     no historical series behind this screen — only today's figures — so any
 *     trend line would be decoration drawn over invented data.
 *
 * Both are noted in CHANGELOG-UI.md as available once the data exists. The
 * fourth counter is real: it counts the batches the panel below already lists.
 */

import Link from 'next/link';
import { AlertTriangle, PackageX, CalendarClock, ArrowRight, UserPlus, Activity } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { getTodaySnapshot, getPatients } from '@/lib/queries/clinical';
import { getReviewQueue } from '@/lib/queries/reviews';
import { can } from '@/lib/tenancy/scope';
import { formatDate } from '@/lib/units';
import { Panel, PanelHeader, PanelRow, StatCard, Tag, EmptyState } from '@/components/ui/primitives';
import { PatientSearch } from './patient-search';

export const dynamic = 'force-dynamic';

const TIME_ZONE = 'Europe/Isle_of_Man';

/**
 * Greeting by time of day, in the pharmacy's own timezone.
 *
 * The server may well be running in UTC, and the Isle of Man is an hour ahead
 * for most of the year — enough to wish somebody good morning at one in the
 * afternoon if you read the clock off the wrong machine.
 */
function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TIME_ZONE }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function TodayPage() {
  const { actor, activeBranch } = await getStaffContext();

  const [snapshot, patients, queue] = await Promise.all([
    getTodaySnapshot(actor.organisationId, activeBranch?.id ?? null),
    getPatients(actor.organisationId),
    can(actor, 'repeat_care:edit') ? getReviewQueue(actor.organisationId) : Promise.resolve([]),
  ]);

  const blocked = queue.filter((q) => q.outcome === 'RED');
  const now = new Date();
  const firstName = actor.fullName.split(' ')[0];
  const needingDecision = snapshot.submissionsAwaiting + blocked.length;

  return (
    <div className="page-shell mx-auto max-w-[calc(1160px_+_var(--nav-freed,0px))] px-7 pb-11 pt-7">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative animate-rise overflow-hidden rounded-[16px] border border-line bg-wash px-[26px] pb-[22px] pt-[26px] shadow-panel">
        {/* A single soft bloom in the top-right corner. It gives the panel a
            light source so the gradient reads as depth rather than as a flat
            grey fill that somebody forgot to finish. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-[60px] -top-[90px] h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,var(--color-brand-100)_0%,transparent_68%)]"
        />

        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-[7px] font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              {new Intl.DateTimeFormat('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                timeZone: TIME_ZONE,
              }).format(now)}
            </div>
            <h1 className="text-[31px] leading-[1.1] text-ink">
              {greetingFor(now)}, {firstName}
            </h1>
            <p className="mt-1.5 text-[14.5px] text-ink-soft">
              {needingDecision === 0
                ? 'Nothing is waiting on a decision'
                : `${needingDecision} ${needingDecision === 1 ? 'request needs' : 'requests need'} a decision`}
              {activeBranch ? ` · ${activeBranch.name}` : ''}
            </p>
          </div>

          {/*
            The two things you start from. "Work the queue" is only offered to
            somebody who can actually action it — the same permission that puts
            Repeat care in the navigation.
          */}
          <div className="flex shrink-0 gap-2">
            {can(actor, 'repeat_care:edit') ? (
              <Link
                href="/repeat-care"
                className="flex items-center gap-[7px] rounded-[9px] bg-gradient-to-br from-brand-500 to-brand-700 px-[15px] py-2.5 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(91,58,142,0.85)] transition-transform hover:-translate-y-px"
              >
                Work the queue
                <ArrowRight size={14} strokeWidth={2.2} />
              </Link>
            ) : null}
            <Link
              href="/patients/new"
              className="flex items-center gap-[7px] rounded-[9px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px] font-semibold text-ink-soft transition-[transform,border-color,color] hover:-translate-y-px hover:border-brand-300 hover:text-ink"
            >
              <UserPlus size={15} strokeWidth={2.1} />
              New patient
            </Link>
          </div>
        </div>

        <div className="relative mt-5">
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
        </div>
      </section>

      {/*
        ── Counters ────────────────────────────────────────────────────

        Ordered by how badly each ages rather than by category. A patient
        waiting for a telephone call is the one who notices the delay, so it
        comes first; expiring stock matters but nobody is sitting by a phone
        because of it.

        Every card that can be acted on links to the list it counts. A number
        a pharmacist has to go hunting for is a number they stop reading.
      */}
      <div className="mt-[18px] grid animate-rise gap-3.5 [animation-delay:60ms] sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="New patients to call"
          value={snapshot.callsOwed}
          tone={snapshot.callsOwed > 0 ? 'review' : 'neutral'}
          href="/repeat-care"
          footnote={
            snapshot.newPatientsAwaiting > snapshot.callsOwed
              ? `${snapshot.newPatientsAwaiting} awaiting review in total`
              : undefined
          }
        />
        <StatCard
          label="Stopped on safety"
          value={snapshot.repeatsStopped + blocked.length}
          tone={snapshot.repeatsStopped + blocked.length > 0 ? 'stop' : 'neutral'}
          href="/repeat-care"
          footnote={
            snapshot.repeatsStopped + blocked.length > 0
              ? 'Cannot be supplied without a pharmacist'
              : undefined
          }
        />
        <StatCard
          label="Waiting to be supplied"
          value={snapshot.awaitingSupply}
          tone={snapshot.awaitingSupply > 0 ? 'review' : 'neutral'}
          href="/prescriptions"
          footnote={snapshot.awaitingSupply > 0 ? 'Assemble, batch and hand over' : undefined}
        />
        <StatCard
          label="Batches expiring"
          value={snapshot.expiringSoon.length}
          tone={snapshot.expiringSoon.length > 0 ? 'review' : 'neutral'}
          href="/inventory"
          footnote="Within 60 days"
        />
      </div>

      {/*
        Kept, but demoted. "Completed today" and the total awaiting are worth
        knowing and are not work — they answer "how are we doing", where the
        row above answers "what should I pick up".
      */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-faint">
        <span>
          <strong className="tabular font-semibold text-ink">{snapshot.completedToday}</strong>
          {' '}completed today
        </span>
        <span>
          <strong className="tabular font-semibold text-ink">{snapshot.submissionsAwaiting}</strong>
          {' '}awaiting a decision across all services
        </span>
      </div>

      {/* ── Blocked on safety ─────────────────────────────────────────── */}
      {blocked.length > 0 ? (
        <div className="mt-[18px] animate-rise [animation-delay:120ms]">
          <Panel className="border-stop-200">
            <PanelHeader
              tone="stop"
              icon={<AlertTriangle size={15} strokeWidth={2.1} />}
              title={`${blocked.length} repeat request${blocked.length === 1 ? '' : 's'} blocked on safety grounds`}
              action={
                <Link
                  href="/repeat-care"
                  className="flex items-center gap-1 text-[12.5px] font-semibold text-stop-700"
                >
                  Review <ArrowRight size={12} strokeWidth={2.4} />
                </Link>
              }
            />
            {blocked.slice(0, 4).map((item) => (
              <PanelRow key={item.submissionId} className="hover:bg-sunk">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-stop-100 font-mono text-[10.5px] font-medium text-stop-700">
                  {(item.patientName ?? '? ?')
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
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
                  className="shrink-0 rounded-control border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
                >
                  Why?
                </Link>
              </PanelRow>
            ))}
          </Panel>
        </div>
      ) : null}

      {/* ── The day itself ────────────────────────────────────────────── */}
      <div className="mt-[18px] grid animate-rise gap-4 [animation-delay:180ms] lg:grid-cols-2">
        <Panel>
          <PanelHeader
            icon={<CalendarClock size={15} strokeWidth={2} />}
            title="Stock needing attention"
            action={
              <Link href="/inventory" className="text-[12.5px] text-ink-faint transition-colors hover:text-ink">
                Inventory
              </Link>
            }
          />
          {snapshot.expiringSoon.length === 0 && snapshot.lowStock.length === 0 ? (
            <EmptyState
              title="Nothing needs attention"
              body="No batch is expiring soon or running low at this branch."
              className="py-10"
            />
          ) : (
            <>
              {snapshot.expiringSoon.slice(0, 4).map((s) => (
                <PanelRow key={`exp-${s.batchId}-${s.branchId}`} className="hover:bg-sunk">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{s.productName}</span>
                    <span className="tabular block truncate font-mono text-[11.5px] text-ink-faint">
                      Batch {s.batchNumber} · expires {formatDate(s.expiryDate)}
                    </span>
                  </span>
                  {/* Thirty days is the line at which a batch stops being
                      something to plan around and starts being something to
                      act on, so it changes colour rather than merely counting
                      down. */}
                  <Tag tone={s.daysToExpiry <= 30 ? 'stop' : 'review'} className="tabular">
                    {s.daysToExpiry}d
                  </Tag>
                </PanelRow>
              ))}
              {snapshot.lowStock.slice(0, 3).map((s) => (
                <PanelRow key={`low-${s.batchId}-${s.branchId}`} className="hover:bg-sunk">
                  <PackageX size={14} strokeWidth={2} className="shrink-0 text-review-600" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{s.productName}</span>
                  <span className="tabular shrink-0 font-mono text-[12px] text-review-700">
                    {s.quantity} left
                  </span>
                </PanelRow>
              ))}
            </>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            icon={<Activity size={15} strokeWidth={2} />}
            title="Seen today"
            action={
              <Link href="/consultations" className="text-[12.5px] text-ink-faint transition-colors hover:text-ink">
                All consultations
              </Link>
            }
          />
          {snapshot.recentConsultations.length === 0 ? (
            <EmptyState
              title="Nobody seen yet today"
              body="Completed consultations appear here as they are recorded."
              className="py-10"
            />
          ) : (
            snapshot.recentConsultations.map((c) => (
              <PanelRow key={c.id} className="hover:bg-sunk">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunk font-mono text-[10px] font-medium text-ink-soft">
                  {(c.patientName ?? '? ?')
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{c.patientName}</span>
                  <span className="block truncate text-[12px] text-ink-faint">
                    {c.productName ?? c.serviceName}
                    {c.clinicianName ? ` · ${c.clinicianName}` : ''}
                  </span>
                </span>
                {c.fundedBy ? <Tag>{c.fundedBy}</Tag> : null}
              </PanelRow>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
