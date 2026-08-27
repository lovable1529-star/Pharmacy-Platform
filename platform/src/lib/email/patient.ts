/**
 * Patient-facing emails.
 *
 * Different rules apply here than to the GP and internal messages:
 *
 * · No clinical detail beyond what the patient already told us. These land in
 *   personal inboxes, get forwarded, and appear on lock screens.
 * · Never a dose recommendation. A patient sees status, and the reason to speak
 *   to a pharmacist — never "increase to 5mg". That is the line that keeps this
 *   outside medical device territory, and it holds in email as much as on screen.
 * · Every message says what happens next. An email that reports a decision and
 *   leaves the reader wondering what to do is a phone call the pharmacy has to
 *   take.
 *
 * Templates are data rather than code so wording can move into configuration
 * later without touching the sending path.
 */

import type { SendResult } from './send';

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(heading: string, body: string, footer?: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F6F5F9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#191428;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #DEDAE9;border-radius:10px;overflow:hidden;">
    <div style="padding:18px 22px;border-bottom:1px solid #DEDAE9;">
      <div style="font-size:15px;font-weight:700;color:#5B3A8E;">Karsons Pharmacy</div>
      <div style="font-size:12px;color:#7C7594;margin-top:2px;">${escape(heading)}</div>
    </div>
    <div style="padding:22px;font-size:14.5px;line-height:1.6;">${body}</div>
    <div style="padding:14px 22px;border-top:1px solid #DEDAE9;font-size:11.5px;color:#7C7594;">
      ${footer ?? 'If anything in this message is unexpected, please contact the pharmacy.'}
    </div>
  </div>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0;">
    <a href="${escape(href)}" style="display:inline-block;background:#5B3A8E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:600;font-size:14px;">
      ${escape(label)}
    </a>
  </p>`;
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}

export interface PatientEmail {
  subject: string;
  html: string;
}

export interface BranchDetails {
  name: string;
  addressLine1: string | null;
  town: string | null;
  postcode: string | null;
  phone: string | null;
}

function branchBlock(branch: BranchDetails): string {
  const address = [branch.addressLine1, branch.town, branch.postcode].filter(Boolean).join(', ');
  return `<div style="background:#F3F1F9;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:13.5px;">
    <strong style="display:block;margin-bottom:3px;">Karsons Pharmacy, ${escape(branch.name)}</strong>
    ${address ? `<span style="color:#544D6B;">${escape(address)}</span><br />` : ''}
    ${branch.phone ? `<span style="color:#544D6B;">${escape(branch.phone)}</span>` : ''}
  </div>`;
}

// ─────────────────────────────────────────────────────────────

export function bookingConfirmation(input: {
  patientName: string;
  serviceName: string;
  startsAt: Date;
  reference: string;
  branch: BranchDetails;
  formUrl?: string | null;
}): PatientEmail {
  const when = formatWhen(input.startsAt);

  return {
    subject: `Your ${input.serviceName} appointment — ${when}`,
    html: shell(
      'Appointment confirmed',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 6px;">Your appointment is booked for:</p>
       <p style="margin:0 0 4px;font-size:17px;font-weight:600;">${escape(when)}</p>
       <p style="margin:0 0 14px;color:#544D6B;">${escape(input.serviceName)}</p>
       ${branchBlock(input.branch)}
       ${
         input.formUrl
           ? `<p style="margin:0 0 4px;"><strong>Please complete your form before you come in.</strong></p>
              <p style="margin:0;color:#544D6B;">It takes a few minutes and saves you filling it in at the counter.</p>
              ${button(input.formUrl, 'Complete my form')}`
           : ''
       }
       <p style="margin:16px 0 0;color:#544D6B;font-size:13px;">
         Your reference is <strong>${escape(input.reference)}</strong>. Quote it if you need to
         change or cancel — just give us a ring.
       </p>`,
    ),
  };
}

export function appointmentReminder(input: {
  patientName: string;
  serviceName: string;
  startsAt: Date;
  branch: BranchDetails;
  formUrl?: string | null;
  formCompleted: boolean;
}): PatientEmail {
  return {
    subject: `Reminder — your appointment ${formatWhen(input.startsAt)}`,
    html: shell(
      'Appointment reminder',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 6px;">A reminder that we will see you:</p>
       <p style="margin:0 0 4px;font-size:17px;font-weight:600;">${escape(formatWhen(input.startsAt))}</p>
       <p style="margin:0 0 14px;color:#544D6B;">${escape(input.serviceName)}</p>
       ${branchBlock(input.branch)}
       ${
         input.formCompleted
           ? `<p style="margin:0;color:#544D6B;">Your form is already complete — there is nothing else to do before you arrive.</p>`
           : input.formUrl
             ? `<p style="margin:0 0 4px;"><strong>Your form is not completed yet.</strong></p>
                <p style="margin:0;color:#544D6B;">Filling it in now means less time at the counter.</p>
                ${button(input.formUrl, 'Complete my form')}`
             : ''
       }`,
    ),
  };
}

export function formInvitation(input: {
  patientName: string;
  serviceName: string;
  formUrl: string;
  minutes?: number;
}): PatientEmail {
  return {
    subject: `Please complete your ${input.serviceName} form`,
    html: shell(
      'Before your appointment',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 8px;">
         Please complete your ${escape(input.serviceName)} questionnaire before you come in.
         ${input.minutes ? `It takes about ${input.minutes} minutes.` : ''}
       </p>
       ${button(input.formUrl, 'Complete my form')}
       <p style="margin:16px 0 0;color:#544D6B;font-size:13px;">
         You do not need an account or a password — the link opens straight onto the form.
       </p>`,
    ),
  };
}

/**
 * A repeat request that cleared. Note what is absent: no dose, no strength, no
 * clinical instruction. The patient is told the request was accepted and what to
 * do next, nothing more.
 */
export function repeatApproved(input: {
  patientName: string;
  branch: BranchDetails;
  paymentUrl?: string | null;
  advice?: string[];
}): PatientEmail {
  return {
    subject: 'Your repeat request has been approved',
    html: shell(
      'Repeat request approved',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 8px;">
         Good news — a pharmacist has reviewed your request and it has been approved.
       </p>
       ${
         input.paymentUrl
           ? `<p style="margin:0 0 4px;">The last step is payment. Once that clears, your
                prescription is prepared and ready to collect.</p>
              ${button(input.paymentUrl, 'Pay for my prescription')}`
           : `<p style="margin:0 0 8px;">You can pay when you collect.</p>`
       }
       ${branchBlock(input.branch)}
       ${
         input.advice?.length
           ? `<p style="margin:0 0 6px;font-weight:600;">While you are here</p>
              <ul style="margin:0;padding-left:18px;color:#544D6B;">
                ${input.advice.map((a) => `<li style="margin-bottom:5px;">${escape(a)}</li>`).join('')}
              </ul>`
           : ''
       }
       <p style="margin:18px 0 0;color:#544D6B;font-size:13px;">
         If anything about your treatment has changed since you filled in the form, please tell us
         before you collect.
       </p>`,
    ),
  };
}

export function repeatRejected(input: {
  patientName: string;
  reason: string;
  bookingUrl: string;
  branch: BranchDetails;
}): PatientEmail {
  return {
    subject: 'About your repeat request',
    html: shell(
      'We need to see you first',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 12px;">
         A pharmacist has reviewed your request and we are not able to supply it online this time.
       </p>
       <div style="background:#F8EEDA;border:1px solid #F0DCB4;border-radius:8px;padding:13px 15px;margin:0 0 16px;font-size:13.5px;color:#8A5A0B;">
         ${escape(input.reason)}
       </div>
       <p style="margin:0 0 4px;">
         This is not a refusal of treatment — it means we would like to talk it through with you
         first. Booking takes a moment.
       </p>
       ${button(input.bookingUrl, 'Book an appointment')}
       ${branchBlock(input.branch)}`,
    ),
  };
}

/**
 * A safety block. The patient is told to stop and speak to someone, given both
 * branches, and given no clinical reasoning at all — that conversation belongs
 * with a pharmacist, not in an inbox.
 */
export function safetyBlock(input: {
  patientName: string;
  bookingUrl: string;
  branches: BranchDetails[];
}): PatientEmail {
  return {
    subject: 'Please contact the pharmacy about your request',
    html: shell(
      'Please speak to us',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 12px;">
         Thank you for your request. Based on your answers we are not able to supply your
         treatment online at the moment, and we would like to speak with you before you continue.
       </p>
       <p style="margin:0 0 4px;"><strong>Please contact us, or book an appointment.</strong></p>
       ${button(input.bookingUrl, 'Book an appointment')}
       ${input.branches.map(branchBlock).join('')}
       <p style="margin:0;color:#544D6B;font-size:13px;">
         If you feel unwell, please contact your GP or seek medical advice straight away.
       </p>`,
      'A pharmacist will normally call you within one working day.',
    ),
  };
}

export function moreInformationNeeded(input: {
  patientName: string;
  question: string;
  formUrl: string;
}): PatientEmail {
  return {
    subject: 'One more thing about your request',
    html: shell(
      'We need a little more information',
      `<p style="margin:0 0 14px;">Hello ${escape(input.patientName)},</p>
       <p style="margin:0 0 12px;">
         A pharmacist has looked at your request and needs one more detail before it can go ahead.
       </p>
       <div style="background:#F3F1F9;border-radius:8px;padding:13px 15px;margin:0 0 16px;font-size:13.5px;">
         ${escape(input.question)}
       </div>
       ${button(input.formUrl, 'Add the missing detail')}`,
    ),
  };
}

// ─────────────────────────────────────────────────────────────

/**
 * Sending is deliberately routed through the same deliver path as everything
 * else, so a patient email that fails is recorded rather than assumed.
 */
export async function sendPatientEmail(
  to: string | null | undefined,
  message: PatientEmail,
): Promise<SendResult> {
  if (!to) {
    return { ok: false, recipient: '', error: 'No email address on the record.' };
  }
  const { sendRaw } = await import('./send');
  return sendRaw(to, message.subject, message.html);
}
