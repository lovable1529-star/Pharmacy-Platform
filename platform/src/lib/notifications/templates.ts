/**
 * Message wording, as records — §15.
 *
 * The six triggers the specification lists were strings in the source, so
 * changing "your appointment tomorrow" to something warmer was a deploy. They
 * are rows now, editable, keyed by a stable identifier so a rewording never
 * breaks a send.
 *
 * The important column is `clinical_detail_allowed`, and it is a property of
 * the MESSAGE rather than of the sender. §15 asks that SMS carry no clinical
 * detail and prompt a secure login instead, and a rule held only in the sending
 * code stops being true the moment a second sender exists. Here, a template
 * that is not allowed clinical detail cannot be given any: the substitution
 * refuses the values rather than trusting the caller to have left them out.
 */

import { and, eq } from 'drizzle-orm';
import type { Reader } from '@/lib/actions';
import { notificationTemplate } from '@/lib/db/schema';

export type Channel = 'EMAIL' | 'SMS';

export interface Template {
  key: string;
  channel: Channel;
  subject: string | null;
  body: string;
  clinicalDetailAllowed: boolean;
}

/**
 * Values a template may refer to as `{name}`.
 *
 * Split deliberately. `safe` is anything that could appear on an envelope — a
 * first name, a branch, a date. `clinical` is everything else, and a template
 * without permission never sees it.
 */
export interface Substitutions {
  safe: Record<string, string>;
  clinical?: Record<string, string>;
}

/** The wording used when nothing has been configured yet. */
const FALLBACKS: Record<string, { subject: string | null; body: string; clinical: boolean }> = {
  'appointment.submitted': {
    subject: 'We have your form',
    body: 'Thank you — we have received your form. We will be in touch if we need anything else.',
    clinical: true,
  },
  'appointment.approved': {
    subject: 'Your request has been approved',
    body: 'Your request has been approved. Please follow the link in this email to continue.',
    clinical: true,
  },
  'appointment.rejected': {
    subject: 'About your recent request',
    body: 'We are not able to proceed with your request on this occasion. Please book an appointment so we can talk it through.',
    clinical: true,
  },
  'appointment.info_requested': {
    subject: 'We need a little more information',
    body: 'We need one more answer before we can continue. Please follow the link to complete your form.',
    clinical: true,
  },
  'appointment.reminder': {
    subject: 'Your appointment tomorrow',
    body: 'This is a reminder about your appointment tomorrow.',
    clinical: true,
  },
  'prescription.ready': {
    subject: 'Ready to collect',
    body: 'Your prescription is ready to collect from the pharmacy.',
    clinical: true,
  },
  'appointment.status_changed': {
    subject: null,
    body: 'Karsons Pharmacy: there is an update on your recent request. Please log in to view it securely.',
    clinical: false,
  },
};

/**
 * Load a template, falling back to the built-in wording.
 *
 * The fallback matters during the migration and afterwards: a template row
 * deleted by accident must not stop a patient being told their prescription is
 * ready. SMS falls back to something deliberately contentless.
 */
export async function loadTemplate(
  tx: Reader,
  organisationId: string,
  key: string,
  channel: Channel,
): Promise<Template> {
  const [row] = await tx
    .select({
      key: notificationTemplate.templateKey,
      channel: notificationTemplate.channel,
      subject: notificationTemplate.subject,
      body: notificationTemplate.body,
      clinicalDetailAllowed: notificationTemplate.clinicalDetailAllowed,
      active: notificationTemplate.active,
    })
    .from(notificationTemplate)
    .where(
      and(
        eq(notificationTemplate.organisationId, organisationId),
        eq(notificationTemplate.templateKey, key),
        eq(notificationTemplate.channel, channel),
        eq(notificationTemplate.active, true),
      ),
    )
    .limit(1);

  if (row) {
    return {
      key: row.key,
      channel: channel,
      subject: row.subject,
      body: row.body,
      clinicalDetailAllowed: row.clinicalDetailAllowed,
    };
  }

  const fallback = FALLBACKS[key];
  if (fallback) {
    return {
      key,
      channel,
      subject: channel === 'SMS' ? null : fallback.subject,
      // An SMS falling back must not inherit email wording that assumes a link
      // and a subject line.
      body: channel === 'SMS' && fallback.clinical
        ? 'Karsons Pharmacy: there is an update on your recent request. Please log in to view it securely.'
        : fallback.body,
      clinicalDetailAllowed: channel === 'SMS' ? false : fallback.clinical,
    };
  }

  return {
    key,
    channel,
    subject: channel === 'SMS' ? null : 'A message from Karsons Pharmacy',
    body: 'Please contact the pharmacy.',
    clinicalDetailAllowed: false,
  };
}

/**
 * Fill `{placeholders}`.
 *
 * A template without permission for clinical detail never receives it — the
 * clinical values are simply not in the substitution set, so a placeholder
 * referring to one is left visibly unfilled rather than silently populated.
 * That is the safe failure: a message reading "{medicine}" is obviously wrong
 * and gets fixed; a text message naming somebody's weight-loss medication is
 * a disclosure nobody notices.
 */
export function render(template: Template, values: Substitutions): string {
  const available = template.clinicalDetailAllowed
    ? { ...values.safe, ...(values.clinical ?? {}) }
    : values.safe;

  return template.body.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(available, name) ? available[name]! : whole,
  );
}

/** Whether a rendered message still has unfilled placeholders. */
export function hasUnfilled(rendered: string): boolean {
  return /\{\w+\}/.test(rendered);
}

/**
 * The finished message body, with the leaflet block attached or withheld.
 *
 * Extracted from `queueFromTemplate` so the rule can be tested. It was one
 * line inside a database-bound function, which meant the property it enforces
 * — that a text message never carries a link naming somebody's weight-loss
 * medication — had nothing pinning it. Flipping that ternary would have broken
 * a disclosure rule and passed every test in the suite.
 *
 * The appendix is held to exactly the same standard as a clinical
 * substitution, and for the same reason: a link reading "How to inject your
 * Mounjaro" names the medicine as surely as a `{medicine}` token would. A
 * template not permitted clinical detail never receives it, whatever the
 * caller passes in.
 */
export function composeBody(
  rendered: string,
  appendix: string | null | undefined,
  clinicalDetailAllowed: boolean,
): string {
  const trimmed = clinicalDetailAllowed ? appendix?.trim() : null;
  return trimmed ? `${rendered}\n${trimmed}` : rendered;
}
