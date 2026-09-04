/**
 * "Where is my request?"
 *
 * A patient completes a ten-minute health questionnaire and then hears nothing
 * until somebody telephones them. They ring the pharmacy to ask whether it
 * arrived — the most avoidable call this service will generate, and one the
 * staff can do nothing about because there was nowhere to send them.
 *
 * Reached by holding the link, which is the same credential model as the
 * payment link and the resume link: the patient has no account, so the token
 * IS the credential and is unguessable. Deliberately NOT a "type your name and
 * date of birth" lookup — that would let anybody who knows a name and birthday
 * confirm that person has a weight-management request pending, which is a
 * disclosure worth more care than a convenience feature deserves.
 *
 * For the same reason the page shows stage and nothing else. No answers, no
 * medicine, no RAG colour, no rule. A link can be forwarded, left open on a
 * shared computer, or read over a shoulder.
 */

import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { Check, CircleDot } from 'lucide-react';
import { db } from '@/lib/db/client';
import {
  submission, service, organisation, prescription, prescriptionFulfilment,
  servicePublicProfile,
} from '@/lib/db/schema';
import {
  PROGRESS_ORDER, progressOf, reached, STEP_LABEL,
} from '@/lib/submissions/progress';

export const dynamic = 'force-dynamic';

export default async function TrackPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const [row] = await db
    .select({
      id: submission.id,
      status: submission.status,
      createdAt: submission.createdAt,
      serviceName: service.name,
      serviceSlug: service.slug,
      organisationName: organisation.name,
      organisationId: service.organisationId,
      serviceId: service.id,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .innerJoin(organisation, eq(service.organisationId, organisation.id))
    .where(eq(submission.resumeToken, token))
    .limit(1);

  // No distinction between a wrong token and a deleted one. Telling a caller
  // which they had would turn this into a way of testing tokens.
  if (!row) notFound();

  /*
   * The furthest point reached, which may be past the submission's own status.
   * Newest prescription: an amended request can raise a second one, and the
   * patient cares about the live one.
   */
  const [rx] = await db
    .select({
      status: prescription.status,
      fulfilmentStatus: prescriptionFulfilment.status,
      fulfilmentMethod: prescriptionFulfilment.method,
    })
    .from(prescription)
    .leftJoin(
      prescriptionFulfilment,
      eq(prescriptionFulfilment.prescriptionId, prescription.id),
    )
    .where(eq(prescription.submissionId, row.id))
    .orderBy(desc(prescription.createdAt))
    .limit(1);

  const [profile] = await db
    .select({
      publicBrandName: servicePublicProfile.publicBrandName,
      supportEmail: servicePublicProfile.supportEmail,
      supportPhone: servicePublicProfile.supportPhone,
    })
    .from(servicePublicProfile)
    .where(and(
      eq(servicePublicProfile.serviceId, row.serviceId),
      eq(servicePublicProfile.organisationId, row.organisationId),
      eq(servicePublicProfile.active, true),
    ))
    .limit(1);

  const progress = progressOf({
    status: row.status,
    prescriptionStatus: rx?.status ?? null,
    fulfilmentStatus: rx?.fulfilmentStatus ?? null,
    fulfilmentMethod: rx?.fulfilmentMethod ?? null,
  });

  const brand = profile?.publicBrandName?.trim() || row.organisationName;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[640px] items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 font-display text-[14px] font-bold text-white">
            {brand.trim().charAt(0).toUpperCase()}
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-ink">{brand}</div>
            <div className="text-[12.5px] text-ink-faint">{row.serviceName}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-5 py-10">
        <h1 className="text-[26px] leading-[1.2] text-ink">{progress.headline}</h1>
        <p className="mt-2.5 max-w-[58ch] text-[15px] leading-[1.6] text-ink-soft">
          {progress.detail}
        </p>

        {progress.needsPatient ? (
          <div className="mt-5 rounded-panel border border-review-200 bg-review-50 px-4 py-3 text-[13.5px] leading-[1.5] text-review-700">
            This one is waiting on you rather than on us.
          </div>
        ) : null}

        {/* ── Timeline ──────────────────────────────────────────────── */}
        <ol className="mt-8 grid gap-0">
          {PROGRESS_ORDER.map((step, i) => {
            const done = reached(progress.step, step);
            const current = progress.step === step;
            const last = i === PROGRESS_ORDER.length - 1;

            return (
              <li key={step} className="grid grid-cols-[auto_1fr] gap-x-3.5">
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border ${
                      current
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : done
                          ? 'border-safe-600 bg-safe-600 text-white'
                          : 'border-line bg-surface text-ink-faint'
                    }`}
                  >
                    {current
                      ? <CircleDot size={12} strokeWidth={2.4} />
                      : done
                        ? <Check size={12} strokeWidth={3} />
                        : null}
                  </span>
                  {/*
                    The connector stops at the last step rather than trailing
                    into nothing.
                  */}
                  {!last ? (
                    <span
                      className={`w-px flex-1 ${done && !current ? 'bg-safe-300' : 'bg-line'}`}
                      style={{ minHeight: 26 }}
                    />
                  ) : null}
                </div>

                <div className={last ? 'pb-0' : 'pb-4'}>
                  <span
                    className={`text-[14px] ${
                      current ? 'font-semibold text-ink' : done ? 'text-ink-soft' : 'text-ink-faint'
                    }`}
                  >
                    {STEP_LABEL[step]}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        {profile?.supportPhone?.trim() || profile?.supportEmail?.trim() ? (
          <p className="mt-9 border-t border-line pt-6 text-[13.5px] text-ink-faint">
            Something not right?{' '}
            {profile.supportPhone?.trim() ? (
              <a
                href={`tel:${profile.supportPhone.replace(/\s+/g, '')}`}
                className="text-brand-700 underline underline-offset-2"
              >
                {profile.supportPhone}
              </a>
            ) : null}
            {profile.supportPhone?.trim() && profile.supportEmail?.trim() ? ' or ' : null}
            {profile.supportEmail?.trim() ? (
              <a
                href={`mailto:${profile.supportEmail}`}
                className="text-brand-700 underline underline-offset-2"
              >
                {profile.supportEmail}
              </a>
            ) : null}
          </p>
        ) : null}

        {/*
          Said last, quietly, because somebody who has bookmarked this and
          comes back in a fortnight should understand why it still says the
          same thing rather than assume the page is broken.
        */}
        <p className="mt-4 text-[12.5px] text-ink-faint">
          This page updates as your request moves. Keep the link — it is the only
          way back to it.
        </p>
      </main>
    </div>
  );
}
