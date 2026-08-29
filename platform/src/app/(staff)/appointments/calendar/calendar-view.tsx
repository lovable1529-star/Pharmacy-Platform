'use client';

/**
 * Month, week and day — §14.
 *
 * Status is carried by a coloured bar rather than by colour alone, so a
 * cancelled appointment is still distinguishable to someone who cannot tell
 * amber from green. The triage palette is reserved for clinical outcomes, so
 * appointment states use their own neutral-to-muted range: this is "did they
 * turn up", not "is this safe".
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, CalendarDays, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PageHeader, Panel, EmptyState } from '@/components/ui/primitives';
import {
  WEEKDAY_LABELS, monthLabel, dayLabel, localTimeLabel, addDays, addMonths,
  type CalendarScale,
} from '@/lib/scheduling/calendar';
import { localDateKey } from '@/lib/scheduling/slots';

interface CalendarAppointment {
  id: string;
  reference: string;
  startsAt: string;
  status: string;
  name: string;
  serviceName: string;
  branchName: string;
}

interface SerialisedDay {
  key: string;
  date: string;
  dayOfMonth: number;
  inScope: boolean;
  isToday: boolean;
}

/**
 * Appointment status, not clinical triage.
 *
 * Kept off the safe/review/stop palette on purpose — those mean something
 * specific in this product, and a cancelled appointment is not a clinical red.
 */
const STATUS: Record<string, { bar: string; text: string; label: string }> = {
  BOOKED: { bar: 'bg-brand-500', text: 'text-ink', label: 'Booked' },
  ARRIVED: { bar: 'bg-safe-600', text: 'text-ink', label: 'Arrived' },
  COMPLETED: { bar: 'bg-ink-faint', text: 'text-ink-faint', label: 'Completed' },
  CANCELLED: { bar: 'bg-line', text: 'text-ink-faint line-through', label: 'Cancelled' },
  DID_NOT_ATTEND: { bar: 'bg-review-600', text: 'text-ink-faint', label: 'Did not attend' },
};

function styleFor(status: string) {
  return STATUS[status] ?? STATUS.BOOKED!;
}

export function CalendarView({
  scale,
  anchor,
  days,
  appointments,
  branchName,
}: {
  scale: CalendarScale;
  anchor: string;
  days: SerialisedDay[];
  appointments: CalendarAppointment[];
  branchName: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const anchorDate = new Date(anchor);

  const byDay = new Map<string, CalendarAppointment[]>();
  for (const item of appointments) {
    const key = localDateKey(new Date(item.startsAt));
    const list = byDay.get(key);
    if (list) list.push(item);
    else byDay.set(key, [item]);
  }

  function go(next: Date, nextScale: CalendarScale = scale) {
    const query = new URLSearchParams(params.toString());
    query.set('scale', nextScale);
    query.set('on', localDateKey(next));
    router.push(`/appointments/calendar?${query.toString()}`);
  }

  const step = (direction: -1 | 1) =>
    go(
      scale === 'month'
        ? addMonths(anchorDate, direction)
        : addDays(anchorDate, direction * (scale === 'week' ? 7 : 1)),
    );

  const heading =
    scale === 'month' ? monthLabel(anchorDate)
      : scale === 'day' ? dayLabel(anchorDate)
        : `Week of ${dayLabel(new Date(days[0]!.date))}`;

  return (
    <div className="page-shell mx-auto max-w-[calc(1200px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Calendar"
        subtitle={`${branchName} · ${appointments.length} appointment${appointments.length === 1 ? '' : 's'} in view`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/appointments"
              className="rounded-control border border-line px-3 py-[7px] text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
            >
              List
            </Link>
            <Link
              href="/appointments/new"
              className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <Plus size={13} strokeWidth={2.4} />
              Book
            </Link>
          </div>
        }
      />

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button" onClick={() => step(-1)} aria-label="Previous"
            className="rounded-control border border-line p-2 text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            <ChevronLeft size={15} strokeWidth={2.2} />
          </button>
          <button
            type="button" onClick={() => go(new Date())}
            className="rounded-control border border-line px-3 py-[7px] text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            Today
          </button>
          <button
            type="button" onClick={() => step(1)} aria-label="Next"
            className="rounded-control border border-line p-2 text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            <ChevronRight size={15} strokeWidth={2.2} />
          </button>
        </div>

        <h2 className="text-[16px] font-semibold text-ink">{heading}</h2>

        <div className="ml-auto flex gap-1">
          {(['month', 'week', 'day'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => go(anchorDate, s)}
              aria-pressed={scale === s}
              className={cn(
                'rounded-control px-3 py-[7px] text-[12.5px] font-medium capitalize transition-colors',
                scale === s
                  ? 'bg-ink text-white'
                  : 'border border-line text-ink-soft hover:border-brand-300 hover:text-ink',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {scale === 'month' ? (
        <Panel className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-line bg-sunk">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="px-2 py-2 text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = byDay.get(day.key) ?? [];
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => go(new Date(day.date), 'day')}
                  className={cn(
                    'min-h-[92px] border-b border-r border-line-soft p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-sunk',
                    !day.inScope && 'bg-canvas',
                  )}
                >
                  <span
                    className={cn(
                      'tabular mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-[11px]',
                      day.isToday ? 'bg-brand-600 font-semibold text-white' : '',
                      day.inScope ? 'text-ink' : 'text-ink-faint',
                    )}
                  >
                    {day.dayOfMonth}
                  </span>
                  <span className="block space-y-0.5">
                    {items.slice(0, 3).map((item) => {
                      const s = styleFor(item.status);
                      return (
                        <span key={item.id} className="flex items-center gap-1">
                          <span className={cn('h-2.5 w-0.5 shrink-0 rounded-full', s.bar)} />
                          <span className={cn('truncate text-[11px]', s.text)}>
                            {localTimeLabel(new Date(item.startsAt))} {item.name}
                          </span>
                        </span>
                      );
                    })}
                    {items.length > 3 ? (
                      <span className="block pl-1.5 text-[10.5px] text-ink-faint">
                        +{items.length - 3} more
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      ) : (
        <div className={cn('grid gap-3', scale === 'week' && 'lg:grid-cols-7')}>
          {days.map((day) => {
            const items = byDay.get(day.key) ?? [];
            return (
              <Panel key={day.key} className="p-0">
                <div
                  className={cn(
                    'flex items-baseline gap-2 border-b border-line px-3 py-2',
                    day.isToday && 'bg-brand-50',
                  )}
                >
                  <span className="text-[13px] font-semibold text-ink">
                    {scale === 'day' ? dayLabel(new Date(day.date)) : day.dayOfMonth}
                  </span>
                  {scale === 'week' ? (
                    <span className="font-mono text-[10.5px] uppercase text-ink-faint">
                      {WEEKDAY_LABELS[(new Date(day.date).getUTCDay() + 6) % 7]}
                    </span>
                  ) : null}
                  <span className="tabular ml-auto font-mono text-[11px] text-ink-faint">
                    {items.length}
                  </span>
                </div>

                {items.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[12px] text-ink-faint">Nothing booked</p>
                ) : (
                  <div>
                    {items.map((item) => {
                      const s = styleFor(item.status);
                      return (
                        <Link
                          key={item.id}
                          href={`/appointments?focus=${item.id}`}
                          className="flex items-start gap-2 border-b border-line-soft px-3 py-2 transition-colors last:border-b-0 hover:bg-sunk"
                        >
                          <span className={cn('mt-0.5 h-8 w-0.5 shrink-0 rounded-full', s.bar)} />
                          <span className="min-w-0 flex-1">
                            <span className="tabular block font-mono text-[11.5px] text-ink-faint">
                              {localTimeLabel(new Date(item.startsAt))}
                            </span>
                            <span className={cn('block truncate text-[13.5px] font-medium', s.text)}>
                              {item.name}
                            </span>
                            <span className="block truncate text-[11.5px] text-ink-faint">
                              {item.serviceName} · {s.label}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {appointments.length === 0 ? (
        <Panel className="mt-4">
          <EmptyState
            title="Nothing in this period"
            body="Move to another week, or book an appointment."
          />
        </Panel>
      ) : null}

      {/* A legend, because a colour with no key is decoration. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <CalendarDays size={13} strokeWidth={2} className="text-ink-faint" />
        {Object.entries(STATUS).map(([key, s]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-full', s.bar)} />
            <span className="text-[11.5px] text-ink-faint">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
