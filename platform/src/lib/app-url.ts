/**
 * Where this deployment lives.
 *
 * Every patient-facing link the system generates is built from this: booking
 * confirmations, questionnaire resume links, payment links, staff invitations,
 * appointment reminders. Get it wrong and none of them error — they simply
 * point somewhere the recipient cannot reach, and you find out when someone
 * clicks one.
 *
 * That is exactly what happened: eight call sites each wrote
 *
 *     process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100'
 *
 * so a deployment without that variable set silently sent real patients to
 * localhost. The fallback was written for local development and inherited by
 * production.
 *
 * Vercel already knows its own address, so ask it before giving up:
 *
 *   1. NEXT_PUBLIC_APP_URL   — explicit, and the only one that can name a
 *                              custom domain, so it always wins.
 *   2. Vercel's own URL      — correct-by-default on any deployment. In
 *                              production that is the project's stable domain;
 *                              on a preview it is that preview's own URL, so
 *                              links stay inside the deployment that made them.
 *   3. localhost             — development, where it is actually true.
 *
 * Server-side only. All of these are read at runtime except
 * NEXT_PUBLIC_APP_URL, which Next inlines at build time — which is why setting
 * it in Vercel takes effect on the next deploy rather than immediately.
 */

/** Trailing slashes produce `https://host//book`, which some routers 404. */
function clean(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && explicit.trim()) return clean(explicit);

  // Vercel supplies these without a protocol.
  const host =
    process.env.VERCEL_ENV === 'production'
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : process.env.VERCEL_URL;

  if (host && host.trim()) return `https://${clean(host)}`;

  return 'http://localhost:3100';
}
