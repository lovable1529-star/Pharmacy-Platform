import 'server-only';

/**
 * One queue for everything the system sends.
 *
 * His briefs ask for three channels: email today, WhatsApp alerts to the
 * pharmacist on a new repeat request, and SMS reminders to patients. Only email
 * has credentials.
 *
 * The tempting shortcut is to send email directly now and add the others later.
 * That produces call sites which each know how to talk to a provider, and
 * retrofitting a second channel means touching every one of them.
 *
 * So everything is queued first and a channel adapter drains it. Three things
 * follow from that, all of which matter more than the indirection costs:
 *
 *   · A channel with no credentials queues as UNAVAILABLE rather than throwing.
 *     The message is still on record — visible, countable, and sendable the
 *     moment a key is added — instead of vanishing into a caught exception.
 *   · A send that fails is retried with its error recorded, rather than lost
 *     because the request that triggered it has already returned.
 *   · "Did the patient get their reminder?" becomes a query rather than a
 *     search through provider logs.
 *
 * Claiming is done with a conditional UPDATE, so two overlapping cron runs
 * cannot both send the same message.
 */

import { and, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { notification } from '@/lib/db/schema';
import { sendPatientEmail } from '@/lib/email/patient';

export type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export interface QueueInput {
  organisationId: string;
  channel: Channel;
  recipient: string;
  template: string;
  subject?: string | null;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  scheduledFor?: Date;
}

/** How many times a message is retried before it is left alone. */
const MAX_ATTEMPTS = 4;

export async function queueNotification(input: QueueInput): Promise<string | null> {
  const recipient = input.recipient.trim();
  if (!recipient) return null;

  const [row] = await db
    .insert(notification)
    .values({
      organisationId: input.organisationId,
      channel: input.channel,
      recipient,
      template: input.template,
      subject: input.subject ?? null,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      scheduledFor: input.scheduledFor ?? new Date(),
    })
    .returning({ id: notification.id });

  return row?.id ?? null;
}

// ─────────────────────────────────────────────────────────────
// Channel adapters
// ─────────────────────────────────────────────────────────────

interface DeliveryResult {
  ok: boolean;
  error?: string;
  /** The channel exists but is not configured — not a failure to retry. */
  unavailable?: boolean;
}

async function deliverEmail(
  recipient: string,
  subject: string | null,
  body: string,
): Promise<DeliveryResult> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, unavailable: true, error: 'RESEND_API_KEY is not set.' };
  }

  const result = await sendPatientEmail(recipient, {
    subject: subject ?? 'Karsons Pharmacy',
    html: body,
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * SMS and WhatsApp both go through Twilio and neither has credentials yet.
 *
 * Returning `unavailable` rather than throwing is deliberate: the message stays
 * in the outbox marked UNAVAILABLE, so the pharmacy can see exactly what would
 * have been sent, and adding the credentials makes those messages sendable
 * rather than lost. The alternative — silently dropping them — is the failure
 * mode this whole module exists to avoid.
 */
async function deliverTwilio(
  channel: 'SMS' | 'WHATSAPP',
  recipient: string,
  body: string,
): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from =
    channel === 'WHATSAPP'
      ? process.env.TWILIO_WHATSAPP_FROM
      : process.env.TWILIO_SMS_FROM;

  if (!sid || !token || !from) {
    return {
      ok: false,
      unavailable: true,
      error: `${channel} is not configured — Twilio credentials are not set.`,
    };
  }

  const to = channel === 'WHATSAPP' ? `whatsapp:${recipient}` : recipient;
  const fromAddress = channel === 'WHATSAPP' ? `whatsapp:${from}` : from;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: fromAddress, Body: body }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `Twilio ${response.status}: ${text.slice(0, 300)}` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Twilio request failed.',
    };
  }
}

async function deliver(row: {
  channel: Channel;
  recipient: string;
  subject: string | null;
  body: string;
}): Promise<DeliveryResult> {
  switch (row.channel) {
    case 'EMAIL':
      return deliverEmail(row.recipient, row.subject, row.body);
    case 'SMS':
    case 'WHATSAPP':
      return deliverTwilio(row.channel, row.recipient, row.body);
    default:
      return { ok: false, error: 'Unknown channel.' };
  }
}

// ─────────────────────────────────────────────────────────────

export interface DrainSummary {
  claimed: number;
  sent: number;
  failed: number;
  unavailable: number;
}

/**
 * Send what is due.
 *
 * Each message is claimed with a conditional update before any provider is
 * called, so two overlapping cron runs cannot both send it — the second finds
 * nothing to claim and moves on.
 */
export async function drainOutbox(limit = 50): Promise<DrainSummary> {
  const due = await db
    .select({
      id: notification.id,
      channel: notification.channel,
      recipient: notification.recipient,
      subject: notification.subject,
      body: notification.body,
      attempts: notification.attempts,
    })
    .from(notification)
    .where(
      and(
        eq(notification.status, 'QUEUED'),
        lte(notification.scheduledFor, new Date()),
      ),
    )
    .orderBy(notification.scheduledFor)
    .limit(limit);

  const summary: DrainSummary = { claimed: 0, sent: 0, failed: 0, unavailable: 0 };

  for (const row of due) {
    const [claimed] = await db
      .update(notification)
      .set({ status: 'SENDING', attempts: sql`${notification.attempts} + 1` })
      .where(and(eq(notification.id, row.id), eq(notification.status, 'QUEUED')))
      .returning({ id: notification.id });

    // Somebody else got there first.
    if (!claimed) continue;
    summary.claimed += 1;

    const result = await deliver(row);

    if (result.ok) {
      await db
        .update(notification)
        .set({ status: 'SENT', sentAt: new Date(), lastError: null })
        .where(eq(notification.id, row.id));
      summary.sent += 1;
      continue;
    }

    if (result.unavailable) {
      await db
        .update(notification)
        .set({ status: 'UNAVAILABLE', lastError: result.error ?? null })
        .where(eq(notification.id, row.id));
      summary.unavailable += 1;
      continue;
    }

    // Retry until the ceiling, then stop and leave the error visible.
    const exhausted = row.attempts + 1 >= MAX_ATTEMPTS;
    await db
      .update(notification)
      .set({
        status: exhausted ? 'FAILED' : 'QUEUED',
        lastError: result.error ?? 'Delivery failed.',
        // Back off so a provider outage is not hammered.
        scheduledFor: exhausted
          ? new Date()
          : new Date(Date.now() + (row.attempts + 1) * 15 * 60_000),
      })
      .where(eq(notification.id, row.id));

    summary.failed += 1;
  }

  return summary;
}

/** Re-queue everything that was parked for a channel that had no credentials. */
export async function retryUnavailable(channel: Channel): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ status: 'QUEUED', attempts: 0, lastError: null, scheduledFor: new Date() })
    .where(
      and(eq(notification.status, 'UNAVAILABLE'), eq(notification.channel, channel)),
    )
    .returning({ id: notification.id });

  return rows.length;
}
