import { isDemoMode } from '@/lib/payments/provider';
import { resolveAppUrl } from '@/lib/app-url';
import { PaymentsClient } from './payments-client';

export const dynamic = 'force-dynamic';

export default function PaymentsPage() {
  return (
    <div className="page-shell mx-auto max-w-[calc(900px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight text-ink">Payments</h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          What is owed and what has been settled. A prescription is prepared once
          its payment is received.
        </p>
      </div>

      <PaymentsClient
        demo={isDemoMode()}
        appUrl={resolveAppUrl()}
      />
    </div>
  );
}
