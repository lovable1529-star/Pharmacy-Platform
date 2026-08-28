import { isDemoMode } from '@/lib/payments/provider';
import { PaymentsClient } from './payments-client';

export const dynamic = 'force-dynamic';

export default function PaymentsPage() {
  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight text-ink">Payments</h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          What is owed and what has been settled. A prescription is prepared once
          its payment is received.
        </p>
      </div>

      <PaymentsClient
        demo={isDemoMode()}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100'}
      />
    </div>
  );
}
