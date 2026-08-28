/**
 * Public booking page.
 *
 * Reached from a link on the pharmacy website or a QR code on the counter.
 * Walk-ins never come through here — they complete the form directly.
 */

import { getBookingOptions } from './actions';
import { BookingClient } from './booking-client';

export const dynamic = 'force-dynamic';

export default async function BookPage() {
  const { services, branches } = await getBookingOptions();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[720px] items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 font-display text-[14px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-ink">Karsons Pharmacy</div>
            <div className="text-[12.5px] text-ink-faint">Book an appointment</div>
          </div>
        </div>
      </header>

      <BookingClient services={services} branches={branches} />

      <footer className="mx-auto max-w-[720px] px-5 pb-12 text-center">
        <p className="text-[12.5px] text-ink-faint">
          Prefer to walk in? You are welcome to — just ask at the counter and we will get you
          started on a tablet.
        </p>
      </footer>
    </div>
  );
}
