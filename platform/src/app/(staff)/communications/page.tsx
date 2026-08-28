/**
 * Communications.
 *
 * What went to GP surgeries, and whether it arrived. All eleven practices are
 * gov.im government mailboxes, which reject or silently drop mail failing SPF,
 * DKIM or DMARC — and a silent drop means a practice never learns their patient
 * was vaccinated. That is the failure this screen exists to surface.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * The local `Stat` this file defined is gone in favour of the shared StatCard,
 * and the unroutable warning is now the shared Notice. Both were pixel-level
 * near-misses of the versions on Today, which is exactly how two screens in the
 * same product end up looking like two products.
 *
 * The unroutable warning stays ABOVE the counters. It is the one thing on this
 * screen that means a practice will never learn their patient was seen, and it
 * must be read before anything is totted up.
 */

import { Mail, TriangleAlert } from 'lucide-react';
import { EmptyState, Notice, PageHeader, Panel, SectionLabel, StatCard, Tag } from '@/components/ui/primitives';
import { getStaffContext } from '@/lib/auth/context';
import { getConsultationsToNotify } from '@/lib/queries/notifications';
import { buildGpBatches } from '@/lib/communications/batching';
import { formatDate } from '@/lib/units';
import { GpSendClient } from './gp-send-client';

export const dynamic = 'force-dynamic';

export default async function CommunicationsPage() {
  const { actor } = await getStaffContext();

  const today = new Date();
  const consultations = await getConsultationsToNotify(actor.organisationId, today, true);
  const { batches, unroutable } = buildGpBatches({
    consultations,
    date: today,
    includeAlreadySent: true,
  });

  const pending = consultations.filter((c) => c.notifiedAt === null).length;

  return (
    <div className="page-shell mx-auto max-w-[calc(900px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Communications"
        subtitle="One email per surgery at the end of each day. Send by hand below when a record has been corrected, or when a practice needs it sooner."
      />

      <GpSendClient />

      <SectionLabel className="mb-2.5 mt-9">Tonight’s automatic batch</SectionLabel>

      {unroutable.length > 0 ? (
        <Notice
          tone="stop"
          className="mb-4"
          icon={<TriangleAlert size={16} strokeWidth={2.1} />}
        >
          <strong className="font-semibold">
            {unroutable.length} consultation{unroutable.length === 1 ? '' : 's'} cannot be sent.
          </strong>{' '}
          There is no usable GP address on the patient record. Those practices will have no
          record of what happened unless someone contacts them directly.
        </Notice>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Seen today" value={consultations.length} />
        <StatCard label="Surgeries to notify" value={batches.length} />
        <StatCard label="Not yet sent" value={pending} tone={pending > 0 ? 'review' : 'neutral'} />
      </div>

      {batches.length === 0 ? (
        <Panel>
          <div className="pt-12">
            <Mail size={26} strokeWidth={1.6} className="mx-auto text-ink-faint" />
          </div>
          <EmptyState
            title="Nothing to send today"
            body="Batches are built from consultations completed today and go out at 6pm."
            className="pt-3"
          />
        </Panel>
      ) : (
        <Panel>
          {batches.map((batch) => {
            const sent = batch.consultations.filter((c) => c.notifiedAt !== null).length;
            const allSent = sent === batch.consultations.length;
            return (
              <div
                key={batch.gpSurgeryId}
                className="border-b border-line-soft px-5 py-[15px] transition-colors last:border-b-0 hover:bg-sunk"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-[15px] font-semibold text-ink">{batch.gpSurgeryName}</h2>
                  <span className="font-mono text-[11.5px] text-ink-faint">
                    {batch.gpSurgeryEmail}
                  </span>
                  <Tag tone={allSent ? 'safe' : 'review'} className="ml-auto">
                    {allSent ? 'Sent' : `${batch.consultations.length - sent} queued`}
                  </Tag>
                </div>
                <p className="tabular mt-1 font-mono text-[11.5px] text-ink-faint">
                  {batch.reference} · {batch.consultations.length} patient
                  {batch.consultations.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                  {batch.consultations.map((c) => (
                    <li key={c.consultationId} className="text-[13px] text-ink-soft">
                      {c.patientName}
                      <span className="tabular ml-1.5 font-mono text-[11px] text-ink-faint">
                        {formatDate(c.patientDateOfBirth)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
