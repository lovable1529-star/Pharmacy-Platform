'use client';

/**
 * Review queue.
 *
 * Worst first, and every decision explainable. The "Why?" panel is the point:
 * it shows every rule the engine considered, which fired, which were skipped for
 * a missing answer, and the derived values it used to decide.
 *
 * A pharmacist should never have to take the outcome on trust, and an auditor
 * should be able to reconstruct any past decision exactly.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * The "Why?" panel now slides in from the edge it is anchored to, over a
 * blurred scrim. That is not decoration: a drawer that simply appears reads as
 * a new page, and a pharmacist needs to feel they have opened something on top
 * of the queue rather than navigated away from it — the queue is still there,
 * dimmed, behind it.
 *
 * The scrim also gained a backdrop blur. The queue behind it is a list of
 * patient names, and blurring them while a decision is being made on one is
 * both calmer to read and marginally better for anyone standing at the counter.
 */

import { useState } from 'react';
import {
  X, Check, Ban, MessageCircleQuestion, ChevronRight, Loader2, CircleSlash, CircleCheck,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/units';
import { EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import type { QueueItem } from '@/lib/queries/reviews';
import { reviewSubmission, type ReviewAction } from './actions';

const OUTCOME_STYLES = {
  RED: 'bg-stop-100 text-stop-700',
  AMBER: 'bg-review-100 text-review-700',
  GREEN: 'bg-safe-100 text-safe-700',
} as const;

export function ReviewQueue({ items }: { items: QueueItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.submissionId === openId) ?? null;

  const counts = {
    RED: items.filter((i) => i.outcome === 'RED').length,
    AMBER: items.filter((i) => i.outcome === 'AMBER').length,
    GREEN: items.filter((i) => i.outcome === 'GREEN').length,
  };

  return (
    <div className="page-shell mx-auto max-w-[calc(1080px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Repeat care"
        subtitle={`${items.length} request${items.length === 1 ? '' : 's'} awaiting a decision, worst first.`}
        actions={
          <div className="flex gap-2">
            {(['RED', 'AMBER', 'GREEN'] as const).map((o) => (
              <span
                key={o}
                className={cn(
                  'tabular rounded-control px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.05em]',
                  OUTCOME_STYLES[o],
                )}
              >
                {counts[o]} {o.toLowerCase()}
              </span>
            ))}
          </div>
        }
      />

      {items.length === 0 ? (
        <Panel>
          <div className="pt-14">
            <CircleCheck size={28} strokeWidth={1.7} className="mx-auto text-safe-600" />
          </div>
          <EmptyState
            title="Nothing waiting"
            body="Every repeat request has been dealt with."
            className="pt-3"
          />
        </Panel>
      ) : (
        <Panel>
          {items.map((item) => (
            <button
              key={item.submissionId}
              type="button"
              onClick={() => setOpenId(item.submissionId)}
              className="flex w-full items-center gap-4 border-b border-line-soft px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-sunk"
            >
              <span
                className={cn(
                  'w-[54px] shrink-0 rounded-[5px] px-2 py-1 text-center font-mono text-[10px] font-medium uppercase tracking-wide',
                  OUTCOME_STYLES[item.outcome ?? 'AMBER'],
                )}
              >
                {item.outcome ?? '—'}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold text-ink">
                  {item.patientName ?? 'Unmatched patient'}
                </span>
                <span className="block truncate text-[12.5px] text-ink-faint">
                  {item.serviceName}
                  {item.submittedAt ? ` · ${formatDateTime(item.submittedAt)}` : ''}
                </span>
              </span>

              <span className="hidden shrink-0 font-mono text-[11.5px] text-ink-faint sm:block">
                {item.reference}
              </span>

              <span className="flex shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft">
                Why?
                <ChevronRight size={13} strokeWidth={2.2} />
              </span>
            </button>
          ))}
        </Panel>
      )}

      {open ? <ReviewDrawer item={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function ReviewDrawer({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const fired = item.trace.filter((t) => t.matched);
  const skipped = item.trace.filter((t) => t.skippedReason);
  const considered = item.trace.filter((t) => !t.matched && !t.skippedReason);

  async function decide(decision: ReviewAction) {
    setBusy(decision);
    setError(null);
    const result = await reviewSubmission({
      submissionId: item.submissionId,
      decision,
      note,
      outcome: item.outcome,
    });
    setBusy(null);
    if (!result.ok) setError(result.error);
    else setDone(decision);
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div
        className="absolute inset-0 animate-fade bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-label={`Review ${item.patientName ?? item.reference}`}
        className="relative flex h-full w-full max-w-[560px] animate-slidein flex-col overflow-hidden bg-canvas shadow-pop"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <span
            className={cn(
              'mt-0.5 shrink-0 rounded-[5px] px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wide',
              OUTCOME_STYLES[item.outcome ?? 'AMBER'],
            )}
          >
            {item.outcome ?? '—'}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[18px] font-semibold text-ink">
              {item.patientName ?? 'Unmatched patient'}
            </h2>
            <p className="truncate text-[12.5px] text-ink-faint">
              {item.serviceName} · {item.reference}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* Derived values — what the engine actually decided on */}
          <Section title="What the engine used">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              {Object.entries(item.derived)
                .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </dt>
                    <dd className="tabular text-[14px] font-medium text-ink">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </Section>

          {/* The trace */}
          <Section title={`Rules that fired (${fired.length})`}>
            {fired.length === 0 ? (
              <p className="text-[13.5px] text-ink-faint">
                No rule matched — this fell through to the default outcome.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {fired.map((t) => (
                  <li
                    key={t.ruleId}
                    className={cn(
                      'flex items-start gap-2.5 rounded-control border px-3 py-2.5',
                      t.ruleId === item.decidingRuleId
                        ? 'border-brand-400 bg-brand-50'
                        : 'border-line bg-surface',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-px shrink-0 rounded-[4px] px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase',
                        OUTCOME_STYLES[t.outcome],
                      )}
                    >
                      {t.outcome}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] leading-snug text-ink">{t.label}</span>
                      {t.ruleId === item.decidingRuleId ? (
                        <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-wide text-brand-600">
                          Decided the outcome
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {skipped.length > 0 ? (
            <Section title={`Skipped for a missing answer (${skipped.length})`}>
              <ul className="flex flex-col gap-1">
                {skipped.map((t) => (
                  <li key={t.ruleId} className="flex items-start gap-2 text-[13px] text-ink-faint">
                    <CircleSlash size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
                    <span>
                      {t.label}
                      <span className="ml-1.5 font-mono text-[11px]">— {t.skippedReason}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-faint">
                A rule with a missing answer is skipped, never treated as satisfied. That is why a
                half-completed form can never come back GREEN.
              </p>
            </Section>
          ) : null}

          <Section title={`Considered and did not fire (${considered.length})`}>
            <p className="text-[12.5px] leading-relaxed text-ink-faint">
              {considered.map((t) => t.label).join(' · ') || 'None.'}
            </p>
          </Section>

          {item.advice.length > 0 ? (
            <Section title="Advice for the patient">
              <ul className="flex flex-col gap-2">
                {item.advice.map((a) => (
                  <li key={a} className="rounded-control bg-sunk px-3 py-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                    {a}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        {/* Decision */}
        <div className="shrink-0 border-t border-line bg-surface px-5 py-4">
          {done ? (
            <p className="flex items-center gap-2 text-[14px] font-medium text-safe-700">
              <Check size={16} strokeWidth={2.4} />
              Recorded as {done.toLowerCase().replace('_', ' ')}.
            </p>
          ) : (
            <>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  item.outcome === 'GREEN'
                    ? 'Add a note (optional)'
                    : 'Why are you approving or rejecting this? Required.'
                }
                className="mb-3 w-full resize-y rounded-control border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              {error ? (
                <p role="alert" className="mb-3 text-[13px] text-stop-700">{error}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => decide('APPROVED')}
                  disabled={busy !== null}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-safe-600 px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-safe-700 disabled:opacity-60"
                >
                  {busy === 'APPROVED' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2.4} />}
                  Confirm and issue
                </button>
                <button
                  type="button"
                  onClick={() => decide('INFO_REQUESTED')}
                  disabled={busy !== null}
                  className="flex items-center justify-center gap-1.5 rounded-control border border-line px-3.5 py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-60"
                >
                  <MessageCircleQuestion size={14} strokeWidth={2} />
                  Ask for more
                </button>
                <button
                  type="button"
                  onClick={() => decide('REJECTED')}
                  disabled={busy !== null}
                  className="flex items-center justify-center gap-1.5 rounded-control border border-line px-3.5 py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-stop-200 hover:text-stop-700 disabled:opacity-60"
                >
                  <Ban size={14} strokeWidth={2} />
                  Reject
                </button>
              </div>

              <p className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
                Nothing is supplied automatically at this stage — a pharmacist confirms every
                issue, and the reason is recorded against your name.
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}
