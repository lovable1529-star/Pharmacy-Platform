'use client';

/**
 * The counter's worklist.
 *
 * Ordered by what someone standing at the till needs: who is next, have they
 * filled the form in, and what is the one action to take right now. Everything
 * else lives behind the row menu.
 *
 * The form state matters more than it looks. "Has a submission row" is not the
 * same as "has answered" — booking online creates the draft immediately, so
 * existence alone would mark every new booking complete. Staff need STARTED vs
 * FINISHED, because the answer changes what they say to the patient.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Calendar, Loader2, FileText, UserCheck, MoreHorizontal, Link2, CalendarClock,
  XCircle, UserX, Check, Plus, Clock, MessageSquare, Search,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import {
  markArrived, markNoShow, cancelAppointment, rescheduleAppointment,
} from './actions';
import { RescheduleDialog } from './reschedule-dialog';
import { ActionLink, EmptyState, Notice, PageHeader, Panel } from '@/components/ui/primitives';

export type FormState = 'none' | 'not-started' | 'started' | 'submitted';

export interface AppointmentRow {
  id: string;
  reference: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  arrivedAt: Date | null;
  hasQuestion: string | null;
  bookedName: string;
  bookedEmail: string | null;
  bookedPhone: string | null;
  serviceName: string;
  serviceSlug: string;
  submissionId: string | null;
  submissionStatus: string | null;
  resumeToken: string | null;
  outcome: string | null;
  formState: FormState;
  patientId: string | null;
  patientFirstName: string | null;
  patientLastName: string | null;
  consultationId: string | null;
}

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

function time(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

/**
 * How late they are, or how long they have been waiting.
 *
 * Both matter and they are different questions. Before check-in, "late" is
 * about the patient; after it, "waiting" is about us — and his GLP-1 brief
 * names 20-minute waits as a live complaint. Nothing could measure either
 * until arrival started being timestamped.
 */
function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

function WaitBadge({ row, now }: { row: AppointmentRow; now: Date }) {
  if (row.status === 'ARRIVED' && row.arrivedAt) {
    const waiting = minutesBetween(new Date(row.arrivedAt), now);
    if (waiting < 10) return null;
    return (
      <span
        className={cn(
          'flex items-center gap-1 rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
          waiting >= 20 ? 'bg-stop-100 text-stop-700' : 'bg-review-100 text-review-700',
        )}
      >
        <Clock size={10} strokeWidth={2.4} />
        Waiting {waiting}m
      </span>
    );
  }

  if (row.status === 'BOOKED') {
    const late = minutesBetween(new Date(row.startsAt), now);
    if (late < 5) return null;
    return (
      <span className="flex items-center gap-1 rounded-[5px] bg-review-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-review-700">
        <Clock size={10} strokeWidth={2.4} />
        {late}m late
      </span>
    );
  }

  return null;
}

/** What the questionnaire looks like from behind the counter. */
function FormBadge({ row }: { row: AppointmentRow }) {
  if (row.formState === 'submitted') {
    const tone =
      row.outcome === 'RED'
        ? 'bg-stop-100 text-stop-700'
        : row.outcome === 'AMBER'
          ? 'bg-review-100 text-review-700'
          : 'bg-safe-100 text-safe-700';

    return (
      <span
        className={cn(
          'flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
          tone,
        )}
      >
        <Check size={10} strokeWidth={2.6} />
        {row.outcome ? `Form · ${row.outcome}` : 'Form in'}
      </span>
    );
  }

  if (row.formState === 'started') {
    return (
      <span className="flex items-center gap-1.5 rounded-[5px] bg-review-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-review-700">
        <FileText size={10} strokeWidth={2.4} />
        Part done
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-[5px] bg-sunk px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
      <FileText size={10} strokeWidth={2.2} />
      No form
    </span>
  );
}

export function AppointmentsView({
  rows, branchName, branchId, branches, appUrl,
}: {
  rows: AppointmentRow[];
  branchName: string;
  branchId: string;
  branches: { id: string; name: string }[];
  appUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<AppointmentRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  /*
   * Dismissing the row menu.
   *
   * This used to be an invisible `fixed inset-0` button covering the screen.
   * It did not cover the screen: every page is wrapped in `.animate-rise`,
   * whose transform animation makes it the containing block for fixed
   * descendants, so the catcher was 1156x435 inside the article rather than
   * 1440x900 over the viewport — measured, not guessed. Clicking the sidebar or
   * the top bar left the menu stuck open.
   *
   * A document listener has no geometry to get wrong, needs no z-index, and
   * gets Escape for free — which the catcher never handled.
   */
  useEffect(() => {
    if (!menu) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      // Anything within a row's menu region, including another row's trigger,
      // is handled by that element's own click.
      if (target?.closest('[data-row-menu]')) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Recomputed on render rather than ticking, so the page does not re-render
  // every second for a badge nobody is watching. A refresh updates it.
  const now = new Date();

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) =>
        [
          r.bookedName,
          r.patientFirstName && r.patientLastName
            ? `${r.patientFirstName} ${r.patientLastName}`
            : null,
          r.reference,
          r.serviceName,
          r.bookedPhone,
          r.bookedEmail,
        ]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
      )
    : rows;

  const days = visible.reduce<Map<string, AppointmentRow[]>>((map, row) => {
    const key = dayKey(row.startsAt);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
    return map;
  }, new Map());

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    setError(null);
    setMenu(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) setError(result.error ?? 'Something went wrong.');
    else router.refresh();
  }

  async function copyFormLink(row: AppointmentRow) {
    if (!row.resumeToken) return;
    const url = `${appUrl}/f/${row.serviceSlug}?s=${encodeURIComponent(row.resumeToken)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(row.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy. The link is in the patient’s confirmation email.');
    }
    setMenu(null);
  }

  return (
    <div className="page-shell mx-auto max-w-[calc(980px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Appointments"
        subtitle={`The next two weeks at ${branchName}. One calendar across every service.`}
        actions={
          <ActionLink href="/appointments/new" icon={<Plus size={14} strokeWidth={2.4} />}>
            Book appointment
          </ActionLink>
        }
      />

      {rows.length > 0 ? (
        <div className="relative mb-4">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find by name, reference, service or phone…"
            aria-label="Filter appointments"
            className="w-full rounded-control border border-line bg-surface py-2 pl-9 pr-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)]"
          />
        </div>
      ) : null}

      {error ? (
        <Notice tone="stop" className="mb-4">
          {error}
        </Notice>
      ) : null}

      {rows.length > 0 && visible.length === 0 ? (
        <Panel>
          <EmptyState
            title={`Nothing matches “${query}”`}
            body="Only the next two weeks at this branch are listed here."
          />
        </Panel>
      ) : null}

      {rows.length === 0 ? (
        <Panel>
          <div className="pt-12">
            <Calendar size={26} strokeWidth={1.6} className="mx-auto text-ink-faint" />
          </div>
          <div className="px-6 pb-14 pt-3 text-center">
            <p className="text-[15px] font-medium text-ink">Nothing booked</p>
            <p className="mt-1 text-[13.5px] text-ink-faint">
              Book one above, or send patients to{' '}
              <Link href="/book" className="text-brand-700 underline">/book</Link>. If
              nobody can find a slot, add opening hours in Settings.
            </p>
          </div>
        </Panel>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {[...days.entries()].map(([day, list]) => (
            // NOT the shared Panel: that clips its overflow, and each row here
            // opens an action menu that has to escape the section's bounds.
            <section
              key={day}
              className="overflow-visible rounded-panel border border-line bg-surface shadow-panel"
            >
              <div className="border-b border-line bg-sunk px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                {day} · {list.length} appointment{list.length === 1 ? '' : 's'}
              </div>

              {list.map((row) => {
                const name = row.patientFirstName
                  ? `${row.patientFirstName} ${row.patientLastName}`
                  : row.bookedName;
                const done = row.status === 'COMPLETED';
                const missed = row.status === 'DID_NOT_ATTEND';

                return (
                  <div
                    key={row.id}
                    className={cn(
                      'relative flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0',
                      (done || missed) && 'opacity-60',
                    )}
                  >
                    <span className="tabular w-[46px] shrink-0 font-mono text-[13px] font-medium text-ink-soft">
                      {time(row.startsAt)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-ink">
                        {row.patientId ? (
                          <Link
                            href={`/patients/${row.patientId}`}
                            className="hover:text-brand-700 hover:underline"
                          >
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                      </span>
                      <span className="block truncate text-[12.5px] text-ink-faint">
                        {row.serviceName} · {row.reference}
                      </span>
                    </span>

                    {row.hasQuestion ? (
                      <span
                        title={row.hasQuestion}
                        className="flex items-center gap-1 rounded-[5px] bg-brand-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-700"
                      >
                        <MessageSquare size={10} strokeWidth={2.4} />
                        Asked
                      </span>
                    ) : null}

                    <WaitBadge row={row} now={now} />
                    <FormBadge row={row} />

                    {done ? (
                      <span className="rounded-[5px] bg-safe-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-safe-700">
                        Done
                      </span>
                    ) : missed ? (
                      <span className="rounded-[5px] bg-sunk px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                        No show
                      </span>
                    ) : row.status === 'ARRIVED' ? (
                      row.submissionId && row.formState === 'submitted' ? (
                        <Link
                          href={`/consultations/${row.submissionId}`}
                          className="rounded-[6px] bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
                        >
                          Start consultation
                        </Link>
                      ) : (
                        // Arrived without a completed form. Rather than a dead
                        // end, hand staff the tablet link so it can be filled in
                        // at the counter — which is how most walk-ins go.
                        <Link
                          href={
                            row.resumeToken
                              ? `/f/${row.serviceSlug}?s=${encodeURIComponent(row.resumeToken)}`
                              : `/f/${row.serviceSlug}`
                          }
                          className="rounded-[6px] border border-review-200 bg-review-50 px-3 py-1.5 text-[12.5px] font-semibold text-review-700 transition-colors hover:bg-review-100"
                        >
                          Fill form now
                        </Link>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => run(row.id, () => markArrived(row.id))}
                        disabled={busy === row.id}
                        className={cn(
                          'flex items-center gap-1.5 rounded-[6px] border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink',
                          busy === row.id && 'opacity-60',
                        )}
                      >
                        {busy === row.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <UserCheck size={12} strokeWidth={2.2} />
                        )}
                        Arrived
                      </button>
                    )}

                    {/* Row menu */}
                    <div className="relative" data-row-menu={row.id}>
                      <button
                        type="button"
                        aria-label={`Actions for ${name}`}
                        onClick={() => setMenu(menu === row.id ? null : row.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-line text-ink-faint transition-colors hover:border-brand-300 hover:text-ink"
                      >
                        <MoreHorizontal size={14} />
                      </button>

                      {menu === row.id ? (
                        <>
                          <div className="absolute right-0 top-8 z-20 w-[212px] overflow-hidden rounded-[9px] border border-line bg-surface py-1 shadow-pop">
                            {row.resumeToken ? (
                              <button
                                type="button"
                                onClick={() => copyFormLink(row)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-sunk"
                              >
                                <Link2 size={13} />
                                {copied === row.id ? 'Link copied' : 'Copy form link'}
                              </button>
                            ) : null}

                            {!done ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRescheduling(row);
                                  setMenu(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-sunk"
                              >
                                <CalendarClock size={13} />
                                Reschedule
                              </button>
                            ) : null}

                            {!done && !missed ? (
                              <button
                                type="button"
                                onClick={() => run(row.id, () => markNoShow(row.id))}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-sunk"
                              >
                                <UserX size={13} />
                                Did not attend
                              </button>
                            ) : null}

                            {!done ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const reason = window.prompt(
                                    'Why is this appointment being cancelled?',
                                  );
                                  if (reason === null) return;
                                  run(row.id, () => cancelAppointment(row.id, reason));
                                }}
                                className="flex w-full items-center gap-2 border-t border-line-soft px-3 py-2 text-left text-[13px] text-stop-700 hover:bg-stop-50"
                              >
                                <XCircle size={13} />
                                Cancel appointment
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {rescheduling ? (
        <RescheduleDialog
          appointment={rescheduling}
          branches={branches}
          currentBranchId={branchId}
          onClose={() => setRescheduling(null)}
          onConfirm={async (startsAt, notify, targetBranchId) => {
            const id = rescheduling.id;
            setRescheduling(null);
            await run(id, () =>
              rescheduleAppointment(id, startsAt, notify, targetBranchId),
            );
          }}
        />
      ) : null}
    </div>
  );
}
