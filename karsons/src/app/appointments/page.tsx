'use client';

/**
 * Appointments.
 *
 * Slot generation comes from `src/lib/scheduling/slots.ts`, which is tested
 * against the awkward cases — slots that would overrun their window, cancelled
 * bookings returning to the pool, and times already past.
 */

import { useMemo, useState } from 'react';
import { PATIENTS, SERVICES } from '@/lib/demo/data';
import { useShell } from '@/components/shell/shell-provider';
import { APPOINTMENTS, patientName } from '@/lib/demo/data';
import type { Slot } from '@/lib/scheduling/slots';
import { generateSlots } from '@/lib/scheduling/slots';

const AVAILABILITY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  dayOfWeek: day, startTime: '09:00', endTime: '17:00', slotMinutes: 15,
}));

const STATUS_STYLE: Record<string, string> = {
  BOOKED: 'border-line text-ink-soft',
  ARRIVED: 'border-clinical-green-600 bg-clinical-green-100 text-clinical-green-700',
  COMPLETED: 'border-line bg-canvas text-ink-soft',
  CANCELLED: 'border-line text-ink-soft line-through',
};

export default function AppointmentsPage() {
  const { branchId, branchName } = useShell();
  const [date] = useState(() => new Date());
  const [booking, setBooking] = useState<Slot | null>(null);
  const [confirmed, setConfirmed] = useState<{ name: string; time: string } | null>(null);
  const [patientId, setPatientId] = useState('');
  const [serviceId, setServiceId] = useState(SERVICES[0]!.id);

  const booked = APPOINTMENTS.filter((a) => a.branchId === branchId);

  const slots = useMemo(
    () => generateSlots({
      date,
      availability: AVAILABILITY,
      bookings: booked.map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, status: a.status })),
      notBefore: new Date(),
    }),
    [date, booked],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl">Appointments</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {branchName} · {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-card border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-base">Booked ({booked.length})</h2>
          </div>
          <ul className="divide-y divide-line">
            {booked.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-ink-soft">Nothing booked.</li>
            )}
            {booked.map((appointment) => (
              <li key={appointment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{patientName(appointment.patientId)}</div>
                  <div className="text-xs text-ink-soft">{appointment.serviceName}</div>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <span className="font-mono text-sm">
                    {appointment.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] ${STATUS_STYLE[appointment.status] ?? 'border-line'}`}>
                    {appointment.status.toLowerCase()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-base">Free slots today ({slots.length})</h2>
          </div>
          <div className="p-4">
            {slots.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">No slots left today.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slots.map((slot) => (
                  <button key={slot.startsAt.toISOString()} type="button"
                    onClick={() => setBooking(slot)}
                    className="rounded-lg border border-line px-3 py-1.5 font-mono text-sm hover:border-brand-600 hover:bg-brand-50">
                    {slot.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-ink-soft">
              Times already booked, and times that have passed, are not shown.
            </p>
          </div>
        </section>
      </div>

      {confirmed && (
        <p role="status"
          className="mt-4 rounded-card border border-clinical-green-600 bg-clinical-green-100 p-4 text-sm font-semibold text-clinical-green-700">
          Booked {confirmed.name} at {confirmed.time}. A confirmation has been queued.
        </p>
      )}

      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4"
          role="dialog" aria-modal="true" aria-labelledby="book-heading">
          <div className="w-full max-w-md rounded-card border border-line bg-surface p-6">
            <h2 id="book-heading" className="mb-1 text-xl">Book an appointment</h2>
            <p className="mb-5 text-sm text-ink-soft">
              {branchName} ·{' '}
              {booking.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} on{' '}
              {booking.startsAt.toLocaleDateString('en-GB')}
            </p>

            <label className="mb-3 block">
              <span className="mb-1.5 block text-sm font-semibold">Patient</span>
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5">
                <option value="">Select a patient</option>
                {PATIENTS.slice(0, 40).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} · {p.dateOfBirth.toLocaleDateString('en-GB')}
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-5 block">
              <span className="mb-1.5 block text-sm font-semibold">Service</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5">
                {SERVICES.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setBooking(null)}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">
                Cancel
              </button>
              <button type="button" disabled={!patientId}
                onClick={() => {
                  const patient = PATIENTS.find((p) => p.id === patientId)!;
                  setConfirmed({
                    name: `${patient.firstName} ${patient.lastName}`,
                    time: booking.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                  });
                  setBooking(null);
                  setPatientId('');
                }}
                className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                Confirm booking
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
