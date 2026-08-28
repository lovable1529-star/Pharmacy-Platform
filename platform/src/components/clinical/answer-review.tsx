'use client';

/**
 * What the patient told us, laid out for the clinician to check against them.
 *
 * His brief is explicit about this step and it was the one missing from the
 * consultation screen entirely: "Clinician reviews all the information
 * collected with the form", "Clinician verifies submitted data with the
 * patient". Without it the clinician was signing a declaration confirming they
 * had verified answers the screen never showed them.
 *
 * Two things earn their place here:
 *
 *   · Answers that matter clinically are pulled to the top and marked. A
 *     pharmacist scanning before an injection needs allergies and pregnancy
 *     immediately, not in question order.
 *   · Every answer is correctable in place, with the same control the patient
 *     used, because his brief says twice that fields must stay editable after
 *     submission. The correction is reasoned and audited.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Paperclip, Pencil, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Control } from '@/components/form/wizard';
import { visibleSteps, visibleFieldsForStep, numberQuestions } from '@/lib/forms/runtime';
import { isStoredFileRef, formatFileSize } from '@/components/fields/stored-file';
import type { Answers, FormField, FormSchema } from '@/types/form-schema';

/**
 * Answers a clinician must see before administering anything.
 *
 * Matched on field id, which is stable by design — relabelling a question in
 * the designer never changes it, so this survives the client rewording his own
 * form, which he does often.
 */
const SAFETY_FIELDS = new Set([
  'allergies', 'allergyDetails', 'vaccineAllergy', 'vaccineAllergyDetails',
  'otherAllergies', 'otherAllergyDetails', 'anaphylaxis',
  'pregnant', 'breastfeeding', 'unwell', 'fever', 'feverLast24Hours',
  'bleedingDisorder', 'anticoagulant', 'immunosuppressed',
  'currentMedication', 'medications', 'otherConditions', 'healthConditions',
]);

/** Human-readable rendering of whatever shape an answer happens to be. */
function present(value: unknown, field: FormField): string {
  if (value === null || value === undefined || value === '') return '—';

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
      .join(', ');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    // Files are rendered as a link by the caller; this is the fallback path.
    if (typeof record.path === 'string' && typeof record.name === 'string') {
      return String(record.name);
    }

    // Measurements arrive as { si, unit, raw } — show what the patient typed,
    // not the SI value, or a patient who entered 12 stone sees 76.2.
    if ('raw' in record && 'unit' in record) {
      return `${record.raw} ${record.unit}`;
    }
    if ('si' in record) return String(record.si);

    // Address
    const parts = ['addressLine1', 'town', 'postcode']
      .map((k) => record[k])
      .filter((v) => typeof v === 'string' && v.trim());
    if (parts.length) return parts.join(', ');

    return JSON.stringify(value);
  }

  const option = field.options?.find((o) => o.value === value);
  return option?.label ?? String(value);
}

/** An answer that should catch the eye before a needle comes out. */
function isConcerning(field: FormField, value: unknown): boolean {
  if (!SAFETY_FIELDS.has(field.id)) return false;
  if (value === true || value === 'yes' || value === 'Yes') return true;
  if (typeof value === 'string' && value.trim().length > 0) {
    return !['no', 'none', 'n/a', 'na', '—'].includes(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

interface Props {
  schema: FormSchema;
  answers: Answers;
  /** Absent when the record is closed — completed consultations are read-only. */
  onAmend?: (answers: Answers, reason: string) => Promise<{ ok: boolean; error?: string }>;
}

export function AnswerReview({ schema, answers, onAmend }: Props) {
  const numbered = useMemo(
    () => (schema.numberQuestions ? numberQuestions(schema) : schema),
    [schema],
  );

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Patient-answered fields only. The clinician's own questions are asked
  // further down the consultation screen, and showing them twice invites
  // answering them in the wrong place.
  const steps = visibleSteps(numbered, answers, { includeClinicianOnly: false });

  const flagged: { field: FormField; value: unknown }[] = [];
  for (const step of steps) {
    for (const field of visibleFieldsForStep(step, answers, { includeClinicianOnly: false })) {
      if (isConcerning(field, answers[field.id])) {
        flagged.push({ field, value: answers[field.id] });
      }
    }
  }

  function startEdit(field: FormField) {
    setEditing(field.id);
    setDraft(answers[field.id]);
    setReason('');
    setError(null);
  }

  async function save(field: FormField) {
    if (!onAmend) return;
    setBusy(true);
    setError(null);

    const result = await onAmend({ ...answers, [field.id]: draft }, reason);

    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save that correction.');
    else {
      setEditing(null);
      setDraft(null);
      setReason('');
    }
  }

  function toggle(stepId: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Safety summary ──────────────────────────────── */}
      {flagged.length > 0 ? (
        <div className="rounded-[10px] border border-review-200 bg-review-50 px-4 py-3.5">
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-review-700">
            <AlertTriangle size={12} strokeWidth={2.4} />
            Check with the patient before proceeding
          </p>
          <dl className="flex flex-col gap-1.5">
            {flagged.map(({ field, value }) => (
              <div key={field.id} className="flex flex-wrap gap-x-2 text-[13.5px]">
                <dt className="font-medium text-review-700">{field.label}</dt>
                <dd className="m-0 text-ink-soft">{present(value, field)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="rounded-[10px] border border-safe-200 bg-safe-50 px-4 py-3 text-[13.5px] text-safe-700">
          <span className="inline-flex items-center gap-1.5">
            <Check size={13} strokeWidth={2.6} />
            No allergies, pregnancy or illness flagged in the patient’s answers.
          </span>
          <span className="mt-0.5 block text-[12.5px] text-ink-soft">
            Still confirm verbally — the form is what they remembered when they filled it in.
          </span>
        </div>
      )}

      {error ? (
        <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      {/* ── Full answers ────────────────────────────────── */}
      {steps.map((step) => {
        const fields = visibleFieldsForStep(step, answers, { includeClinicianOnly: false })
          .filter((f) => f.type !== 'infoBlock');
        if (fields.length === 0) return null;

        const isCollapsed = collapsed.has(step.id);

        return (
          <section key={step.id} className="overflow-hidden rounded-[10px] border border-line bg-surface">
            <button
              type="button"
              onClick={() => toggle(step.id)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 border-b border-line bg-sunk px-4 py-2.5 text-left"
            >
              {isCollapsed ? (
                <ChevronRight size={13} className="text-ink-faint" />
              ) : (
                <ChevronDown size={13} className="text-ink-faint" />
              )}
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                {step.title}
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-faint">
                {fields.length}
              </span>
            </button>

            {isCollapsed ? null : (
              <dl className="m-0 flex flex-col">
                {fields.map((field) => {
                  const value = answers[field.id];
                  const concerning = isConcerning(field, value);
                  const isEditing = editing === field.id;

                  return (
                    <div
                      key={field.id}
                      className={cn(
                        'border-b border-line-soft px-4 py-2.5 last:border-b-0',
                        concerning && 'bg-review-50/40',
                      )}
                    >
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <dt className="min-w-[210px] flex-1 text-[13.5px] text-ink-soft">
                          {field.number ? (
                            <span className="tabular mr-1.5 font-mono text-[11px] text-ink-faint">
                              {field.number}.
                            </span>
                          ) : null}
                          {field.label}
                        </dt>

                        {isEditing ? null : (
                          <>
                            <dd
                              className={cn(
                                'm-0 min-w-[130px] flex-1 text-[14px]',
                                concerning ? 'font-medium text-review-700' : 'text-ink',
                              )}
                            >
                              {isStoredFileRef(value) ? (
                                <a
                                  href={`/api/uploads/view?path=${encodeURIComponent(value.path)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-brand-700 underline"
                                >
                                  <Paperclip size={12} />
                                  {value.name}
                                  <span className="text-ink-faint no-underline">
                                    ({formatFileSize(value.size)})
                                  </span>
                                </a>
                              ) : (
                                present(value, field)
                              )}
                            </dd>
                            {onAmend ? (
                              <button
                                type="button"
                                onClick={() => startEdit(field)}
                                aria-label={`Correct ${field.label}`}
                                className="flex items-center gap-1 rounded-[5px] border border-line px-1.5 py-0.5 text-[11.5px] text-ink-faint transition-colors hover:border-brand-300 hover:text-ink"
                              >
                                <Pencil size={10} />
                                Correct
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-2.5 rounded-[8px] border border-brand-200 bg-brand-50 p-3">
                          <Control
                            schema={numbered}
                            field={field}
                            value={draft}
                            answers={answers}
                            onChange={setDraft}
                          />

                          <label
                            htmlFor={`reason-${field.id}`}
                            className="mb-1 mt-3 block text-[12.5px] font-medium text-ink-soft"
                          >
                            Reason for the correction
                          </label>
                          <input
                            id={`reason-${field.id}`}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. patient misread the question; confirmed at the counter"
                            className="w-full rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13.5px] text-ink outline-none focus:border-brand-400"
                          />
                          <p className="mt-1 text-[12px] text-ink-faint">
                            Recorded against the clinical record with the previous value.
                          </p>

                          <div className="mt-2.5 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:text-ink"
                            >
                              <X size={12} /> Cancel
                            </button>
                            <button
                              type="button"
                              disabled={busy || !reason.trim()}
                              onClick={() => save(field)}
                              className={cn(
                                'flex items-center gap-1 rounded-[6px] bg-brand-600 px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-700',
                                (busy || !reason.trim()) &&
                                  'cursor-not-allowed opacity-40 hover:bg-brand-600',
                              )}
                            >
                              {busy ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} strokeWidth={2.6} />
                              )}
                              Save correction
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}
