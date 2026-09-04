/**
 * Patients who need chasing.
 *
 * The queue beside this answers "who has come to us?". This answers the
 * question nothing in the system asked before: "who hasn't?"
 *
 * A server component — it is a read with no interaction beyond links, and a
 * list of patients should not ship a bundle to render.
 */

import Link from 'next/link';
import { PhoneCall, UserRoundX } from 'lucide-react';
import { countDue, describeDue, type DueRow, type DueState } from '@/lib/repeat-care/due';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';

const STATE_TONE: Record<DueState, 'neutral' | 'brand' | 'review' | 'stop'> = {
  COVERED: 'neutral',
  DUE_SOON: 'brand',
  DUE: 'review',
  LAPSED: 'stop',
  NEVER_SUPPLIED: 'neutral',
};

const STATE_LABEL: Record<DueState, string> = {
  COVERED: 'covered',
  DUE_SOON: 'due soon',
  DUE: 'due',
  LAPSED: 'lapsed',
  NEVER_SUPPLIED: 'never supplied',
};

export function DueList({ rows }: { rows: DueRow[] }) {
  const counts = countDue(rows);

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Nobody is due"
          body={
            'Every enrolled patient is still covered by their last supply, or has '
            + 'a request already waiting in the queue.'
          }
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-3">
      {/*
        The counts first. Somebody opening this tab is deciding how much of
        their afternoon it needs, and that is a different question from who is
        on the list.
      */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-faint">
        {counts.lapsed > 0 ? (
          <span>
            <strong className="tabular font-semibold text-stop-700">{counts.lapsed}</strong>{' '}
            lapsed
          </span>
        ) : null}
        {counts.due > 0 ? (
          <span>
            <strong className="tabular font-semibold text-review-700">{counts.due}</strong>{' '}
            due now
          </span>
        ) : null}
        {counts.dueSoon > 0 ? (
          <span>
            <strong className="tabular font-semibold text-ink">{counts.dueSoon}</strong>{' '}
            due within a week
          </span>
        ) : null}
        {counts.neverSupplied > 0 ? (
          <span>
            <strong className="tabular font-semibold text-ink">{counts.neverSupplied}</strong>{' '}
            never supplied
          </span>
        ) : null}
      </div>

      {rows.map((row) => (
        <Panel key={row.patientId} className="px-5 py-[13px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ${
                row.state === 'LAPSED' ? 'bg-stop-50 text-stop-700' : 'bg-sunk text-ink-faint'
              }`}
              aria-hidden="true"
            >
              {row.state === 'LAPSED'
                ? <UserRoundX size={14} strokeWidth={2} />
                : <PhoneCall size={14} strokeWidth={2} />}
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href={`/patients/${row.patientId}`}
                className="text-[14.5px] font-semibold text-ink underline-offset-2 hover:underline"
              >
                {row.patientName}
              </Link>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-faint">
                <span>{describeDue(row)}</span>
                {row.medicine ? (
                  <span className="text-ink-soft">
                    {row.medicine}{row.strength ? ` ${row.strength}` : ''}
                  </span>
                ) : null}
                {row.externalRef ? (
                  <span className="font-mono text-[11px]">{row.externalRef}</span>
                ) : null}
              </div>
            </div>

            <Tag tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Tag>
          </div>
        </Panel>
      ))}
    </div>
  );
}
