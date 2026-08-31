import 'server-only';

/**
 * The payment lifecycle, and what settling one sets in motion.
 *
 * Kept away from the UI because the interesting part is not the button — it is
 * the transition to PAID, which is the moment his workflow issues the
 * prescription. That transition has to behave identically whether it was
 * triggered by a demo click, a Stripe webhook, or a member of staff recording
 * cash at the till.
 *
 * Settling is idempotent. A webhook that arrives twice, a patient who
 * double-taps, and a retried request must all produce one paid invoice and one
 * prescription — so the update is conditional on the row still being PENDING,
 * and the follow-on work only runs for the caller that actually moved it.
 */

import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  payment, submission, service, patient, branch, organisation,
  prescription,
} from '@/lib/db/schema';
import { queueNotification, queueFromTemplate } from '@/lib/notifications/outbox';
import { resolveAppUrl } from '@/lib/app-url';
import { changeSubmissionStatus } from '@/lib/workflow/history';
import { issuePrescription } from '@/lib/prescriptions/issue';
import { createFulfilmentForPrescription } from '@/lib/fulfilment/create';
import { loadApplicableResources } from '@/lib/resources/load';
import { resourceAppendixHtml } from '@/lib/resources/appendix';
import { canTransition, type SubmissionStatus } from '@/lib/workflow/status';
import {
  generatePaymentToken, paymentExpiry, activeProvider, formatMoney,
  buildPaymentUrl, isDemoMode, type PaymentProvider,
} from './provider';

export interface RequestPaymentInput {
  organisationId: string;
  submissionId: string;
  patientId: string | null;
  branchId: string | null;
  amountMinor: number;
  description: string;
  /** Where a link would be sent. Nothing is sent without one. */
  email: string | null;
  /**
   * Send the patient a payment link.
   *
   * Defaults to false. No provider is integrated in this phase, so the link
   * leads to a page that cannot take money — emailing one would be worse than
   * sending nothing. Set true only once a provider is live.
   */
  notifyPatient?: boolean;
}

export interface RequestedPayment {
  id: string;
  token: string;
  url: string;
  amountMinor: number;
  alreadyExisted: boolean;
}

/**
 * Ask a patient to pay.
 *
 * Returns the existing request if one is already open, rather than creating a
 * second — two live links for one supply means a patient can pay twice, and the
 * refund is the pharmacy's problem rather than their mistake.
 */
/**
 * Raise a payment that is owed.
 *
 * `notifyPatient` defaults to FALSE. The current phase has no payment provider
 * integrated: a member of staff confirms the money arrived. Emailing a link to
 * a page that cannot take a payment is worse than sending nothing, so sending
 * one is now a deliberate act rather than a side effect of raising the charge.
 *
 * The token, the page and the provider abstraction all stay — this is a
 * switched-off feature, not a deleted one, and the webhook path will settle
 * through the same `settlePayment` the tick box does.
 */
export async function requestPayment(
  input: RequestPaymentInput,
): Promise<RequestedPayment | null> {
  if (input.amountMinor <= 0) return null;

  const appUrl = resolveAppUrl();

  const [open] = await db
    .select({
      id: payment.id,
      accessToken: payment.accessToken,
      amountMinor: payment.amountMinor,
    })
    .from(payment)
    .where(
      and(
        eq(payment.submissionId, input.submissionId),
        eq(payment.status, 'PENDING'),
      ),
    )
    .limit(1);

  if (open) {
    return {
      id: open.id,
      token: open.accessToken,
      url: buildPaymentUrl(appUrl, open.accessToken),
      amountMinor: open.amountMinor,
      alreadyExisted: true,
    };
  }

  const token = generatePaymentToken();

  const [created] = await db
    .insert(payment)
    .values({
      organisationId: input.organisationId,
      submissionId: input.submissionId,
      patientId: input.patientId,
      branchId: input.branchId,
      amountMinor: input.amountMinor,
      description: input.description,
      provider: activeProvider(),
      accessToken: token,
      expiresAt: paymentExpiry(),
    })
    .returning({ id: payment.id });

  if (!created) return null;

  const url = buildPaymentUrl(appUrl, token);

  if (input.email && input.notifyPatient === true) {
    await queueNotification({
      organisationId: input.organisationId,
      channel: 'EMAIL',
      recipient: input.email,
      template: 'payment_request',
      subject: `Your ${input.description} — ${formatMoney(input.amountMinor)} to pay`,
      body: `
        <p>Your request has been approved by the pharmacist.</p>
        <p>To complete it, please pay <strong>${formatMoney(input.amountMinor)}</strong>
        for ${input.description}. Your prescription is prepared once payment is received.</p>
        <p><a href="${url}"
              style="display:inline-block;background:#5B3A8E;color:#fff;padding:10px 18px;border-radius:7px;text-decoration:none;font-weight:600;">
          Pay now
        </a></p>
        <p style="color:#7C7594;font-size:12px;">
          This link is personal to you. It expires in 14 days.
          ${
            isDemoMode()
              ? '<br><strong>This system is running in demonstration mode — no payment is actually taken.</strong>'
              : ''
          }
        </p>`,
      entityType: 'payment',
      entityId: created.id,
    });
  }

  return { id: created.id, token, url, amountMinor: input.amountMinor, alreadyExisted: false };
}

export interface SettleResult {
  ok: boolean;
  /** False when the payment was already settled — not an error. */
  changed: boolean;
  paymentId?: string;
  submissionId?: string | null;
  error?: string;
}

/**
 * Mark a payment as paid, and issue what it was gating.
 *
 * The conditional update is what makes this safe to call more than once: only
 * the caller that actually moves the row out of PENDING does the follow-on
 * work, so a duplicate webhook cannot produce a second prescription.
 */
/**
 * Settle a payment, whatever told us it had been paid.
 *
 * One function for both the staff tick box now and a provider webhook later,
 * because everything payment unlocks — approving the request, allocating the
 * prescription number, issuing the document — has to happen identically
 * regardless of how the money was confirmed. Two settlement paths would drift.
 *
 * `confirmedBy` is the accountability the manual phase has instead of a
 * provider reference: `paidAt` is the event, this is who asserted it.
 */
export async function settlePayment(input: {
  paymentId: string;
  provider: PaymentProvider;
  providerRef?: string | null;
  confirmedBy?: string | null;
  confirmationNote?: string | null;
}): Promise<SettleResult> {
  const [settled] = await db
    .update(payment)
    .set({
      status: 'PAID',
      paidAt: new Date(),
      provider: input.provider,
      providerRef: input.providerRef ?? null,
      confirmedBy: input.confirmedBy ?? null,
      confirmationNote: input.confirmationNote?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(payment.id, input.paymentId), eq(payment.status, 'PENDING')))
    .returning({
      id: payment.id,
      submissionId: payment.submissionId,
      organisationId: payment.organisationId,
      amountMinor: payment.amountMinor,
      description: payment.description,
      branchId: payment.branchId,
    });

  if (!settled) {
    // Already paid, cancelled, or gone. Not an error — a webhook arriving twice
    // is normal, and the correct response is to do nothing quietly.
    return { ok: true, changed: false };
  }

  // ── What payment unlocks ───────────────────────────────
  if (settled.submissionId) {
    /*
     * Never approve a form that was never submitted.
     *
     * In the intended flow a payment is only raised after a pharmacist has
     * approved the request, so the submission is already past DRAFT. Setting
     * APPROVED unconditionally meant that a payment settled against a draft —
     * however it came to exist — marked an unfinished questionnaire as
     * clinically approved, and the worklist then offered to start a
     * consultation on answers the patient had not sent.
     *
     * The condition in the WHERE clause is what makes this safe rather than the
     * check being somewhere a future caller can skip.
     */
    /*
     * Approving on payment goes through the workflow like every other move, so
     * the history shows that payment is what approved it rather than leaving a
     * status that changed with nothing to explain it.
     *
     * The DRAFT guard survives as the WHERE clause it always was: a payment
     * must never approve a questionnaire the patient never finished sending,
     * and keeping that condition in SQL is what makes it safe against a future
     * caller rather than a check somebody can forget.
     */
    // Captured so the narrowing above survives into the closure.
    const submissionId = settled.submissionId;
    const organisationId = settled.organisationId;

    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: submission.status })
        .from(submission)
        .where(and(eq(submission.id, submissionId), ne(submission.status, 'DRAFT')))
        .limit(1);

      if (!current) return;
      if (!canTransition(current.status as SubmissionStatus, 'APPROVED')) return;

      await changeSubmissionStatus(tx, {
        organisationId,
        submissionId,
        to: 'APPROVED',
        by: { label: 'Payment received' },
        reason: 'Payment settled',
      });

      /*
       * §8.7 — the payment condition is what releases the document.
       *
       * The number is allocated here rather than at approval, because a
       * prescription number is the pharmacy's external reference to a real
       * supply. Allocating one for a request that is approved and then never
       * paid for would leave a gap in the sequence that reads, to anyone
       * auditing it later, like a missing prescription.
       */
      const [raised] = await tx
        .select({ id: prescription.id })
        .from(prescription)
        .where(eq(prescription.submissionId, submissionId))
        .limit(1);

      if (raised) {
        await tx
          .update(prescription)
          .set({
            paidOnline: true,
            // The settlement that released it. One payment can never sit
            // behind two prescriptions — the database enforces that with a
            // unique index — so this is the audit trail from money to medicine.
            paymentId: settled.id,
            updatedAt: new Date(),
          })
          .where(eq(prescription.id, raised.id));

        await issuePrescription(tx, raised.id);

        /*
         * The physical half of the supply opens the moment the prescription
         * exists, from the patient's own collection-or-delivery choice.
         *
         * Created here rather than on the dispensary screen because it is a
         * consequence of issuing, and a consequence that only happens when
         * somebody remembers to open the right page is not a consequence.
         */
        await createFulfilmentForPrescription(tx, {
          organisationId,
          prescriptionId: raised.id,
          submissionId,
        });
      }
    });

    const [context] = await db
      .select({
        patientEmail: patient.email,
        patientName: patient.firstName,
        patientId: patient.id,
        serviceId: submission.serviceId,
        serviceName: service.name,
        branchName: branch.name,
        branchInbox: branch.inboxEmail,
        orgName: organisation.name,
      })
      .from(submission)
      .innerJoin(service, eq(submission.serviceId, service.id))
      .innerJoin(organisation, eq(submission.organisationId, organisation.id))
      .leftJoin(patient, eq(submission.patientId, patient.id))
      .leftJoin(branch, eq(submission.branchId, branch.id))
      .where(eq(submission.id, settled.submissionId))
      .limit(1);

    if (context) {
      // The pharmacy needs to know there is something to dispense. His flow
      // sends the prescription to the branch inbox at this point.
      if (context.branchInbox) {
        await queueNotification({
          organisationId: settled.organisationId,
          channel: 'EMAIL',
          recipient: context.branchInbox,
          template: 'payment_received',
          subject: `Paid — ${context.serviceName} ready to dispense`,
          body: `
            <p><strong>${formatMoney(settled.amountMinor)}</strong> received for
            ${context.serviceName}${context.branchName ? ` at ${context.branchName}` : ''}.</p>
            <p>The prescription can now be prepared.</p>`,
          entityType: 'payment',
          entityId: settled.id,
        });
      }

      /*
       * §15 — "prescription ready", in wording the pharmacy controls.
       *
       * Separate from the receipt below: one is about money, the other about
       * medicine, and a patient who paid on collection still needs the second.
       * Only safe values are supplied, so the same template key used on SMS
       * cannot name what they are collecting.
       */
      if (context.patientEmail) {
        /*
         * The leaflets the pharmacy wants read once somebody actually has the
         * medicine — storage, side effects, needle disposal. This is the first
         * moment the medicine is known, so medicine-specific ones can finally
         * apply; on the form nobody had been prescribed anything yet.
         *
         * Passed as an appendix rather than a substitution because the list is
         * a different length for every patient, and passed as CLINICAL detail
         * because "How to inject your Mounjaro" names the medicine — the
         * outbox drops it on any template not allowed clinical detail.
         */
        const [rx] = await db
          .select({ medicineId: prescription.medicineId })
          .from(prescription)
          .where(and(
            eq(prescription.submissionId, settled.submissionId),
            eq(prescription.organisationId, settled.organisationId),
          ))
          .limit(1);

        const afterRx = await loadApplicableResources(db, {
          organisationId: settled.organisationId,
          serviceId: context.serviceId,
          stage: 'AFTER_RX',
          medicineId: rx?.medicineId ?? null,
        });

        await queueFromTemplate({
          organisationId: settled.organisationId,
          channel: 'EMAIL',
          recipient: context.patientEmail,
          templateKey: 'prescription.ready',
          values: { safe: { firstName: context.patientName ?? 'there' } },
          clinicalAppendix: resourceAppendixHtml(afterRx),
          entityType: 'submission',
          entityId: settled.submissionId ?? null,
        });
      }

      if (context.patientEmail) {
        await queueNotification({
          organisationId: settled.organisationId,
          channel: 'EMAIL',
          recipient: context.patientEmail,
          template: 'payment_receipt',
          subject: `Payment received — ${context.serviceName}`,
          body: `
            <p>Thank you${context.patientName ? `, ${context.patientName}` : ''}.</p>
            <p>We have received <strong>${formatMoney(settled.amountMinor)}</strong>
            for ${context.serviceName}. Your prescription is being prepared and we
            will let you know when it is ready to collect.</p>
            ${
              isDemoMode()
                ? '<p style="color:#A8700E;"><strong>Demonstration mode — no payment was actually taken.</strong></p>'
                : ''
            }`,
          entityType: 'payment',
          entityId: settled.id,
        });
      }
    }
  }

  return {
    ok: true,
    changed: true,
    paymentId: settled.id,
    submissionId: settled.submissionId,
  };
}
