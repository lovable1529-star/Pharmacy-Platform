/**
 * Communications.
 *
 * What went to GP surgeries, and whether it arrived. All eleven practices are
 * gov.im government mailboxes, which reject or silently drop mail failing SPF,
 * DKIM or DMARC — and a silent drop means a practice never learns their patient
 * was vaccinated. That is the failure this screen exists to surface.
 */

import { Mail, TriangleAlert } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { getConsultationsToNotify } from '@/lib/queries/notifications';
import { buildGpBatches } from '@/lib/communications/batching';
import { formatDate } from '@/lib/units';

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
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight text-ink">Communications</h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          One email per surgery at the end of each day, listing every patient seen.
        </p>
      </div>

      {unroutable.length > 0 ? (
        <div className="mb-5 flex items-start gap-3 rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-3.5">
          <TriangleAlert size={16} strokeWidth={2.1} className="mt-0.5 shrink-0 text-stop-700" />
          <div className="text-[13.5px] text-stop-700">
            <strong>
              {unroutable.length} consultation{unroutable.length === 1 ? '' : 's'} cannot be sent.
            </strong>{' '}
            There is no usable GP address on the patient record. Those practices will have no
            record of what happened unless someone contacts them directly.
          </div>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Seen today" value={consultations.length} />
        <Stat label="Surgeries to notify" value={batches.length} />
        <Stat label="Not yet sent" value={pending} tone={pending > 0 ? 'review' : undefined} />
      </div>

      {batches.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-14 text-center">
          <Mail size={26} strokeWidth={1.6} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-[15px] font-medium text-ink">Nothing to send today</p>
          <p className="mt-1 text-[13.5px] text-ink-faint">
            Batches are built from consultations completed today and go out at 6pm.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          {batches.map((batch) => {
            const sent = batch.consultations.filter((c) => c.notifiedAt !== null).length;
            const allSent = sent === batch.consultations.length;
            return (
              <div
                key={batch.gpSurgeryId}
                className="border-b border-line-soft px-5 py-4 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-[15px] font-semibold text-ink">{batch.gpSurgeryName}</h2>
                  <span className="font-mono text-[11.5px] text-ink-faint">
                    {batch.gpSurgeryEmail}
                  </span>
                  <span
                    className={
                      allSent
                        ? 'ml-auto rounded-[5px] bg-safe-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-safe-700'
                        : 'ml-auto rounded-[5px] bg-review-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-review-700'
                    }
                  >
                    {allSent ? 'Sent' : `${batch.consultations.length - sent} queued`}
                  </span>
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
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'review' }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </div>
      <div
        className={
          tone === 'review'
            ? 'tabular mt-1 font-display text-[26px] font-semibold text-review-700'
            : 'tabular mt-1 font-display text-[26px] font-semibold text-ink'
        }
      >
        {value}
      </div>
    </div>
  );
}
