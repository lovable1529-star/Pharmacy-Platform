import 'server-only';

/**
 * Taking payment.
 *
 * His GLP-1 flow gates the prescription on it: "GREEN/approved AMBER → secure
 * payment link sent. Rx generated after payment." The gate is the point —
 * without it the pharmacy supplies first and chases later.
 *
 * Two providers, one interface:
 *
 *   DEMO       marks an invoice paid on request. It is a stub and it is an
 *              HONEST one — it collects no card details, moves no money, and
 *              the page it drives says on its face that it is a demonstration.
 *              A screen that imitated a real card form would be indefensible
 *              even in a demo, and it would teach staff the wrong thing.
 *   STRIPE     the real one, once keys exist. Same table, same states, same
 *              transition to PAID — so swapping providers is configuration
 *              rather than a rewrite of the flow.
 *   IN_PERSON  paid at the till. Recorded by staff, no link involved, because
 *              his brief offers "pay online, pay on collection in the pharmacy".
 *
 * DEMO is a value in the provider enum rather than a boolean flag, so a
 * demonstration payment can never be quietly counted as real money in a report.
 */

import { randomBytes } from 'node:crypto';

/**
 * How a payment was settled.
 *
 * MANUAL is deliberately distinct from IN_PERSON. IN_PERSON is money handed
 * over at the counter; MANUAL is a member of staff asserting the money arrived
 * by some route the system does not see, which is the whole of this phase.
 * Collapsing them would make a later reconciliation unable to tell which was
 * which.
 */
export type PaymentProvider = 'DEMO' | 'STRIPE' | 'IN_PERSON' | 'MANUAL';

/** How long a payment link stays live before the patient must ask again. */
export const PAYMENT_WINDOW_DAYS = 14;

export function generatePaymentToken(): string {
  return randomBytes(32).toString('base64url');
}

export function paymentExpiry(from: Date = new Date()): Date {
  const expires = new Date(from);
  expires.setDate(expires.getDate() + PAYMENT_WINDOW_DAYS);
  return expires;
}

/**
 * Which provider is in use.
 *
 * Falls back to DEMO rather than throwing when Stripe is unconfigured, so the
 * workflow is complete and demonstrable before the keys exist. The page makes
 * the mode obvious, so falling back cannot be mistaken for working.
 */
export function activeProvider(): PaymentProvider {
  return process.env.STRIPE_SECRET_KEY ? 'STRIPE' : 'DEMO';
}

export function isDemoMode(): boolean {
  return activeProvider() === 'DEMO';
}

/** £185.00 from 18500. Formatting money is not the place for improvisation. */
export function formatMoney(amountMinor: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100);
}

export function buildPaymentUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/pay/${encodeURIComponent(token)}`;
}
