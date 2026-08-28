import 'server-only';

/**
 * Telling the pharmacy something needs a person.
 *
 * From his weight-management SOW, verbatim: "Email + WhatsApp alert to
 * pharmacist: 'New repeat request from [Patient Name]'. Include summary (drug,
 * dose, weight, requested supply)."
 *
 * And from the GLP-1 scope, the reason it matters: a RED outcome should trigger
 * a phone call, not sit in a queue until somebody looks. An alert that arrives
 * where the pharmacist already is beats one that requires them to check a
 * screen they may not open for hours.
 *
 * Routed to the branch's own prescription mailbox where one exists, because a
 * request for the Kirk Michael counter should not land only at Onchan.
 *
 * Everything goes through the outbox, so WhatsApp queues as UNAVAILABLE until
 * Twilio credentials exist rather than being silently dropped — and the moment
 * they are added, the backlog can be sent.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { branch, organisation } from '@/lib/db/schema';
import { queueNotification } from '@/lib/notifications/outbox';
import type { Answers } from '@/types/form-schema';
import { resolveAppUrl } from '@/lib/app-url';

export interface AlertInput {
  organisationId: string;
  branchId: string | null;
  submissionId: string;
  patientName: string;
  serviceName: string;
  serviceKind: string;
  outcome: string | null;
  answers: Answers;
}

/** Values worth putting in a two-line alert, in the order a pharmacist reads. */
const SUMMARY_FIELDS: { key: string; label: string }[] = [
  { key: 'currentMedicine', label: 'Medicine' },
  { key: 'medicine', label: 'Medicine' },
  { key: 'currentStrength', label: 'Current strength' },
  { key: 'requestedDose', label: 'Dose request' },
  { key: 'supplyLength', label: 'Supply' },
  { key: 'requestedDuration', label: 'Supply' },
  { key: 'weight', label: 'Weight' },
  { key: 'adverseEffects', label: 'Adverse effects' },
  { key: 'missedDoses', label: 'Missed doses' },
];

function readable(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : null;

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('raw' in record && 'unit' in record) return `${record.raw} ${record.unit}`;
    if ('si' in record) return String(record.si);
    return null;
  }
  return String(value);
}

function summarise(answers: Answers): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const field of SUMMARY_FIELDS) {
    if (seen.has(field.label)) continue;
    const value = readable(answers[field.key]);
    if (!value) continue;
    seen.add(field.label);
    lines.push(`${field.label}: ${value}`);
  }

  return lines;
}

export async function alertPharmacist(input: AlertInput): Promise<void> {
  // Only where a person is actually needed. Alerting on every GREEN vaccination
  // trains staff to ignore the channel, which is worse than not having it.
  const needsAttention =
    input.outcome === 'AMBER' ||
    input.outcome === 'RED' ||
    input.serviceKind === 'REPEAT_SUPPLY';

  if (!needsAttention) return;

  const [org] = await db
    .select({ name: organisation.name })
    .from(organisation)
    .where(eq(organisation.id, input.organisationId))
    .limit(1);

  let recipientEmail: string | null = null;
  let alertPhone: string | null = null;

  if (input.branchId) {
    const [b] = await db
      .select({ inboxEmail: branch.inboxEmail, phone: branch.phone })
      .from(branch)
      .where(eq(branch.id, input.branchId))
      .limit(1);

    recipientEmail = b?.inboxEmail ?? null;
    alertPhone = b?.phone ?? null;
  }

  // His GLP-1 scope names this address for AMBER and RED specifically.
  recipientEmail = recipientEmail ?? process.env.CLINIC_ALERT_EMAIL ?? null;
  alertPhone = process.env.PHARMACIST_WHATSAPP_TO ?? alertPhone;

  const urgency = input.outcome === 'RED' ? 'URGENT — ' : '';
  const summary = summarise(input.answers);

  const subject =
    `${urgency}New ${input.serviceName} request from ${input.patientName}` +
    (input.outcome ? ` (${input.outcome})` : '');

  const appUrl = resolveAppUrl();
  const link = `${appUrl}/consultations/${input.submissionId}`;

  if (recipientEmail) {
    await queueNotification({
      organisationId: input.organisationId,
      channel: 'EMAIL',
      recipient: recipientEmail,
      template: 'pharmacist_alert',
      subject,
      body: `
        <p><strong>${input.patientName}</strong> has submitted a
        ${input.serviceName} request${input.outcome ? ` — <strong>${input.outcome}</strong>` : ''}.</p>
        ${
          summary.length
            ? `<ul>${summary.map((l) => `<li>${l}</li>`).join('')}</ul>`
            : ''
        }
        ${
          input.outcome === 'RED'
            ? '<p style="color:#A32E22;"><strong>This was blocked on safety grounds. Please call the patient.</strong></p>'
            : ''
        }
        <p><a href="${link}">Open the record</a></p>
        <p style="color:#7C7594;font-size:12px;">${org?.name ?? 'Karsons Pharmacy'}</p>`,
      entityType: 'submission',
      entityId: input.submissionId,
    });
  }

  if (alertPhone) {
    await queueNotification({
      organisationId: input.organisationId,
      channel: 'WHATSAPP',
      recipient: alertPhone,
      template: 'pharmacist_alert',
      body:
        `${urgency}New ${input.serviceName} request from ${input.patientName}` +
        (input.outcome ? ` (${input.outcome})` : '') +
        (summary.length ? `\n${summary.join('\n')}` : '') +
        `\n${link}`,
      entityType: 'submission',
      entityId: input.submissionId,
    });
  }
}
