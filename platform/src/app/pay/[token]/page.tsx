/**
 * The payment page a patient reaches from their approval email.
 *
 * The token in the link is the credential — same reasoning as the questionnaire:
 * no account, so the link has to be unguessable and scoped to one invoice.
 *
 * In demonstration mode this page takes NO card details of any kind. It states
 * plainly that no money moves and offers a button that marks the invoice paid.
 * A convincing fake card form would be the wrong thing to build even for a
 * demo — it teaches staff to trust a screen that is lying, and it is a page
 * that would function as the real thing if it ever escaped.
 */

import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { payment, organisation, service, submission } from '@/lib/db/schema';
import { formatMoney, isDemoMode } from '@/lib/payments/provider';
import { PayClient } from './pay-client';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [row] = await db
    .select({
      id: payment.id,
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: payment.description,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
      provider: payment.provider,
      organisationName: organisation.name,
      serviceName: service.name,
    })
    .from(payment)
    .innerJoin(organisation, eq(payment.organisationId, organisation.id))
    .leftJoin(submission, eq(payment.submissionId, submission.id))
    .leftJoin(service, eq(submission.serviceId, service.id))
    .where(eq(payment.accessToken, token))
    .limit(1);

  if (!row) notFound();

  const expired = Boolean(row.expiresAt && row.expiresAt.getTime() <= Date.now());
  const demo = isDemoMode();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[640px] items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 font-display text-[14px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-ink">
              {row.organisationName}
            </div>
            <div className="text-[12.5px] text-ink-faint">Payment</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-5 py-10">
        {row.status === 'PAID' ? (
          <div className="rounded-panel border border-safe-200 bg-safe-50 px-6 py-8 text-center">
            <h1 className="font-display text-[22px] font-semibold text-safe-700">
              Already paid
            </h1>
            <p className="mt-2 text-[14.5px] text-ink-soft">
              We received {formatMoney(row.amountMinor, row.currency)} for{' '}
              {row.description}. Your prescription is being prepared — there is
              nothing more to do.
            </p>
          </div>
        ) : row.status === 'CANCELLED' ? (
          <div className="rounded-panel border border-line bg-surface shadow-panel px-6 py-8 text-center">
            <h1 className="font-display text-[22px] font-semibold text-ink">
              This request was cancelled
            </h1>
            <p className="mt-2 text-[14.5px] text-ink-soft">
              Please call the pharmacy if you think that is wrong.
            </p>
          </div>
        ) : expired ? (
          <div className="rounded-panel border border-review-200 bg-review-50 px-6 py-8 text-center">
            <h1 className="font-display text-[22px] font-semibold text-review-700">
              This link has expired
            </h1>
            <p className="mt-2 text-[14.5px] text-ink-soft">
              Please call the pharmacy and we will send you a new one.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
              <div className="border-b border-line px-6 py-5">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
                  Amount due
                </p>
                <p className="tabular mt-1 font-display text-[34px] font-bold leading-none text-ink">
                  {formatMoney(row.amountMinor, row.currency)}
                </p>
                <p className="mt-2 text-[14.5px] text-ink-soft">{row.description}</p>
                {row.serviceName ? (
                  <p className="mt-0.5 text-[13px] text-ink-faint">{row.serviceName}</p>
                ) : null}
              </div>

              <div className="px-6 py-5">
                <PayClient paymentId={row.id} token={token} demo={demo} />
              </div>
            </div>

            <p className="mt-4 text-center text-[12.5px] text-ink-faint">
              Your prescription is prepared once payment is received. If you would
              rather pay at the counter, call the pharmacy and we will note it.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
