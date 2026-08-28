'use client';

/**
 * Public booking.
 *
 * A month calendar with the closed days greyed out, and times for the one day
 * you pick — rather than every slot for a fortnight rendered as a wall of
 * buttons, which is what this replaced.
 *
 * The calendar is react-day-picker and the phone field is
 * react-phone-number-input. Both are widely used, accessible, and handle the
 * cases a hand-rolled version quietly gets wrong: keyboard navigation, screen
 * reader labelling, month boundaries, and every international dialling format.
 */

import { useEffect, useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import { enGB } from 'date-fns/locale';
import { Check, Loader2, MapPin, ArrowLeft, AlertTriangle, CalendarX2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  getAvailableSlots, bookAppointment,
  type BookingOption, type BranchOption, type DaySlots,
} from './actions';

import 'react-day-picker/style.css';

const PHARMACY_TIMEZONE = 'Europe/Isle_of_Man';

const field =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none';

function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(`${iso}T12:00:00Z`));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: PHARMACY_TIMEZONE,
  }).format(new Date(iso));
}

/** The pharmacy's calendar date for a Date the picker gives us. */
function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function BookingClient({
  services, branches,
}: { services: BookingOption[]; branches: BranchOption[] }) {
  const [serviceId, setServiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [days, setDays] = useState<DaySlots[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>();
  const [slot, setSlot] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState<string | undefined>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; formUrl?: string } | null>(null);

  useEffect(() => {
    if (!serviceId || !branchId) { setDays([]); return; }

    let live = true;
    setLoadingSlots(true);
    setSelectedDay(undefined);
    setSlot(null);

    // Two months ahead, so the calendar can page forward without a second call.
    getAvailableSlots(branchId, serviceId, new Date().toISOString(), 60)
      .then((result) => { if (live) setDays(result); })
      .finally(() => { if (live) setLoadingSlots(false); });

    return () => { live = false; };
  }, [serviceId, branchId]);

  /** Days that actually have a free slot — everything else is disabled. */
  const openDays = useMemo(() => {
    const map = new Map<string, DaySlots>();
    for (const day of days) if (day.slots.length > 0) map.set(day.date, day);
    return map;
  }, [days]);

  const selectableDates = useMemo(
    () => [...openDays.keys()].map((key) => new Date(`${key}T12:00:00Z`)),
    [openDays],
  );

  const selectedSlots = selectedDay ? openDays.get(dateKey(selectedDay))?.slots ?? [] : [];
  const selectedService = services.find((s) => s.serviceId === serviceId);
  const selectedBranch = branches.find((b) => b.id === branchId);

  const phoneValid = !phone || isValidPhoneNumber(phone);
  const canSubmit = Boolean(slot && name.trim() && email.trim() && phoneValid && !busy);

  async function submit() {
    if (!slot) return;
    setBusy(true);
    setError(null);

    const result = await bookAppointment({
      serviceId, branchId, startsAt: slot, name, email, phone: phone ?? '',
    });

    setBusy(false);
    if (result.ok) {
      setDone({ reference: result.reference!, formUrl: result.formUrl });
      return;
    }

    setError(result.error ?? 'Something went wrong.');
    if (result.error?.includes('just took')) {
      setSlot(null);
      getAvailableSlots(branchId, serviceId, new Date().toISOString(), 60).then(setDays);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-safe-100 text-safe-700">
          <Check size={26} strokeWidth={2.4} />
        </div>
        <h1 className="mb-2 text-[24px] text-ink">You are booked in</h1>
        <p className="mb-1 text-[15px] text-ink-soft">
          {selectedService?.serviceName} at {selectedBranch?.name}
        </p>
        <p className="mb-5 text-[16px] font-semibold text-ink">
          {slot ? `${formatLongDate(slot.slice(0, 10))} at ${formatTime(slot)}` : ''}
        </p>
        <p className="mb-6 font-mono text-[13px] text-ink-faint">Reference {done.reference}</p>

        {done.formUrl ? (
          <>
            <p className="mb-3 text-[14px] text-ink-soft">
              Please complete your health questions before you come in — it saves time at the
              counter.
            </p>
            <a
              href={done.formUrl}
              className="inline-block rounded-control bg-brand-600 px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Complete my form
            </a>
          </>
        ) : null}

        <p className="mt-6 text-[13px] text-ink-faint">
          We have emailed your confirmation to {email}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[820px] px-5 py-8">
      <h1 className="mb-1 text-[26px] leading-tight text-ink">Book an appointment</h1>
      <p className="mb-7 text-[14.5px] text-ink-faint">
        No account needed. It takes about a minute.
      </p>

      <Step number={1} title="What do you need?">
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <button
              key={s.serviceId}
              type="button"
              onClick={() => setServiceId(s.serviceId)}
              className={cn(
                'rounded-[9px] border px-4 py-3 text-left transition-colors',
                serviceId === s.serviceId
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-line bg-surface hover:border-brand-300',
              )}
            >
              <span className="block text-[14.5px] font-medium text-ink">{s.serviceName}</span>
            </button>
          ))}
        </div>
      </Step>

      {serviceId ? (
        <Step number={2} title="Which pharmacy?">
          <div className="grid gap-2 sm:grid-cols-2">
            {branches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBranchId(b.id)}
                className={cn(
                  'flex items-start gap-2.5 rounded-[9px] border px-4 py-3 text-left transition-colors',
                  branchId === b.id
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-line bg-surface hover:border-brand-300',
                )}
              >
                <MapPin size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-faint" />
                <span>
                  <span className="block text-[14.5px] font-medium text-ink">{b.name}</span>
                  <span className="block text-[12.5px] text-ink-faint">
                    {[b.town, b.postcode].filter(Boolean).join(' ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Step>
      ) : null}

      {serviceId && branchId ? (
        <Step number={3} title="When suits you?">
          {loadingSlots ? (
            <p className="flex items-center gap-2 py-6 text-[14px] text-ink-faint">
              <Loader2 size={15} className="animate-spin" /> Finding available times…
            </p>
          ) : openDays.size === 0 ? (
            <div className="rounded-[9px] border border-line bg-sunk px-4 py-8 text-center">
              <CalendarX2 size={22} strokeWidth={1.7} className="mx-auto mb-2 text-ink-faint" />
              <p className="text-[14px] font-medium text-ink">No appointments available</p>
              <p className="mt-1 text-[13px] text-ink-faint">
                Nothing free at this branch at the moment. Please give us a ring — we can often fit
                you in.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 rounded-panel border border-line bg-surface shadow-panel p-4 sm:grid-cols-[auto_1fr]">
              <div className="karsons-calendar">
                <DayPicker
                  mode="single"
                  locale={enGB}
                  weekStartsOn={1}
                  selected={selectedDay}
                  onSelect={(day) => { setSelectedDay(day); setSlot(null); }}
                  disabled={(day) => !openDays.has(dateKey(day))}
                  startMonth={new Date()}
                  endMonth={new Date(Date.now() + 70 * 86_400_000)}
                  modifiers={{ open: selectableDates }}
                />
              </div>

              <div className="min-w-0 sm:border-l sm:border-line sm:pl-5">
                {!selectedDay ? (
                  <p className="py-8 text-center text-[13.5px] text-ink-faint">
                    Pick a day to see the available times.
                  </p>
                ) : selectedSlots.length === 0 ? (
                  <p className="py-8 text-center text-[13.5px] text-ink-faint">
                    Nothing free that day.
                  </p>
                ) : (
                  <>
                    <h3 className="mb-2.5 text-[13.5px] font-medium text-ink">
                      {formatLongDate(dateKey(selectedDay))}
                    </h3>
                    <div className="grid max-h-[280px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                      {selectedSlots.map((s) => (
                        <button
                          key={s.startsAt}
                          type="button"
                          onClick={() => setSlot(s.startsAt)}
                          className={cn(
                            'tabular rounded-control border px-2 py-2 font-mono text-[13px] transition-colors',
                            slot === s.startsAt
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink',
                          )}
                        >
                          {formatTime(s.startsAt)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </Step>
      ) : null}

      {slot ? (
        <Step number={4} title="Your details">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-ink">
                Full name
              </label>
              <input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={field}
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={field}
              />
            </div>

            <div>
              <label htmlFor="phone" className="mb-1.5 block text-[13px] font-medium text-ink">
                Phone
              </label>
              <PhoneInput
                id="phone"
                international
                defaultCountry="IM"
                countryCallingCodeEditable={false}
                value={phone}
                onChange={setPhone}
                className="karsons-phone"
              />
              {phone && !phoneValid ? (
                <p className="mt-1.5 text-[12.5px] text-review-700">
                  That number does not look complete.
                </p>
              ) : null}
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-[13.5px] text-stop-700">
              <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSlot(null)}
              className="flex items-center gap-1.5 text-[13.5px] text-ink-faint transition-colors hover:text-ink"
            >
              <ArrowLeft size={14} strokeWidth={2} /> Choose a different time
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center gap-2 rounded-control px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
                canSubmit ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-ink-faint',
              )}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              Confirm booking
            </button>
          </div>
        </Step>
      ) : null}
    </div>
  );
}

function Step({
  number, title, children,
}: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-brand-100 font-mono text-[11px] font-medium text-brand-700">
          {number}
        </span>
        <h2 className="font-display text-[16px] font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}
