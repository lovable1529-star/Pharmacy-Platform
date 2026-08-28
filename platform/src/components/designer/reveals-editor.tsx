'use client';

/**
 * Follow-up questions — the ones that appear only when somebody answers a
 * particular way.
 *
 * This is the most-used pattern in his forms and the designer had no way to
 * create one. "Any allergies? → Yes → tell us which", "Gender → Other → how
 * would you describe it": all of those existed in the seeded forms because they
 * were written by hand in JSON, and a pharmacy that cannot add one has a form
 * builder that only half works.
 *
 * The editor is arranged by ANSWER rather than by question, because that is how
 * somebody thinks about it: "when they say Other, ask them this." A flat list of
 * follow-ups with a condition dropdown on each would be the same data and much
 * harder to reason about.
 */

import { CornerDownRight, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { FieldType, FormField } from '@/types/form-schema';

/** What a follow-up can be. Deliberately short — this is a detail box, usually. */
const FOLLOW_UP_TYPES: { type: FieldType; label: string }[] = [
  { type: 'shortText', label: 'Short text' },
  { type: 'longText', label: 'Long text' },
  { type: 'yesNo', label: 'Yes / No' },
  { type: 'select', label: 'Dropdown' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
];

export interface RevealsEditorProps {
  field: FormField;
  /** Every id already in use, so a new one cannot collide. */
  usedIds: Set<string>;
  onChange: (reveals: FormField['reveals']) => void;
  onSelectField: (id: string) => void;
  selectedId: string | null;
}

/**
 * The answers a follow-up can hang off.
 *
 * Yes/No fields carry no `options`, so their values are supplied here rather
 * than making the pharmacy type them. They are the STRINGS the control writes —
 * 'yes' and 'no', not booleans. Getting that wrong produces a follow-up that is
 * configured, looks right in the designer, and never appears for a patient.
 */
function answersFor(field: FormField): { value: unknown; label: string }[] {
  if (field.type === 'yesNo') {
    return [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ];
  }
  if (field.type === 'yesNoNa') {
    return [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'na', label: 'Not applicable' },
    ];
  }
  return (field.options ?? []).map((o) => ({ value: o.value, label: o.label }));
}

function slugId(label: string, used: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'question';

  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  return id;
}

export function RevealsEditor({
  field,
  usedIds,
  onChange,
  onSelectField,
  selectedId,
}: RevealsEditorProps) {
  const answers = answersFor(field);
  const reveals = field.reveals ?? [];

  // Nothing to hang a follow-up off yet.
  if (answers.length === 0) {
    return (
      <p className="text-[12.5px] leading-relaxed text-ink-faint">
        Add some options first — a follow-up question appears in response to a
        particular answer.
      </p>
    );
  }

  function followUpsFor(value: unknown): FormField[] {
    return reveals.find((r) => r.whenValue === value)?.fields ?? [];
  }

  function addFollowUp(value: unknown, type: FieldType) {
    const label = 'Please give details';
    const id = slugId(`${field.id}_detail`, usedIds);

    const created: FormField = {
      id,
      type,
      label,
      required: true,
      ...(type === 'select'
        ? { options: [{ value: 'option_1', label: 'First option' }] }
        : {}),
    };

    const existing = reveals.find((r) => r.whenValue === value);
    const next = existing
      ? reveals.map((r) =>
          r.whenValue === value ? { ...r, fields: [...r.fields, created] } : r,
        )
      : [...reveals, { whenValue: value, fields: [created] }];

    onChange(next);
    onSelectField(id);
  }

  function removeFollowUp(value: unknown, id: string) {
    const next = reveals
      .map((r) =>
        r.whenValue === value
          ? { ...r, fields: r.fields.filter((f) => f.id !== id) }
          : r,
      )
      // Drop the branch entirely once its last follow-up is gone, so the schema
      // does not accumulate empty conditions nobody can see.
      .filter((r) => r.fields.length > 0);

    onChange(next.length > 0 ? next : undefined);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {answers.map((answer) => {
        const followUps = followUpsFor(answer.value);

        return (
          <div
            key={String(answer.value)}
            className="rounded-[8px] border border-line bg-sunk p-2.5"
          >
            <p className="mb-1.5 text-[12px] text-ink-soft">
              When they answer{' '}
              <span className="font-medium text-ink">{answer.label}</span>
            </p>

            {followUps.length > 0 ? (
              <div className="mb-1.5 flex flex-col gap-1">
                {followUps.map((f) => (
                  <div
                    key={f.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded-[6px] border bg-surface px-2 py-1.5',
                      selectedId === f.id ? 'border-brand-400' : 'border-line',
                    )}
                  >
                    <CornerDownRight size={11} className="shrink-0 text-ink-faint" />
                    <button
                      type="button"
                      onClick={() => onSelectField(f.id)}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink hover:text-brand-700"
                      title="Edit this follow-up"
                    >
                      {f.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFollowUp(answer.value, f.id)}
                      aria-label={`Remove the follow-up "${f.label}"`}
                      className="shrink-0 rounded-[4px] p-1 text-ink-faint transition-colors hover:text-stop-700"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1">
              {FOLLOW_UP_TYPES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => addFollowUp(answer.value, t.type)}
                  className="flex items-center gap-1 rounded-[5px] border border-line bg-surface px-1.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
                >
                  <Plus size={10} strokeWidth={2.4} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
