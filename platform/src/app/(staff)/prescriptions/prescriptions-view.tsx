'use client';

/**
 * The dispensing worklist.
 *
 * Grouped by where each prescription is in its life, because that is the
 * question being asked — not "what happened recently" but "what is waiting on
 * us". Three groups, in the order work flows through them.
 *
 * A patient's question is shown at the point of dispensing, in colour, per
 * §6.4. It is easy to record a question at submission and then never surface it
 * where somebody is standing at the counter with the bag in their hand, which
 * is the only moment it is any use.
 */

import { useMemo, useState } from 'react';
import { Pill, MessageCircleQuestion, CheckCircle2, CreditCard } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState, PageHeader, Panel, Tag } from '@/components/ui/primitives';
import { formatDateTime, formatMoney } from '@/lib/units';
import { DispenseDialog } from './dispense-dialog';
import { FulfilmentPanel } from './fulfilment-panel';

export interface PrescriptionRow {
  id: string;
  number: string | null;
  status: string;
  medicineName: string;
  quantity: string | null;
  priceMinor: number | null;
  paidOnline: boolean;
  issuedAt: Date | null;
  createdAt: Date;
  branchId: string;
  branchName: string;
  companyId: string | null;
  patientName: string;
  patientId: string;
  patientQuestion: string | null;
  dispensedBy: string | null;
  dispensedAt: Date | null;
  collectedBy: string | null;
  collectedAt: Date | null;
}

const GROUPS = [
  { key: 'PENDING_PAYMENT', label: 'Awaiting payment', hint: 'No document until payment is settled.' },
  { key: 'ISSUED', label: 'Ready to dispense', hint: 'Issued and waiting at the counter.' },
  { key: 'DISPENSED', label: 'Awaiting collection', hint: 'Checked and signed off, not yet collected.' },
] as const;

export function PrescriptionsView({
  rows,
  clinicians,
  branchId,
  companyId,
}: {
  rows: PrescriptionRow[];
  clinicians: { id: string; fullName: string; gphcNumber: string }[];
  /** The branch in the header — what a supply is recorded against. */
  branchId: string | null;
  companyId: string | null;
}) {
  const [open, setOpen] = useState<PrescriptionRow | null>(null);

  const grouped = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        rows: rows.filter((r) => r.status === g.key),
      })),
    [rows],
  );

  const done = rows.filter((r) => r.status === 'COLLECTED').length;
  const outstanding = rows.length - done;

  return (
    <div className="page-shell mx-auto max-w-[calc(1120px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Prescriptions"
        subtitle={`${outstanding} outstanding · ${done} collected`}
      />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            title="No prescriptions yet"
            body="Approving a repeat request raises one here."
          />
        </Panel>
      ) : null}

      <div className="grid gap-5">
        {grouped.map((group) => (
          group.rows.length === 0 ? null : (
            <section key={group.key}>
              <div className="mb-2 flex items-baseline gap-2.5">
                <h2 className="text-[15px] font-semibold text-ink">{group.label}</h2>
                <span className="tabular font-mono text-[11.5px] text-ink-faint">
                  {group.rows.length}
                </span>
                <span className="text-[12.5px] text-ink-faint">{group.hint}</span>
              </div>

              <Panel>
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    className="border-b border-line-soft px-4 py-3.5 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="text-[14.5px] font-semibold text-ink">
                            {row.patientName}
                          </span>
                          {row.number ? (
                            <span className="tabular font-mono text-[11.5px] text-ink-faint">
                              {row.number}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="text-[13px] text-ink-soft">
                            {row.medicineName}
                            {row.quantity ? ` · ${row.quantity}` : ''}
                          </span>
                          <Tag tone="neutral">{row.branchName}</Tag>
                          {row.priceMinor != null ? (
                            <span
                              className={cn(
                                'tabular flex items-center gap-1 font-mono text-[11.5px]',
                                row.paidOnline ? 'text-safe-700' : 'text-review-700',
                              )}
                            >
                              <CreditCard size={11} strokeWidth={2.2} />
                              {formatMoney(row.priceMinor)}
                              {row.paidOnline ? ' paid' : ' on collection'}
                            </span>
                          ) : null}
                        </div>

                        {/* §6.4 — the moment this matters is now. */}
                        {row.patientQuestion ? (
                          <div className="mt-2 flex items-start gap-1.5 rounded-control border border-brand-200 bg-brand-50 px-2.5 py-1.5">
                            <MessageCircleQuestion
                              size={13}
                              strokeWidth={2.2}
                              className="mt-0.5 shrink-0 text-brand-600"
                            />
                            <p className="text-[12.5px] text-brand-700">
                              Speak to them: “{row.patientQuestion}”
                            </p>
                          </div>
                        ) : null}

                        {row.dispensedBy ? (
                          <p className="tabular mt-1.5 font-mono text-[11px] text-ink-faint">
                            dispensed by {row.dispensedBy}
                            {row.dispensedAt ? ` · ${formatDateTime(row.dispensedAt)}` : ''}
                          </p>
                        ) : null}

                        {/*
                          The physical supply, once the prescription exists.
                          Nothing to show before payment: the fulfilment record
                          is created when the prescription is issued.
                        */}
                        {row.status !== 'PENDING_PAYMENT' ? (
                          <div className="mt-2.5">
                            <FulfilmentPanel
                              prescriptionId={row.id}
                              branchId={branchId}
                              companyId={companyId}
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="shrink-0">
                        {row.status === 'PENDING_PAYMENT' ? (
                          <Tag tone="review">awaiting payment</Tag>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpen(row)}
                            className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
                          >
                            <Pill size={13} strokeWidth={2.2} />
                            {row.status === 'ISSUED' ? 'Dispense' : 'Record collection'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </Panel>
            </section>
          )
        ))}

        {done > 0 ? (
          <section>
            <div className="mb-2 flex items-baseline gap-2.5">
              <h2 className="text-[15px] font-semibold text-ink">Collected</h2>
              <span className="tabular font-mono text-[11.5px] text-ink-faint">{done}</span>
            </div>
            <Panel>
              {rows
                .filter((r) => r.status === 'COLLECTED')
                .slice(0, 20)
                .map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                  >
                    <CheckCircle2 size={14} strokeWidth={2} className="shrink-0 text-safe-600" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                      {row.patientName} · {row.medicineName}
                    </span>
                    <span className="tabular hidden shrink-0 font-mono text-[11px] text-ink-faint sm:block">
                      {row.collectedBy}
                      {row.collectedAt ? ` · ${formatDateTime(row.collectedAt)}` : ''}
                    </span>
                  </div>
                ))}
            </Panel>
          </section>
        ) : null}
      </div>

      {open ? (
        <DispenseDialog
          row={open}
          clinicians={clinicians}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
