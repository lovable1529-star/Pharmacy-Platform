'use client';

/**
 * Service Designer.
 *
 * The capability Zoho could not deliver, and the reason this platform exists.
 * The client builds a complete clinical service here — questions, branching,
 * clinician-only fields, hidden metadata — and publishes it without a developer.
 *
 * Design decisions worth knowing:
 *
 *   - **Live preview, always visible.** The client is not a developer. He needs
 *     to see the patient's view while he edits, not imagine it.
 *   - **Follow-ups, not a rules screen.** "Show a detail box when they answer
 *     Yes" is expressed on the question itself. A separate conditional-logic
 *     editor is how form builders become unusable for non-technical people.
 *   - **Publishing creates a version.** Existing submissions keep the version
 *     they were completed against — editing a form never rewrites history.
 */

import { useMemo, useState } from 'react';
import type { FieldType, FormField, FormSchema, FormStep } from '@/types/form-schema';
import { FormRenderer } from '@/components/form-runtime/form-renderer';

const FIELD_PALETTE: { type: FieldType; label: string; hint: string }[] = [
  { type: 'text',         label: 'Short text',    hint: 'A name, a reference' },
  { type: 'textarea',     label: 'Long text',     hint: 'An explanation' },
  { type: 'yesno',        label: 'Yes / No',      hint: 'Can reveal a follow-up' },
  { type: 'select',       label: 'Dropdown',      hint: 'One choice from a list' },
  { type: 'multiselect',  label: 'Multiple choice', hint: 'Several choices' },
  { type: 'number',       label: 'Number',        hint: 'A count or measure' },
  { type: 'measurement',  label: 'Weight / height', hint: 'Converts units automatically' },
  { type: 'dateOfBirth',  label: 'Date of birth',  hint: 'Day, month, year' },
  { type: 'date',         label: 'Date',          hint: 'A single date' },
  { type: 'email',        label: 'Email',         hint: 'Validated address' },
  { type: 'phone',        label: 'Phone',         hint: 'Contact number' },
  { type: 'address',      label: 'Address',       hint: 'Full postal address' },
  { type: 'signature',    label: 'Signature',     hint: 'Drawn on screen' },
  { type: 'photoCapture', label: 'Take photo',    hint: 'Live camera capture' },
  { type: 'fileUpload',   label: 'Upload file',   hint: 'ID, letters, photos' },
  { type: 'info',         label: 'Information',   hint: 'Text only, no answer' },
];

function newFieldId(): string {
  return `q_${Math.random().toString(36).slice(2, 9)}`;
}

function createField(type: FieldType): FormField {
  const base: FormField = { id: newFieldId(), type, label: 'New question', required: false };

  if (type === 'select' || type === 'multiselect') {
    return { ...base, options: [{ value: 'option-1', label: 'First option' }] };
  }
  if (type === 'measurement') return { ...base, measurementKind: 'weight' };
  if (type === 'info') return { ...base, label: 'Information for the patient' };
  return base;
}

export function ServiceDesigner({
  initialSchema,
  onPublish,
}: {
  initialSchema: FormSchema;
  onPublish: (schema: FormSchema) => void;
}) {
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<'phone' | 'desktop'>('phone');

  const step = schema.steps[activeStep];

  const selectedField = useMemo(() => {
    for (const s of schema.steps) {
      for (const f of s.fields) {
        if (f.id === selectedFieldId) return f;
        for (const reveal of f.reveals ?? []) {
          const child = reveal.fields.find((c) => c.id === selectedFieldId);
          if (child) return child;
        }
      }
    }
    return null;
  }, [schema, selectedFieldId]);

  function updateStep(index: number, patch: Partial<FormStep>) {
    setSchema((s) => ({
      ...s,
      steps: s.steps.map((st, i) => (i === index ? { ...st, ...patch } : st)),
    }));
  }

  /** Applies a patch to a field wherever it lives, including inside a reveal. */
  function updateField(fieldId: string, patch: Partial<FormField>) {
    const apply = (field: FormField): FormField => {
      if (field.id === fieldId) return { ...field, ...patch };
      if (!field.reveals) return field;
      return {
        ...field,
        reveals: field.reveals.map((r) => ({ ...r, fields: r.fields.map(apply) })),
      };
    };

    setSchema((s) => ({
      ...s,
      steps: s.steps.map((st) => ({ ...st, fields: st.fields.map(apply) })),
    }));
  }

  function addField(type: FieldType) {
    const field = createField(type);
    updateStep(activeStep, { fields: [...(step?.fields ?? []), field] });
    setSelectedFieldId(field.id);
  }

  function removeField(fieldId: string) {
    updateStep(activeStep, { fields: (step?.fields ?? []).filter((f) => f.id !== fieldId) });
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    const fields = [...(step?.fields ?? [])];
    const index = fields.findIndex((f) => f.id === fieldId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= fields.length) return;

    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    updateStep(activeStep, { fields });
  }

  /** Adds the "Yes reveals a detail box" pattern — the most common request. */
  function addFollowUp(parentId: string) {
    const child = createField('textarea');
    child.label = 'Please give details';
    child.required = true;

    updateField(parentId, {
      reveals: [
        ...(selectedField?.reveals ?? []),
        { whenValue: 'Yes', fields: [child] },
      ],
    });
    setSelectedFieldId(child.id);
  }

  function addStep() {
    setSchema((s) => ({
      ...s,
      steps: [...s.steps, { id: `step_${s.steps.length + 1}`, title: 'New page', fields: [] }],
    }));
    setActiveStep(schema.steps.length);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr_380px]">
      {/* Palette */}
      <aside className="rounded-card border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Add a question
        </h2>
        <div className="space-y-1">
          {FIELD_PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => addField(item.type)}
              className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="block text-[11px] text-ink-soft">{item.hint}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Canvas */}
      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {schema.steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveStep(i)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                i === activeStep ? 'bg-brand-600 text-white' : 'border border-line bg-surface'
              }`}
            >
              {s.title}
            </button>
          ))}
          <button type="button" onClick={addStep}
            className="rounded-full border border-dashed border-brand-300 px-4 py-1.5 text-sm text-brand-700">
            + Page
          </button>
        </div>

        <div className="rounded-card border border-line bg-surface p-5">
          <input
            value={step?.title ?? ''}
            onChange={(e) => updateStep(activeStep, { title: e.target.value })}
            aria-label="Page title"
            className="mb-4 w-full rounded-lg border border-transparent px-2 py-1 font-display text-xl hover:border-line focus:border-brand-600"
          />

          {(step?.fields ?? []).length === 0 && (
            <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-soft">
              No questions yet. Add one from the left.
            </p>
          )}

          <ul className="space-y-2">
            {(step?.fields ?? []).map((field, index) => (
              <li key={field.id}>
                <div
                  className={`rounded-lg border p-3 ${
                    selectedFieldId === field.id ? 'border-brand-600 bg-brand-50' : 'border-line'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedFieldId(field.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-semibold">
                        <span className="mr-1.5 font-mono text-ink-soft">{index + 1}.</span>
                        {field.label}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-ink-soft">
                        <span className="rounded bg-canvas px-1.5 py-0.5">{field.type}</span>
                        {field.required && <span className="text-triage-red-700">required</span>}
                        {field.clinicianOnly && (
                          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-700">
                            pharmacist answers
                          </span>
                        )}
                        {field.reveals?.length ? <span>· has follow-up</span> : null}
                      </span>
                    </button>

                    <div className="flex flex-none gap-1">
                      <button type="button" aria-label="Move up" onClick={() => moveField(field.id, -1)}
                        className="rounded border border-line px-2 py-1 text-xs">↑</button>
                      <button type="button" aria-label="Move down" onClick={() => moveField(field.id, 1)}
                        className="rounded border border-line px-2 py-1 text-xs">↓</button>
                      <button type="button" aria-label="Delete" onClick={() => removeField(field.id)}
                        className="rounded border border-line px-2 py-1 text-xs text-triage-red-700">×</button>
                    </div>
                  </div>

                  {field.reveals?.map((reveal, ri) => (
                    <div key={ri} className="mt-2 border-l-2 border-brand-300 pl-3">
                      <p className="mb-1 text-[11px] text-ink-soft">
                        Shown when the answer is “{String(reveal.whenValue)}”
                      </p>
                      {reveal.fields.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => setSelectedFieldId(child.id)}
                          className={`block w-full rounded border px-2 py-1.5 text-left text-sm ${
                            selectedFieldId === child.id ? 'border-brand-600 bg-brand-50' : 'border-line'
                          }`}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => onPublish(schema)}
            className="rounded-full bg-brand-600 px-6 py-2.5 text-sm font-bold text-white"
          >
            Publish this version
          </button>
        </div>
      </section>

      {/* Properties + preview */}
      <aside className="space-y-4">
        {selectedField ? (
          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Question settings
            </h2>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold">Question text</span>
              <textarea
                value={selectedField.label} rows={2}
                onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold">Help text (optional)</span>
              <input
                value={selectedField.helpText ?? ''}
                onChange={(e) => updateField(selectedField.id, { helpText: e.target.value })}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>

            <label className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={selectedField.required ?? false}
                onChange={(e) => updateField(selectedField.id, { required: e.target.checked })}
              />
              Required
            </label>

            <label className="mb-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox" checked={selectedField.clinicianOnly ?? false}
                onChange={(e) => updateField(selectedField.id, { clinicianOnly: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Pharmacist answers this
                <span className="block text-[11px] text-ink-soft">
                  Stays in place but is hidden from the patient — for questions asked on the day.
                </span>
              </span>
            </label>

            {(selectedField.type === 'select' || selectedField.type === 'multiselect') && (
              <div className="mb-3">
                <span className="mb-1 block text-xs font-semibold">Options</span>
                {selectedField.options?.map((option, i) => (
                  <div key={i} className="mb-1.5 flex gap-1.5">
                    <input
                      value={option.label}
                      onChange={(e) => {
                        const options = [...(selectedField.options ?? [])];
                        options[i] = { ...option, label: e.target.value };
                        updateField(selectedField.id, { options });
                      }}
                      className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button" aria-label="Remove option"
                      onClick={() => updateField(selectedField.id, {
                        options: selectedField.options?.filter((_, j) => j !== i),
                      })}
                      className="rounded border border-line px-2 text-xs"
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => updateField(selectedField.id, {
                    options: [
                      ...(selectedField.options ?? []),
                      { value: `option-${(selectedField.options?.length ?? 0) + 1}`, label: 'New option' },
                    ],
                  })}
                  className="text-xs font-semibold text-brand-600"
                >+ Add option</button>
              </div>
            )}

            {selectedField.type === 'yesno' && !selectedField.reveals?.length && (
              <button
                type="button"
                onClick={() => addFollowUp(selectedField.id)}
                className="w-full rounded-lg border border-dashed border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700"
              >
                + Add a follow-up when they answer Yes
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-soft">
            Select a question to edit it.
          </div>
        )}

        <div className="rounded-card border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Patient preview
            </h2>
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {(['phone', 'desktop'] as const).map((device) => (
                <button
                  key={device} type="button"
                  aria-pressed={previewDevice === device}
                  onClick={() => setPreviewDevice(device)}
                  className={`rounded px-2 py-1 text-[11px] ${previewDevice === device ? 'bg-brand-600 text-white' : ''}`}
                >
                  {device === 'phone' ? 'Phone' : 'Desktop'}
                </button>
              ))}
            </div>
          </div>

          <div className={`overflow-hidden rounded-lg border border-line bg-canvas p-3 ${previewDevice === 'phone' ? 'max-w-[340px]' : ''}`}>
            <FormRenderer
              key={JSON.stringify(schema)}
              schema={schema}
              onSubmit={() => {}}
            />
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">
            This is exactly what a patient sees. Try answering questions the wrong way to check your
            follow-ups appear.
          </p>
        </div>
      </aside>
    </div>
  );
}
