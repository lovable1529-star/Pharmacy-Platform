/**
 * Cron authorisation.
 *
 * Vercel Cron calls these routes over the public internet, so they must not be
 * open. Vercel sends CRON_SECRET as a bearer token; anything else is refused.
 * Timing-safe comparison, because a scheduled endpoint is a quiet place to
 * brute-force a secret.
 */

import { timingSafeEqual } from 'node:crypto';

export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided.length !== secret.length) return false;

  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}
