/**
 * Email delivery.
 *
 * Everything clinical goes out from karsonspharmacy.co.uk. This is the highest
 * operational risk in the whole system and it is not a code problem: all eleven
 * GP surgeries are @gov.im government mailboxes, and without aligned SPF, DKIM
 * AND DMARC they reject or silently drop the message. A silent drop means the
 * practice never learns their patient was vaccinated, and nothing bounces to
 * tell anyone.
 *
 * So: every send returns a trackable id, failures are returned rather than
 * thrown, and the caller records the outcome. Nothing here assumes delivery.
 */

import { Resend } from 'resend';
import type { GpBatch, DailySummary } from '@/lib/communications/batching';

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  recipient: string;
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const FROM = process.env.EMAIL_FROM ?? 'clinic@karsonspharmacy.co.uk';

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F6F5F9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#191428;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #DEDAE9;border-radius:10px;overflow:hidden;">
    <div style="padding:18px 22px;border-bottom:1px solid #DEDAE9;">
      <div style="font-size:15px;font-weight:700;color:#5B3A8E;">Karsons Pharmacy</div>
      <div style="font-size:12px;color:#7C7594;margin-top:2px;">${escape(title)}</div>
    </div>
    <div style="padding:22px;font-size:14px;line-height:1.55;">${body}</div>
    <div style="padding:14px 22px;border-top:1px solid #DEDAE9;font-size:11px;color:#7C7594;">
      This message contains patient information and is intended only for the named practice.
      If it has reached you in error, please tell us and delete it.
    </div>
  </div>
</body></html>`;
}

/** One email per surgery, with a table of that day's patients. */
export function renderGpBatchEmail(batch: GpBatch, date: Date): { subject: string; html: string } {
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Isle_of_Man',
  }).format(date);

  const rows = batch.consultations
    .map((c) => {
      const dob = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Isle_of_Man' })
        .format(new Date(c.patientDateOfBirth));
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EAE7F2;">${escape(c.patientName)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EAE7F2;white-space:nowrap;">${dob}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EAE7F2;">${escape(c.productName ?? c.serviceName)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EAE7F2;">${escape(c.batchNumber ?? '—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EAE7F2;">${escape(c.siteOfAdministration ?? '—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EAE7F2;">${escape(c.branchName)}</td>
      </tr>`;
    })
    .join('');

  const clinicians = [...new Set(batch.consultations.map((c) => `${c.clinicianName} (GPhC ${c.clinicianGphc})`))];

  const html = shell(
    `Vaccinations administered — ${dateLabel}`,
    `<p style="margin:0 0 14px;">Dear ${escape(batch.gpSurgeryName)},</p>
     <p style="margin:0 0 16px;">
       The following ${batch.consultations.length === 1 ? 'patient of yours has' : `${batch.consultations.length} patients of yours have`}
       been seen at Karsons Pharmacy on ${dateLabel}. Please add this to their records.
     </p>
     <table style="width:100%;border-collapse:collapse;font-size:13px;">
       <thead><tr style="background:#F3F1F9;">
         <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7C7594;">Patient</th>
         <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7C7594;">DOB</th>
         <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7C7594;">Given</th>
         <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7C7594;">Batch</th>
         <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7C7594;">Site</th>
         <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7C7594;">Branch</th>
       </tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p style="margin:18px 0 0;font-size:12.5px;color:#544D6B;">
       Administered by ${escape(clinicians.join(', '))}.<br />
       Reference ${escape(batch.reference)} — quote this if you need to query anything.
     </p>`,
  );

  return {
    subject: `Karsons Pharmacy — ${batch.consultations.length} vaccination${batch.consultations.length === 1 ? '' : 's'}, ${dateLabel} [${batch.reference}]`,
    html,
  };
}

export function renderDailySummaryEmail(summary: DailySummary): { subject: string; html: string } {
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Isle_of_Man',
  }).format(summary.date);

  const line = (label: string, value: string | number) =>
    `<tr><td style="padding:5px 0;color:#544D6B;">${escape(label)}</td>
         <td style="padding:5px 0;text-align:right;font-weight:600;">${escape(String(value))}</td></tr>`;

  const html = shell(
    `Daily summary — ${dateLabel}`,
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">
       ${line('Total administered', summary.total)}
       ${line('NHS', summary.nhs)}
       ${line('Private', summary.paid)}
       ${summary.byBranch.map((b) => line(b.branchName, b.count)).join('')}
       ${summary.byProduct.map((p) => line(p.productName, p.count)).join('')}
       ${line('GP notifications sent', summary.gpBatchesSent)}
     </table>
     ${
       summary.deliveryAlerts > 0
         ? `<p style="margin:16px 0 0;padding:11px 13px;background:#F8E4E1;border:1px solid #A32E22;border-radius:6px;color:#A32E22;font-size:13px;">
              ${summary.deliveryAlerts} GP notification${summary.deliveryAlerts === 1 ? '' : 's'} did not
              reach the practice. Check Communications — a surgery may have no record of a patient
              you saw today.
            </p>`
         : ''
     }`,
  );

  return { subject: `Karsons — daily summary, ${dateLabel}`, html };
}

/** Exported so patient templates share exactly this delivery path. */
export async function sendRaw(
  to: string,
  subject: string,
  html: string,
): Promise<SendResult> {
  return deliver(to, subject, html);
}

async function deliver(to: string, subject: string, html: string): Promise<SendResult> {
  const resend = client();
  if (!resend) {
    // Not configured yet. Log rather than throw, so the rest of the job still runs.
    console.warn(`[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to}`);
    return { ok: false, recipient: to, error: 'Email is not configured yet.' };
  }

  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) return { ok: false, recipient: to, error: error.message };
    return { ok: true, recipient: to, messageId: data?.id };
  } catch (error) {
    return {
      ok: false,
      recipient: to,
      error: error instanceof Error ? error.message : 'Unknown send failure',
    };
  }
}

export async function sendGpBatch(batch: GpBatch, date: Date): Promise<SendResult> {
  const { subject, html } = renderGpBatchEmail(batch, date);
  return deliver(batch.gpSurgeryEmail, subject, html);
}

export async function sendDailySummary(
  summary: DailySummary,
  recipients: string[],
): Promise<SendResult[]> {
  const { subject, html } = renderDailySummaryEmail(summary);
  return Promise.all(recipients.map((to) => deliver(to, subject, html)));
}
