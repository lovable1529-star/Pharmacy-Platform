'use client';

/**
 * Moving an appointment.
 *
 * Same calendar the public booking page uses, so a receptionist on the phone is
 * looking at exactly what the patient would see online — days with nothing free
 * are struck through rather than merely dim, because "I can see Tuesday but it
 * won't let me click it" is the complaint that follows otherwise.
 *
 * The slot list here is only a hint. The authoritative check runs inside the
 * transaction on confirm, against freshly read bookings.
 */

import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { enGB } from 'date-fns/locale';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import { getRescheduleSlots, type DaySlots } from './actions';
import type { AppointmentRow } from './appointments-view';
import 'react-day-picker/style.css';

function time(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(iso));
}

/** YYYY-MM-DD for a Date, read in the pharmacy's zone. */
function dateKey(day: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: PHARMACY_TIMEZONE,
  }).format(day);
  return parts;
}

export function RescheduleDialog({
  appointment,
  branches,
  currentBranchId,
  onClose,
  onConfirm,
}: {
  appointment: AppointmentRow;
  /** Every branch this user can work at, so a patient can be moved between them. */
  branches: { id: string; name: string }[];
  currentBranchId: string;
  onClose: () => void;
  onConfirm: (
    startsAt: string,
    notify: boolean,
    branchId: string | null,
  ) => void | Promise<void>;
}) {
  const [branchId, setBranchId] = useState(currentBranchId);
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    let live = true;
    setDays(null);
    setSelectedSlot(null);
    getRescheduleSlots(appointment.id, 21, branchId).then((result) => {
      if (!live) return;
      if (result.ok && result.days) setDays(result.days);
      else setError(result.error ?? 'Could not load available times.');
    });
    return () => {
      live = false;
    };
  }, [appointment.id, branchId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = new Set((days ?? []).filter((d) => d.slots.some((s) => s.available)).map((d) => d.date));
  const slotsForDay = selectedDay
    ? (days ?? []).find((d) => d.date === dateKey(selectedDay))?.slots.filter((s) => s.available) ?? []
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4 py-8">
      <div className="max-h-full w-full max-w-[560px] overflow-auto rounded-panel border border-line bg-surface shadow-pop">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[17px] font-semibold text-ink">
              Move this appointment
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              {appointment.bookedName} · {appointment.serviceName} · {appointment.reference}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-faint hover:bg-sunk hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4">
          {branches.length > 1 ? (
            <div className="mb-4">
              <label
                htmlFor="reschedule-branch"
                className="mb-1.5 block text-[13px] font-medium text-ink-soft"
              >
                Branch
              </label>
              <SearchSelect
                id="reschedule-branch"
                value={branchId}
                onChange={setBranchId}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
              {branchId !== currentBranchId ? (
                <p className="mt-1 text-[12.5px] text-review-700">
                  Moving sites. Their questionnaire and answers come with them.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-control border border-stop-200 bg-stop-50 px-3 py-2 text-[13.5px] text-stop-700">
              {error}
            </p>
          ) : days === null ? (
            <p className="flex items-center gap-2 py-8 text-[13.5px] text-ink-faint">
              <Loader2 size={14} className="animate-spin" />
              Loading available times…
            </p>
          ) : open.size === 0 ? (
            <p className="py-8 text-center text-[13.5px] text-ink-faint">
              No free slots in the next three weeks. Add opening hours in Settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-5">
              <DayPicker
                mode="single"
                weekStartsOn={1}
                locale={enGB}
                selected={selectedDay}
                onSelect={(day) => {
                  setSelectedDay(day);
                  setSelectedSlot(null);
                }}
                disabled={(day) => !open.has(dateKey(day))}
                className="karsons-calendar"
              />

              <div className="min-w-[168px] flex-1">
                {!selectedDay ? (
                  <p className="pt-2 text-[13px] text-ink-faint">
                    Choose a day to see times.
                  </p>
                ) : slotsForDay.length === 0 ? (
                  <p className="pt-2 text-[13px] text-ink-faint">
                    Nothing free that day.
                  </p>
                ) : (
                  <div className="grid max-h-[240px] grid-cols-3 gap-1.5 overflow-auto pr-1">
                    {slotsForDay.map((slot) => (
                      <button
                        key={slot.startsAt}
                        type="button"
                        onClick={() => setSelectedSlot(slot.startsAt)}
                        className={cn(
                          'tabular rounded-[6px] border px-1.5 py-1.5 font-mono text-[12px] transition-colors',
                          selectedSlot === slot.startsAt
                            ? 'border-brand-600 bg-brand-600 font-semibold text-white'
                            : 'border-line text-ink-soft hover:border-brand-300 hover:text-ink',
                        )}
                      >
                        {time(slot.startsAt)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <label className="flex items-center gap-2 text-[13px] text-ink-soft">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
            />
            Email the patient the new time
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedSlot}
              onClick={() =>
                selectedSlot &&
                onConfirm(
                  selectedSlot,
                  notify,
                  branchId === currentBranchId ? null : branchId,
                )
              }
              className={cn(
                'rounded-control bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700',
                !selectedSlot && 'cursor-not-allowed opacity-40 hover:bg-brand-600',
              )}
            >
              Move appointment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
