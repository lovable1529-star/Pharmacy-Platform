import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getCounterBookingOptions } from '../actions';
import { CounterBookingForm } from './counter-booking-form';

export const dynamic = 'force-dynamic';

export default async function NewAppointmentPage() {
  const options = await getCounterBookingOptions();

  return (
    <div className="mx-auto max-w-[760px] px-6 py-8">
      <Link
        href="/appointments"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint hover:text-ink"
      >
        <ArrowLeft size={13} />
        Appointments
      </Link>

      <h1 className="text-[28px] leading-tight text-ink">Book an appointment</h1>
      <p className="mb-6 mt-1 text-[14px] text-ink-faint">
        {options.branchName
          ? `Booking at ${options.branchName}. The patient gets their questionnaire link by email.`
          : 'Booking from the counter.'}
      </p>

      {!options.ok || !options.services || !options.branchId ? (
        <div className="rounded-[10px] border border-stop-200 bg-stop-50 px-4 py-3 text-[13.5px] text-stop-700">
          {options.error ?? 'Could not load services.'}
        </div>
      ) : options.services.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-[15px] font-medium text-ink">No services offered here</p>
          <p className="mt-1 text-[13.5px] text-ink-faint">
            Add one in{' '}
            <Link href="/services" className="text-brand-700 underline">Services</Link>.
          </p>
        </div>
      ) : (
        <CounterBookingForm branchId={options.branchId} services={options.services} />
      )}
    </div>
  );
}
