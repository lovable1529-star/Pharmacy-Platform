'use client';

/**
 * Booking from behind the counter.
 *
 * Same calendar and the same phone control the patient sees online, because a
 * receptionist reading a time off the screen and a patient reading it off their
 * phone must never see different things.
 *
 * The one deliberate difference is lead time: the public page refuses anything
 * inside two hours, this does not. Somebody standing at the till asking to be
 * seen in ten minutes is a normal Tuesday, and refusing them because a website
 * rule says so would be the software arguing with reality.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DayPicker } from 'react-day-picker';
import { enGB } from 'date-fns/locale';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import { Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import { getCounterSlots, bookAtCounterAction, type DaySlots } from '../actions';
import 'react-day-picker/style.css';
import 'react-phone-number-input/style.css';

function time(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(iso));
}

function dateKey(day: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: PHARMACY_TIMEZONE,
  }).format(day);
}

const label = 'mb-1.5 block text-[13px] font-medium text-ink-soft';
const input =
  'w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[15px] text-ink outline-none focus:border-brand-400';

export function CounterBookingForm({
  branchId,
  services,
}: {
  branchId: string;
  services: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>();
  const [slot, setSlot] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId) return;
    let live = true;
    setDays(null);
    setSlot(null);
    getCounterSlots(serviceId).then((r) => {
      if (!live) return;
      if (r.ok && r.days) setDays(r.days);
      else setError(r.error ?? 'Could not load times.');
    });
    return () => {
      live = false;
    };
  }, [serviceId]);

  const open = new Set(
    (days ?? []).filter((d) => d.slots.some((s) => s.available)).map((d) => d.date),
  );
  const slotsForDay = selectedDay
    ? (days ?? []).find((d) => d.date === dateKey(selectedDay))?.slots.filter((s) => s.available) ?? []
    : [];

  const phoneValid = !phone || isValidPhoneNumber(phone);
  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSave = Boolean(serviceId && slot && name.trim() && phoneValid && emailValid && !saving);

  async function submit() {
    if (!slot) return;
    setSaving(true);
    setError(null);

    const result = await bookAtCounterAction({
      serviceId,
      branchId,
      startsAt: slot,
      name: name.trim(),
      email: email.trim() || null,
      phone: phone ?? null,
      patientId: null,
      notes: notes.trim() || null,
      sendEmail: sendEmail && Boolean(email.trim()),
    });

    setSaving(false);
    if (!result.ok) setError(result.error ?? 'Could not book that appointment.');
    else router.push('/appointments');
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-[10px] border border-line bg-surface p-5">
        <label className={label} htmlFor="service">Service</label>
        <select
          id="service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          className={input}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="rounded-[10px] border border-line bg-surface p-5">
        <p className={label}>When</p>

        {days === null ? (
          <p className="flex items-center gap-2 py-6 text-[13.5px] text-ink-faint">
            <Loader2 size={14} className="animate-spin" /> Loading available times…
          </p>
        ) : open.size === 0 ? (
          <p className="py-6 text-[13.5px] text-ink-faint">
            No free slots in the next three weeks. Add opening hours in Settings.
          </p>
        ) : (
          <div className="flex flex-wrap gap-5">
            <DayPicker
              mode="single"
              weekStartsOn={1}
              locale={enGB}
              selected={selectedDay}
              onSelect={(d) => {
                setSelectedDay(d);
                setSlot(null);
              }}
              disabled={(d) => !open.has(dateKey(d))}
              className="karsons-calendar"
            />
            <div className="min-w-[180px] flex-1">
              {!selectedDay ? (
                <p className="pt-2 text-[13px] text-ink-faint">Choose a day.</p>
              ) : slotsForDay.length === 0 ? (
                <p className="pt-2 text-[13px] text-ink-faint">Nothing free that day.</p>
              ) : (
                <div className="grid max-h-[250px] grid-cols-3 gap-1.5 overflow-auto pr-1">
                  {slotsForDay.map((s) => (
                    <button
                      key={s.startsAt}
                      type="button"
                      onClick={() => setSlot(s.startsAt)}
                      className={cn(
                        'tabular rounded-[6px] border px-1.5 py-1.5 font-mono text-[12px] transition-colors',
                        slot === s.startsAt
                          ? 'border-brand-600 bg-brand-600 font-semibold text-white'
                          : 'border-line text-ink-soft hover:border-brand-300 hover:text-ink',
                      )}
                    >
                      {time(s.startsAt)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[10px] border border-line bg-surface p-5">
        <p className={label}>Who</p>
        <div className="flex flex-col gap-3.5">
          <div>
            <label className={label} htmlFor="name">Full name</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
              placeholder="As it should appear on the record"
            />
          </div>

          <div className="flex flex-wrap gap-3.5">
            <div className="min-w-[220px] flex-1">
              <label className={label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn(input, !emailValid && 'border-stop-600')}
                placeholder="Optional — needed to send the form link"
              />
              {!emailValid ? (
                <p className="mt-1 text-[12.5px] text-stop-700">
                  That does not look like an email address.
                </p>
              ) : null}
            </div>

            <div className="min-w-[220px] flex-1">
              <label className={label} htmlFor="phone">Phone</label>
              <PhoneInput
                id="phone"
                international
                defaultCountry="IM"
                value={phone}
                onChange={setPhone}
                className={cn('karsons-phone', !phoneValid && 'border-stop-600')}
                placeholder="Optional"
              />
              {!phoneValid ? (
                <p className="mt-1 text-[12.5px] text-stop-700">
                  That number does not look valid.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={input}
              placeholder="Anything the clinician should know before they come in"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-ink-soft">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              disabled={!email.trim()}
              className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
            />
            Email the confirmation and questionnaire link
            {!email.trim() ? (
              <span className="text-ink-faint">— needs an email address</span>
            ) : null}
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/appointments')}
          className="rounded-[7px] border border-line px-4 py-2 text-[13.5px] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={submit}
          className={cn(
            'flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700',
            !canSave && 'cursor-not-allowed opacity-40 hover:bg-brand-600',
          )}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.6} />}
          Book appointment
        </button>
      </div>
    </div>
  );
}
