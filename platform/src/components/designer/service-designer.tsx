'use client';

/**
 * Service Designer.
 *
 * The capability Zoho could not deliver and the reason this platform exists. The
 * client builds a consultation form for any service he offers, and it is live
 * when he publishes it.
 *
 * Two decisions carry the whole thing:
 *
 * 1. The preview is the REAL renderer. Not a mock-up, not an approximation —
 *    the same `FormWizard` a patient sees on their phone. There is no second
 *    implementation, so nothing can drift.
 *
 * 2. He edits questions, options, logic and copy. He never touches layout,
 *    spacing or colour, and he cannot invent a field type. That constraint is
 *    exactly why every form he builds still looks designed.
 */

import { useMemo, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, Settings2, CornerDownRight,
  Stethoscope, Check, Layers,
  PanelLeftClose, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { FormWizard } from '@/components/form/wizard';
import type {
  FormField, FormSchema, FormStep, FieldType, FieldOption,
} from '@/types/form-schema';

/** The palette. This list is the entire vocabulary — he picks, never invents. */
const PALETTE: { type: FieldType; label: string; hint: string; presentation?: string }[] = [
  { type: 'yesNo', label: 'Yes / No', hint: 'Two pills, with an optional follow-up', presentation: 'pills' },
  { type: 'shortText', label: 'Short text', hint: 'A single line' },
  { type: 'longText', label: 'Long text', hint: 'A paragraph' },
  { type: 'select', label: 'Dropdown', hint: 'One of many', presentation: 'dropdown' },
  { type: 'scale', label: 'Severity scale', hint: 'One per line, ordered' },
  { type: 'multiSelect', label: 'Multi-select', hint: 'Chips — pick several', presentation: 'chips' },
  { type: 'checkboxGroup', label: 'Checklist', hint: 'Tick all that apply', presentation: 'checkList' },
  { type: 'number', label: 'Number', hint: 'Numeric only' },
  { type: 'dateOfBirth', label: 'Date of birth', hint: 'Day, month, year' },
  { type: 'measurement', label: 'Measurement', hint: 'Metric or imperial' },
  { type: 'derived', label: 'Calculated value', hint: 'BMI, age' },
  { type: 'email', label: 'Email', hint: 'Validated' },
  { type: 'phone', label: 'Phone', hint: 'Validated' },
  { type: 'address', label: 'Address', hint: 'Multi-line' },
  { type: 'fileUpload', label: 'File upload', hint: 'Photo or PDF' },
  { type: 'photoCapture', label: 'Take a photo', hint: 'Camera only' },
  { type: 'signature', label: 'Signature', hint: 'Finger or mouse' },
  { type: 'infoBlock', label: 'Information', hint: 'Text, no answer' },
];

function newFieldId(label: string, existing: Set<string>): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'question';
  let candidate = base;
  let n = 2;
  while (existing.has(candidate)) candidate = `${base}_${n++}`;
  return candidate;
}

function collectIds(schema: FormSchema): Set<string> {
  const ids = new Set<string>();
  const walk = (fields: FormField[]) => {
    for (const f of fields) {
      ids.add(f.id);
      f.reveals?.forEach((r) => walk(r.fields));
    }
  };
  schema.steps.forEach((s) => walk(s.fields));
  return ids;
}

export interface DesignerProps {
  initialSchema: FormSchema;
  serviceName: string;
  onPublish?: (schema: FormSchema) => Promise<void> | void;
}

export function ServiceDesigner({ initialSchema, serviceName, onPublish }: DesignerProps) {
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Side panels start open; either can be folded away to give the form room.
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const step = schema.steps[stepIndex];
  const selected = useMemo(() => {
    if (!step || !selectedId) return null;
    const find = (fields: FormField[]): FormField | null => {
      for (const f of fields) {
        if (f.id === selectedId) return f;
        for (const r of f.reveals ?? []) {
          const found = find(r.fields);
          if (found) return found;
        }
      }
      return null;
    };
    return find(step.fields);
  }, [step, selectedId]);

  function mutate(updater: (draft: FormSchema) => FormSchema) {
    setSchema((current) => {
      setPublished(false);
      return updater(structuredClone(current));
    });
  }

  function addField(type: FieldType, presentation?: string) {
    const entry = PALETTE.find((p) => p.type === type);
    const label = entry?.label ?? 'New question';

    mutate((draft) => {
      const target = draft.steps[stepIndex];
      if (!target) return draft;
      const id = newFieldId(label, collectIds(draft));

      const field: FormField = {
        id,
        type,
        label: type === 'infoBlock' ? 'Something the patient should read.' : `New ${label.toLowerCase()} question`,
        required: type !== 'infoBlock' && type !== 'derived',
        ...(presentation ? { presentation: presentation as FormField['presentation'] } : {}),
        ...(type === 'select' || type === 'multiSelect' || type === 'checkboxGroup' || type === 'scale'
          ? { options: [{ value: 'option_1', label: 'First option' }, { value: 'option_2', label: 'Second option' }] }
          : {}),
        ...(type === 'measurement' ? { measurementKind: 'weight' as const } : {}),
        ...(type === 'derived' ? { calculation: 'bmi' as const, calculationInputs: ['weight', 'height'] } : {}),
      };

      target.fields.push(field);
      setSelectedId(id);
      return draft;
    });
  }

  function updateSelected(patch: Partial<FormField>) {
    if (!selectedId) return;
    mutate((draft) => {
      const walk = (fields: FormField[]): boolean => {
        for (let i = 0; i < fields.length; i += 1) {
          const f = fields[i]!;
          if (f.id === selectedId) {
            fields[i] = { ...f, ...patch };
            return true;
          }
          for (const r of f.reveals ?? []) if (walk(r.fields)) return true;
        }
        return false;
      };
      draft.steps.forEach((s) => walk(s.fields));
      return draft;
    });
  }

  function removeSelected() {
    if (!selectedId) return;
    mutate((draft) => {
      const walk = (fields: FormField[]) => {
        const index = fields.findIndex((f) => f.id === selectedId);
        if (index >= 0) { fields.splice(index, 1); return true; }
        for (const f of fields) for (const r of f.reveals ?? []) if (walk(r.fields)) return true;
        return false;
      };
      draft.steps.forEach((s) => walk(s.fields));
      return draft;
    });
    setSelectedId(null);
  }

  function moveSelected(direction: -1 | 1) {
    if (!selectedId) return;
    mutate((draft) => {
      const target = draft.steps[stepIndex];
      if (!target) return draft;
      const i = target.fields.findIndex((f) => f.id === selectedId);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= target.fields.length) return draft;
      const [moved] = target.fields.splice(i, 1);
      if (moved) target.fields.splice(j, 0, moved);
      return draft;
    });
  }

  /** The client's single most common pattern: Yes → tell us more. */
  function addFollowUp() {
    if (!selected) return;
    mutate((draft) => {
      const walk = (fields: FormField[]): boolean => {
        for (const f of fields) {
          if (f.id === selectedId) {
            const id = newFieldId(`${f.id}_detail`, collectIds(draft));
            f.reveals = [
              ...(f.reveals ?? []),
              {
                whenValue: 'yes',
                fields: [{ id, type: 'longText', label: 'Please tell us more', required: true }],
              },
            ];
            return true;
          }
          for (const r of f.reveals ?? []) if (walk(r.fields)) return true;
        }
        return false;
      };
      draft.steps.forEach((s) => walk(s.fields));
      return draft;
    });
  }

  function addStep() {
    mutate((draft) => {
      draft.steps.push({
        id: `step_${draft.steps.length + 1}`,
        title: `Step ${draft.steps.length + 1}`,
        fields: [],
      });
      return draft;
    });
    setStepIndex(schema.steps.length);
  }

  async function publish() {
    if (!onPublish) return;
    setPublishing(true);
    try {
      await onPublish(schema);
      setPublished(true);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-60px)] flex-col">
      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[16px] font-semibold text-ink">{serviceName}</h1>
          <p className="text-[12px] text-ink-faint">
            Editing a draft — publishing creates a new version
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {published ? (
            <span className="flex items-center gap-1.5 rounded-[6px] bg-safe-100 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-safe-700">
              <Check size={12} strokeWidth={2.6} /> Published
            </span>
          ) : null}
          <button
            type="button"
            onClick={publish}
            disabled={publishing || !onPublish}
            className="rounded-[7px] bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {publishing ? 'Publishing…' : 'Publish this version'}
          </button>
        </div>
      </div>

      {/*
        Both side panels collapse.

        The middle column is the form — the thing being worked on — and it was
        being squeezed into a third of the screen by a palette you only need
        when adding a question and an inspector you only need when one is
        selected. Collapsing either gives the form the room it should have had.
      */}
      <div
        className={cn(
          'grid min-h-0 flex-1',
          paletteOpen && inspectorOpen && 'lg:grid-cols-[220px_1fr_300px]',
          paletteOpen && !inspectorOpen && 'lg:grid-cols-[220px_1fr_0px]',
          !paletteOpen && inspectorOpen && 'lg:grid-cols-[44px_1fr_300px]',
          !paletteOpen && !inspectorOpen && 'lg:grid-cols-[44px_1fr_0px]',
        )}
      >
        {/* ── Palette ───────────────────────────────────── */}
        <aside
          className={cn(
            'hidden min-h-0 flex-col overflow-y-auto border-r border-line bg-surface lg:flex',
            paletteOpen ? 'p-3' : 'items-center p-2',
          )}
        >
          {paletteOpen ? (
            <div className="mb-2 flex items-center gap-1 px-1">
              <h2 className="font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
                Add a question
              </h2>
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                aria-label="Collapse the question palette"
                title="Collapse"
                className="ml-auto rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
              >
                <PanelLeftClose size={14} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Show the question palette"
              title="Add a question"
              className="mb-1 rounded-[7px] border border-line p-2 text-ink-faint transition-colors hover:border-brand-300 hover:text-ink"
            >
              <Plus size={15} strokeWidth={2.4} />
            </button>
          )}

          <div className={cn('flex flex-col gap-1', !paletteOpen && 'hidden')}>
            {PALETTE.map((item) => (
              <button
                key={item.type + item.label}
                type="button"
                onClick={() => addField(item.type, item.presentation)}
                className="group flex items-start gap-2 rounded-[7px] border border-transparent px-2.5 py-2 text-left transition-colors hover:border-line hover:bg-sunk"
              >
                <Plus size={13} strokeWidth={2.2} className="mt-1 shrink-0 text-ink-faint group-hover:text-brand-600" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{item.label}</span>
                  <span className="block text-[11px] leading-tight text-ink-faint">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Structure + preview ───────────────────────── */}
        <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-sunk px-4 py-2.5">
            {schema.steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setStepIndex(i); setSelectedId(null); }}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  i === stepIndex ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]' : 'text-ink-soft hover:text-ink',
                )}
              >
                {s.title}
              </button>
            ))}
            <button
              type="button"
              onClick={addStep}
              className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-ink"
            >
              <Plus size={13} strokeWidth={2.2} /> Step
            </button>

            {/* The way back for a collapsed inspector. Lives here rather than
                floating over the form, so it cannot cover a question. */}
            {!inspectorOpen ? (
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                title="Show question settings"
                className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink lg:flex"
              >
                <PanelRightOpen size={13} strokeWidth={2} />
                Settings
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Structure */}
            <div className="border-b border-line px-5 py-4">
              <h3 className="mb-2.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
                <Layers size={12} strokeWidth={2} /> Questions in this step
              </h3>
              {step && step.fields.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {step.fields.map((f, i) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(f.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-[7px] border px-3 py-2 text-left transition-colors',
                          selectedId === f.id ? 'border-brand-400 bg-brand-50' : 'border-line bg-surface hover:border-brand-300',
                        )}
                      >
                        <span className="tabular w-5 shrink-0 font-mono text-[11px] text-ink-faint">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{f.label}</span>
                        {f.clinicianOnly ? (
                          <Stethoscope size={13} strokeWidth={2} className="shrink-0 text-brand-500" />
                        ) : null}
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                          {f.type}
                        </span>
                      </button>
                      {(f.reveals ?? []).flatMap((r) => r.fields).map((child) => (
                        <div key={child.id} className="flex items-center gap-2 py-1 pl-8 text-[12.5px] text-ink-faint">
                          <CornerDownRight size={12} strokeWidth={2} />
                          <span className="truncate">{child.label}</span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-[13px] text-ink-faint">
                  No questions yet — add one from the palette.
                </p>
              )}
            </div>

            {/* Live preview — the real renderer */}
            <div className="bg-canvas">
              <div className="flex items-center gap-1.5 px-5 pt-4 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
                <Eye size={12} strokeWidth={2} /> Live preview — this is the real patient form
              </div>
              <FormWizard schema={schema} preview />
            </div>
          </div>
        </main>

        {/* ── Properties ────────────────────────────────── */}
        <aside
          className={cn(
            'hidden min-h-0 flex-col overflow-y-auto border-l border-line bg-surface p-4 lg:flex',
            !inspectorOpen && 'lg:hidden',
          )}
        >
          <h2 className="mb-3 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
            <Settings2 size={12} strokeWidth={2} /> {selected ? 'Question' : 'Nothing selected'}
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              aria-label="Collapse the question settings"
              title="Collapse"
              className="ml-auto rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
            >
              <PanelRightClose size={14} strokeWidth={2} />
            </button>
          </h2>

          {selected ? (
            <div className="flex flex-col gap-4">
              <Labelled label="Question text">
                <textarea
                  rows={2}
                  value={selected.label}
                  onChange={(e) => updateSelected({ label: e.target.value })}
                  className="w-full resize-y rounded-[7px] border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink focus:border-brand-400 focus:outline-none"
                />
              </Labelled>

              <Labelled label="Help text">
                <input
                  value={selected.helpText ?? ''}
                  onChange={(e) => updateSelected({ helpText: e.target.value || undefined })}
                  placeholder="Optional"
                  className="w-full rounded-[7px] border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
                />
              </Labelled>

              <Toggle
                label="Required"
                hint="The patient cannot continue without answering"
                checked={selected.required ?? false}
                onChange={(v) => updateSelected({ required: v })}
              />

              <Toggle
                label="Pharmacist answers this"
                hint="Hidden from the patient; asked at the appointment"
                checked={selected.clinicianOnly ?? false}
                onChange={(v) => updateSelected({ clinicianOnly: v })}
              />

              {selected.options ? (
                <Labelled label="Options">
                  <OptionEditor
                    options={selected.options}
                    onChange={(options) => updateSelected({ options })}
                  />
                </Labelled>
              ) : null}

              {selected.type === 'yesNo' ? (
                <button
                  type="button"
                  onClick={addFollowUp}
                  className="flex items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-line px-3 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-400 hover:text-brand-700"
                >
                  <Plus size={13} strokeWidth={2.2} />
                  Add a follow-up when they answer Yes
                </button>
              ) : null}

              <div className="flex items-center gap-1.5 border-t border-line-soft pt-3">
                <button type="button" onClick={() => moveSelected(-1)}
                  className="rounded-[6px] border border-line p-1.5 text-ink-faint transition-colors hover:text-ink">
                  <ChevronUp size={14} strokeWidth={2} />
                </button>
                <button type="button" onClick={() => moveSelected(1)}
                  className="rounded-[6px] border border-line p-1.5 text-ink-faint transition-colors hover:text-ink">
                  <ChevronDown size={14} strokeWidth={2} />
                </button>
                <span className="ml-auto font-mono text-[10.5px] text-ink-faint">{selected.id}</span>
                <button type="button" onClick={removeSelected}
                  className="rounded-[6px] border border-line p-1.5 text-ink-faint transition-colors hover:border-stop-200 hover:text-stop-700">
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-faint">
              Select a question to edit its wording, options and logic — or add one from the palette.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-2.5 text-left"
    >
      <span
        className={cn(
          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
        )}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="block text-[11.5px] leading-tight text-ink-faint">{hint}</span>
      </span>
    </button>
  );
}

function OptionEditor({
  options, onChange,
}: { options: FieldOption[]; onChange: (options: FieldOption[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={option.label}
            onChange={(e) => {
              const next = [...options];
              next[i] = { ...option, label: e.target.value };
              onChange(next);
            }}
            className="min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:text-stop-700"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...options, { value: `option_${options.length + 1}`, label: 'New option' }])
        }
        className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-brand-700"
      >
        <Plus size={12} strokeWidth={2.2} /> Add an option
      </button>
    </div>
  );
}
