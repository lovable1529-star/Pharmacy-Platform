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

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  X, Check, Ban, MessageCircleQuestion, ChevronRight, ChevronDown, Loader2, CircleSlash,
  CircleCheck, Plus,

} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Portal } from '@/components/ui/portal';
import { formatDateTime } from '@/lib/units';
import {
  requestFacts, waitingFor, hasQuestionFor, freeTextFieldIds,
} from '@/lib/repeat-care/summary';
import { presentAnswer, isImageAnswer } from '@/lib/forms/present';
import { visibleSteps, visibleFieldsForStep } from '@/lib/forms/runtime';
import type { Answers, FormSchema } from '@/types/form-schema';
import { EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import type { QueueItem, UrgentItem } from '@/lib/queries/reviews';
import { reviewSubmission, type ReviewAction } from './actions';

const OUTCOME_STYLES = {
  RED: 'bg-stop-100 text-stop-700',
  AMBER: 'bg-review-100 text-review-700',
  GREEN: 'bg-safe-100 text-safe-700',
} as const;

/**
 * No outcome is a state, not a blank.
 *
 * A request whose service has no published ruleset gets no evaluation row at
 * all, so `outcome` is null. That was rendered as a dash in an amber-ish chip,
 * which reads as a loading spinner or a bug — and the header said `0 RED · 0
 * AMBER · 0 GREEN` beside `3 ALL`, which is simply incoherent.
 *
 * It is a real condition a pharmacist needs to recognise: nothing has been
 * checked, so their reading of the answers is the only check there is.
 */
const UNTRIAGED_STYLE = 'bg-sunk text-ink-faint';

type Queue = 'ALL' | 'RED' | 'AMBER' | 'GREEN' | 'QUESTION' | 'NONE';

export function ReviewQueue({
  items,
  urgent = [],
  schemas = {},
}: {
  items: QueueItem[];
  urgent?: UrgentItem[];
  /** Questionnaire schemas by form version id, for labelling the answers. */
  schemas?: Record<string, unknown>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue>('ALL');
  const open = items.find((i) => i.submissionId === openId) ?? null;

  /*
   * "Asked a question" needs the questionnaire to answer it honestly.
   *
   * `anythingElse` is a yes/no field on the current GLP-1 form, and the old
   * check counted any non-empty string — so both patients who answered "no"
   * were flagged as having asked something and the badge read "2 asked" on
   * three requests carrying no questions at all.
   */
  const asked = useMemo(() => {
    const freeText = new Map<string, Set<string>>();
    for (const [versionId, schema] of Object.entries(schemas)) {
      const typed = schema as { steps?: { fields: { id: string; type: string }[] }[] };
      if (typed?.steps) freeText.set(versionId, freeTextFieldIds({ steps: typed.steps }));
    }
    return new Set(
      items
        .filter((i) => hasQuestionFor(i.answers, freeText.get(i.formVersionId)))
        .map((i) => i.submissionId),
    );
  }, [items, schemas]);

  const hasQuestion = (item: QueueItem) => asked.has(item.submissionId);

  const counts = {
    RED: items.filter((i) => i.outcome === 'RED').length,
    AMBER: items.filter((i) => i.outcome === 'AMBER').length,
    GREEN: items.filter((i) => i.outcome === 'GREEN').length,
    QUESTION: items.filter(hasQuestion).length,
    NONE: items.filter((i) => i.outcome === null).length,
  };

  /*
   * §6.1 asks for the queues to be clearly SEPARATE, not merely counted. A
   * single list ordered by severity puts the reds on top, which reads as "the
   * worst of a set" rather than "the ones that cannot wait".
   */
  const shown =
    queue === 'ALL' ? items
      : queue === 'QUESTION' ? items.filter(hasQuestion)
        : queue === 'NONE' ? items.filter((i) => i.outcome === null)
          /*
           * Exact, not `?? 'AMBER'`. Defaulting a missing outcome to amber made
           * the AMBER button list every untriaged request while its own count
           * said none — the button read "0 amber" and produced three rows.
           */
          : items.filter((i) => i.outcome === queue);

  return (
    <div className="page-shell mx-auto max-w-[calc(1080px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Repeat care"
        subtitle={`${items.length} request${items.length === 1 ? '' : 's'} awaiting a decision, worst first.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/repeat-care/new"
              className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <Plus size={13} strokeWidth={2.4} />
              On their behalf
            </Link>
            <button
              type="button"
              onClick={() => setQueue('ALL')}
              aria-pressed={queue === 'ALL'}
              className={cn(
                'tabular rounded-control border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.05em] transition-colors',
                queue === 'ALL'
                  ? 'border-ink bg-ink text-white'
                  : 'border-line text-ink-soft hover:border-brand-300',
              )}
            >
              {items.length} all
            </button>
            {(['RED', 'AMBER', 'GREEN'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setQueue(queue === o ? 'ALL' : o)}
                aria-pressed={queue === o}
                className={cn(
                  'tabular rounded-control border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.05em] transition-[box-shadow,border-color]',
                  OUTCOME_STYLES[o],
                  queue === o ? 'ring-2 ring-ink ring-offset-1' : 'border-transparent',
                )}
              >
                {counts[o]} {o.toLowerCase()}
              </button>
            ))}
            {counts.NONE > 0 ? (
              <button
                type="button"
                onClick={() => setQueue(queue === 'NONE' ? 'ALL' : 'NONE')}
                aria-pressed={queue === 'NONE'}
                className={cn(
                  'tabular rounded-control border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.05em] transition-colors',
                  queue === 'NONE'
                    ? 'border-ink bg-ink text-white'
                    : 'border-line text-ink-soft hover:border-brand-300',
                )}
              >
                {counts.NONE} untriaged
              </button>
            ) : null}
            {counts.QUESTION > 0 ? (
              <button
                type="button"
                onClick={() => setQueue(queue === 'QUESTION' ? 'ALL' : 'QUESTION')}
                aria-pressed={queue === 'QUESTION'}
                className={cn(
                  'tabular flex items-center gap-1.5 rounded-control border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.05em] transition-colors',
                  queue === 'QUESTION'
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-line text-ink-soft hover:border-brand-300',
                )}
              >
                <MessageCircleQuestion size={12} strokeWidth={2.2} />
                {counts.QUESTION} asked
              </button>
            ) : null}
          </div>
        }
      />

      {urgent.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-panel border border-stop-200 bg-stop-50 shadow-panel">
          <div className="flex items-center gap-2 border-b border-stop-200 px-4 py-2.5">
            <CircleSlash size={14} strokeWidth={2.2} className="text-stop-600" />
            <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-stop-700">
              Urgent — {urgent.length} needing a call
            </span>
          </div>
          {urgent.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-4 border-b border-stop-200/60 px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">
                  {task.patientName ?? 'Unmatched patient'}
                </span>
                <span className="block truncate text-[12.5px] text-stop-700">{task.reason}</span>
              </span>
              <span className="tabular hidden shrink-0 font-mono text-[11.5px] text-ink-faint sm:block">
                {formatDateTime(task.createdAt)}
              </span>
              {task.submissionId ? (
                <button
                  type="button"
                  onClick={() => setOpenId(task.submissionId!)}
                  className="shrink-0 rounded-control border border-stop-200 bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-stop-700 transition-colors hover:border-stop-600"
                >
                  Open
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <Panel>
          <div className="pt-14">
            <CircleCheck size={28} strokeWidth={1.7} className="mx-auto text-safe-600" />
          </div>
          <EmptyState
            title={queue === 'ALL' ? 'Nothing waiting' : 'Nothing in this queue'}
            body={
              queue === 'ALL'
                ? 'Every repeat request has been dealt with.'
                : 'Nothing matches that filter right now.'
            }
            className="pt-3"
          />
        </Panel>
      ) : (
        <Panel>
          {shown.map((item) => (
            <QueueRow
              key={item.submissionId}
              item={item}
              onOpen={() => setOpenId(item.submissionId)}
            />
          ))}
        </Panel>
      )}

      {open ? (
        <ReviewDrawer
          item={open}
          schema={(schemas[open.formVersionId] as FormSchema | undefined) ?? null}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One request in the queue.
 *
 * The row used to carry the patient's name, the service, and a timestamp — none
 * of which is the question being asked. The question is "is this routine?", and
 * answering it meant opening every single request to look at four numbers that
 * were already computed and sitting in the database.
 *
 * So the trend is on the row. The facts are uncoloured on purpose: the outcome
 * chip is the judgement, and a second set of colours here would be a second
 * opinion competing with the ruleset that produced it.
 */
function QueueRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  const facts = requestFacts({
    derived: item.derived,
    answers: item.answers,
    previous: { medicine: item.previousMedicine, strength: item.previousStrength },
  });

  const line = [facts.dose, facts.weightChange, facts.timeOnDose].filter(Boolean);
  const waited = waitingFor(item.submittedAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 border-b border-line-soft px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-sunk"
    >
      <span
        className={cn(
          'w-[54px] shrink-0 rounded-[5px] px-2 py-1 text-center font-mono text-[10px] font-medium uppercase tracking-wide',
          item.outcome ? OUTCOME_STYLES[item.outcome] : UNTRIAGED_STYLE,
        )}
      >
        {item.outcome ?? 'none'}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-ink">
          {item.patientName ?? 'Unmatched patient'}
        </span>

        {/*
          The clinical line, where there is one. A first consultation carries no
          dose history and simply shows the service, as it always did.
        */}
        {line.length > 0 ? (
          <span className="block truncate text-[12.5px] text-ink-soft">
            {line.join(' · ')}
          </span>
        ) : null}

        <span className="block truncate text-[12px] text-ink-faint">
          {item.serviceName}
          {waited ? ` · ${waited}` : ''}
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
  );
}

/**
 * The questionnaire, as answered, rendered against the version it was given on.
 *
 * Collapsed by default: the trace is what a pharmacist reads first on a triaged
 * request, and an open form pushes it off the screen. Open by default when
 * nothing triaged it, because then there is no trace to read and the answers
 * are the whole of the evidence.
 */
function AnswersSection({
  schema, answers, defaultOpen,
}: {
  schema: FormSchema;
  answers: Answers;
  defaultOpen: boolean;
}) {
  const steps = visibleSteps(schema, answers);
  const [open, setOpen] = useState(defaultOpen);

  /*
   * Unanswered questions are dropped rather than listed as dashes. A patient
   * who skipped an optional question has told us nothing, and a column of "—"
   * makes the answers they DID give harder to find.
   *
   * `empty: ''` rather than the default dash, so "no answer" is testable as a
   * falsy string instead of matching on punctuation.
   */
  const answered = steps
    .map((step) => ({
      step,
      fields: visibleFieldsForStep(step, answers)
        .map((field) => ({
          field,
          value: presentAnswer(field, answers[field.id], answers, { empty: '' }),
        }))
        .filter((entry) => entry.value !== ''),
    }))
    .filter((group) => group.fields.length > 0);

  if (answered.length === 0) return null;

  return (
    <Section title="What they told us">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-brand-600 transition-colors hover:text-brand-700"
      >
        {open ? <ChevronDown size={13} strokeWidth={2.2} /> : <ChevronRight size={13} strokeWidth={2.2} />}
        {open ? 'Hide the answers' : `Show all ${answered.reduce((n, g) => n + g.fields.length, 0)} answers`}
      </button>

      {open ? (
        <div className="flex flex-col gap-3.5">
          {answered.map(({ step, fields }) => (
            <div key={step.id}>
              <p className="m-0 mb-1.5 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-faint">
                {step.title}
              </p>
              <dl className="m-0 flex flex-col gap-1.5">
                {fields.map(({ field, value }) => (
                  <div
                    key={field.id}
                    className="flex gap-3 border-b border-line-soft pb-1.5 last:border-b-0"
                  >
                    <dt className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-soft">
                      {field.label}
                    </dt>
                    <dd className="m-0 max-w-[45%] shrink-0 break-words text-right text-[12.5px] font-medium leading-snug text-ink">
                      {/*
                        A picture is described, not drawn. The drawer is a
                        decision surface a few hundred pixels wide, and the
                        printed record is where the image belongs.
                      */}
                      {isImageAnswer(field, answers[field.id]) ? 'Provided' : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function ReviewDrawer({
  item, schema, onClose,
}: {
  item: QueueItem;
  schema: FormSchema | null;
  onClose: () => void;
}) {
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
    <Portal>
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
              item.outcome ? OUTCOME_STYLES[item.outcome] : UNTRIAGED_STYLE,
            )}
          >
            {item.outcome ?? 'none'}
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
          {/*
            No evaluation at all. Distinct from "the rules ran and found
            nothing": this service has no published ruleset, so the pharmacist
            reading the answers IS the check. Saying so is the difference
            between a considered decision and an assumed one.
          */}
          {item.outcome === null ? (
            <div className="mb-5 rounded-control border border-review-200 bg-review-50 px-3.5 py-3">
              <p className="m-0 text-[13px] font-semibold text-review-900">
                Nothing has triaged this request
              </p>
              <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-review-900">
                {item.serviceName} has no published rules, so no safety checks ran on these
                answers. Read them yourself before deciding.
              </p>
            </div>
          ) : null}

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

          {/*
            The trace, only where there was one. With no evaluation these
            sections read "Rules that fired (0) — no rule matched, this fell
            through to the default outcome", which is not merely empty: it
            describes a ruleset running and finding nothing, when in fact
            nothing ran.
          */}
          {item.outcome !== null ? (
          <>
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
          </>
          ) : null}

          {/*
            What the patient actually said.
            ────────────────────────────────
            The drawer showed the derived numbers and the rule trace but never
            the answers, so a pharmacist could not sanity-check "no side
            effects" without leaving the screen to find the form. On an
            untriaged request it is worse than an omission: with no rules
            behind it, reading the answers IS the review.

            Read-only. Correcting an answer is an amendment with a reason
            against it, and that belongs on the consultation record where it is
            audited — not next to an approve button.
          */}
          {schema ? (
            <AnswersSection
              schema={schema}
              answers={item.answers as Answers}
              defaultOpen={item.outcome === null}
            />
          ) : null}

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
    </Portal>
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
