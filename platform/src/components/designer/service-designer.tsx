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
 *
 * ── Redesign: outline beside the form ─────────────────────────────────────
 *
 * The previous layout stacked an outline ABOVE the live preview inside one
 * scroll container, with a palette rail on the left and an inspector on the
 * right. Four regions, and the two that mattered — the question you were
 * editing and the effect of editing it — were the two furthest apart. On a form
 * of any length the preview had scrolled off before you finished typing.
 *
 * Three columns now, and only three:
 *
 *   STEPS      which part of the form you are in
 *   OUTLINE    the questions, edited IN PLACE — selecting one expands it into
 *              its own editor rather than filling a panel on the far side
 *   PREVIEW    the real patient form, pinned, always visible
 *
 * Three consequences worth stating, because they are the point:
 *
 * - The 18-type palette is a SEARCH field, not a rail of eighteen items. It
 *   sits at the top of the outline, so a question is added where questions
 *   live. Typing filters; Enter takes the best match.
 *
 * - Follow-ups appear TWICE, deliberately: as a branch of the tree tagged with
 *   the answer that triggers them, and inside the parent's editor arranged by
 *   answer. The tree is for seeing the logic; the editor is for changing it.
 *
 * - The inspector is gone, so there is nothing to collapse on the right. The
 *   outline itself folds away instead, which is the case that actually comes
 *   up — checking the whole form at patient width before publishing.
 *
 * Nothing below changes what the designer DOES. Every mutation — add, edit,
 * reorder, delete, publish — is the same function it was, called from a
 * different place.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, CornerDownRight,
  Stethoscope, Check, Search, X,
  PanelLeftClose, PanelLeftOpen, GripVertical, ExternalLink,
  ClipboardCheck, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { FormWizard } from '@/components/form/wizard';
import { RevealsEditor } from './reveals-editor';
import type {
  FormField, FormSchema, FormStep, FieldType, FieldOption, ConsentClause,
  Presentation, MeasurementKind, DerivedCalculation, VisibilityRule,
} from '@/types/form-schema';

/**
 * How a question may be presented, by type.
 *
 * The list is per-type on purpose: "chips" is meaningless for a Yes/No and
 * "pills" is meaningless for a ten-option dropdown. Offering every presentation
 * for every type would let him build combinations the renderer does not honour,
 * which looks like the form is broken rather than the choice being wrong.
 *
 * A type absent from this map has one sensible presentation and no chooser.
 */
const PRESENTATIONS: Partial<Record<FieldType, { value: Presentation; label: string }[]>> = {
  yesNo: [
    { value: 'pills', label: 'Two large pills' },
    { value: 'segmented', label: 'Segmented control' },
  ],
  yesNoNa: [
    { value: 'pills', label: 'Large pills' },
    { value: 'segmented', label: 'Segmented control' },
  ],
  select: [
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'radioList', label: 'One per line' },
  ],
  multiSelect: [
    { value: 'chips', label: 'Chips' },
    { value: 'checkList', label: 'Tick list' },
  ],
  checkboxGroup: [
    { value: 'checkList', label: 'Tick list' },
    { value: 'chips', label: 'Chips' },
  ],
  scale: [
    { value: 'radioList', label: 'One per line' },
    { value: 'segmented', label: 'Segmented control' },
  ],
};

const MEASUREMENT_KINDS: { value: MeasurementKind; label: string }[] = [
  { value: 'weight', label: 'Weight' },
  { value: 'height', label: 'Height' },
  { value: 'length', label: 'Length or circumference' },
];

const CALCULATIONS: { value: DerivedCalculation; label: string; inputs: string[] }[] = [
  { value: 'bmi', label: 'BMI', inputs: ['weight', 'height'] },
  { value: 'age', label: 'Age', inputs: ['dateOfBirth'] },
  { value: 'weightLossPercent', label: 'Weight lost (%)', inputs: ['startingWeight', 'weight'] },
];

/**
 * Which limits mean anything, by type.
 *
 * Read off `validateField` in runtime.ts rather than guessed: min/max are
 * applied when the answer is numeric, and minLength/maxLength/pattern when it
 * is a string. Offering a character limit on a number question would be a box
 * that silently does nothing.
 */
const NUMERIC_LIMIT_TYPES: FieldType[] = ['number', 'measurement', 'derived'];
const TEXT_LIMIT_TYPES: FieldType[] = ['shortText', 'longText', 'address', 'email', 'phone'];

/** Types where a placeholder is shown at all. */
const PLACEHOLDER_TYPES: FieldType[] = [
  'shortText', 'longText', 'number', 'email', 'phone', 'address',
];

/**
 * The palette. This list is the entire vocabulary — he picks, never invents.
 *
 * `group` is new and is presentation only: it decides which heading an entry
 * sits under when the search box is browsed rather than typed into. Eighteen
 * ungrouped items is a list you read; five groups is a list you scan.
 *
 * The hints are written for a pharmacist, not a developer — "Weight, height or
 * waist" rather than "measurement".
 */
type PaletteGroup = 'Choice' | 'Text' | 'Numbers & dates' | 'Media & consent' | 'Layout';

const GROUP_ORDER: PaletteGroup[] = ['Choice', 'Text', 'Numbers & dates', 'Media & consent', 'Layout'];

const PALETTE: { type: FieldType; label: string; hint: string; group: PaletteGroup; presentation?: string }[] = [
  { type: 'yesNo', label: 'Yes / No', hint: 'Two pills, with an optional follow-up', group: 'Choice', presentation: 'pills' },
  { type: 'yesNoNa', label: 'Yes / No / Not applicable', hint: 'When "not applicable" is a real answer', group: 'Choice', presentation: 'pills' },
  { type: 'select', label: 'Dropdown', hint: 'One of many', group: 'Choice', presentation: 'dropdown' },
  { type: 'multiSelect', label: 'Multi-select', hint: 'Chips — pick several', group: 'Choice', presentation: 'chips' },
  { type: 'checkboxGroup', label: 'Checklist', hint: 'Tick all that apply', group: 'Choice', presentation: 'checkList' },
  { type: 'scale', label: 'Severity scale', hint: 'One per line, ordered', group: 'Choice' },
  { type: 'shortText', label: 'Short text', hint: 'A single line', group: 'Text' },
  { type: 'longText', label: 'Long text', hint: 'A paragraph', group: 'Text' },
  { type: 'email', label: 'Email', hint: 'Validated', group: 'Text' },
  { type: 'phone', label: 'Phone', hint: 'Validated', group: 'Text' },
  { type: 'address', label: 'Address', hint: 'Multi-line', group: 'Text' },
  { type: 'number', label: 'Number', hint: 'Numeric only', group: 'Numbers & dates' },
  { type: 'dateOfBirth', label: 'Date of birth', hint: 'Day, month, year', group: 'Numbers & dates' },
  { type: 'date', label: 'Date', hint: 'A calendar date — last vaccination, travel date', group: 'Numbers & dates' },
  { type: 'measurement', label: 'Measurement', hint: 'Weight, height or waist — metric or imperial', group: 'Numbers & dates' },
  { type: 'derived', label: 'Calculated value', hint: 'BMI from weight and height, or age from date of birth', group: 'Numbers & dates' },
  { type: 'fileUpload', label: 'File upload', hint: 'Photo or PDF', group: 'Media & consent' },
  { type: 'photoCapture', label: 'Take a photo', hint: 'Camera only', group: 'Media & consent' },
  { type: 'signature', label: 'Signature', hint: 'Finger or mouse', group: 'Media & consent' },
  { type: 'consentList', label: 'Consent', hint: 'Statements to read, and one box to tick', group: 'Media & consent' },
  { type: 'infoBlock', label: 'Information', hint: 'Text, no answer', group: 'Layout' },
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

/** How many branches a step contains — shown so the logic is countable. */
function countBranches(step: FormStep | undefined): number {
  if (!step) return 0;
  let n = 0;
  const walk = (fields: FormField[]) => {
    for (const f of fields) {
      for (const r of f.reveals ?? []) {
        n += 1;
        walk(r.fields);
      }
    }
  };
  walk(step.fields);
  return n;
}

/**
 * Every question in the form, flattened, with the step it sits in.
 *
 * Used by the visibility editor's field picker. Follow-ups are included —
 * they are ordinary questions and a later question may legitimately depend on
 * one — and the question being edited is excluded, because a rule that reads
 * its own answer can never be satisfied before it is answered.
 */
function allQuestions(
  schema: FormSchema,
  exceptId: string,
): { id: string; label: string; step: string; field: FormField }[] {
  const out: { id: string; label: string; step: string; field: FormField }[] = [];
  for (const step of schema.steps) {
    const walk = (fields: FormField[]) => {
      for (const f of fields) {
        if (f.id !== exceptId && f.type !== 'infoBlock') {
          out.push({ id: f.id, label: f.label, step: step.title, field: f });
        }
        for (const r of f.reveals ?? []) walk(r.fields);
      }
    };
    walk(step.fields);
  }
  return out;
}

/**
 * The answers a question can actually take.
 *
 * Read from the same place the CONTROL reads them — 'yes' / 'no' / 'na' are the
 * literal strings PillToggle writes — so a warning can never be attached to an
 * answer that does not occur. Getting this wrong is invisible: the warning
 * simply never fires, on a question about pregnancy or a bleeding disorder.
 */
function answerChoices(field: FormField): { value: string; label: string }[] {
  if (field.type === 'yesNoNa') {
    return [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'na', label: 'Not applicable' },
    ];
  }
  if (field.type === 'yesNo') {
    return [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ];
  }
  return (field.options ?? []).map((o) => ({ value: o.value, label: o.label }));
}

/** The answer's own wording, so a branch reads "if Other", not "if option_3". */
function answerLabel(parent: FormField, whenValue: unknown): string {
  const match = parent.options?.find((o) => o.value === whenValue);
  if (match) return match.label;
  if (whenValue === 'yes') return 'Yes';
  if (whenValue === 'no') return 'No';
  return String(whenValue);
}

export interface DesignerProps {
  initialSchema: FormSchema;
  serviceName: string;
  /** Shown as the "live" chip. Presentation only. */
  currentVersion?: number;
  /** Where "Open as patient" goes. Omitted, the link is not rendered. */
  previewHref?: string;
  onPublish?: (schema: FormSchema) => Promise<void> | void;
}

export function ServiceDesigner({
  initialSchema,
  serviceName,
  currentVersion,
  previewHref,
  onPublish,
}: DesignerProps) {
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The outline folds away so the real form can be checked at full width.
  const [outlineOpen, setOutlineOpen] = useState(true);
  /*
   * The outline column shows one of two things.
   *
   * Declarations are not questions and belong to no step — they are ticked by
   * the pharmacist on the consultation screen, not by the patient — so they
   * cannot hang off a selected field the way consent does. They get the column
   * to themselves instead.
   */
  const [view, setView] = useState<'questions' | 'settings'>('questions');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  // Palette search. Open only while it has focus or a query, so the outline is
  // not permanently wearing a dropdown.
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);

  /*
   * Naming a step.
   *
   * A new step arrives called "Step 4" and is immediately focused with its name
   * selected, so typing replaces it. The generated name is a starting point, not
   * a label you then have to hunt for a way to change — which is exactly what it
   * was before this.
   */
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [focusTitle, setFocusTitle] = useState(false);

  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
    setFocusTitle(false);
  }, [focusTitle]);

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

    // Adding is a one-shot action: clear the search so the next question starts
    // from a clean field rather than the last thing typed.
    setPaletteQuery('');
    setPaletteOpen(false);
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

  /**
   * The consent clauses.
   *
   * These live on the SCHEMA, not on the field — deliberately, so the exact
   * wording is versioned with the form and it stays provable which text a
   * patient agreed to. The consequence is that every consent question in one
   * form shares one list, which the editor says out loud rather than leaving
   * you to discover by editing one and changing another.
   */
  function updateConsentClauses(clauses: ConsentClause[]) {
    mutate((draft) => {
      draft.consentClauses = clauses;
      return draft;
    });
  }

  /**
   * The form's own settings.
   *
   * All four are visible to the PATIENT — the heading, the line under it, the
   * "about 3 minutes" estimate and whether questions are numbered — and none of
   * them could be changed outside a seed file.
   */
  function updateFormMeta(patch: Partial<FormSchema>) {
    mutate((draft) => Object.assign(draft, patch));
  }

  /** Ticked by the pharmacist at the appointment, never by the patient. */
  function updateDeclarations(clauses: ConsentClause[]) {
    mutate((draft) => {
      draft.clinicianDeclarations = clauses;
      return draft;
    });
  }

  function renameStep(index: number, title: string) {
    mutate((draft) => {
      const target = draft.steps[index];
      if (target) target.title = title;
      return draft;
    });
  }

  /**
   * A step with no name renders as a blank heading on the patient's form, so an
   * emptied name falls back to its position rather than being allowed to ship.
   * This runs on blur, not on every keystroke — otherwise clearing the field to
   * retype it would fight you by refilling as you delete.
   */
  function ensureStepNamed(index: number) {
    const current = schema.steps[index];
    if (!current || current.title.trim() !== '') return;
    renameStep(index, `Step ${index + 1}`);
  }

  /**
   * Deleting a step takes its questions with it, so the last one is protected:
   * a form with no steps has nothing to render and no way back to a state that
   * does. Everything else is undone by not publishing.
   */
  function removeStep(index: number) {
    if (schema.steps.length <= 1) return;
    mutate((draft) => {
      draft.steps.splice(index, 1);
      return draft;
    });
    // Stay in range. Deleting the last step in the list would otherwise leave
    // stepIndex pointing past the end and the column would render empty.
    setStepIndex((current) => Math.max(0, Math.min(current, schema.steps.length - 2)));
    setSelectedId(null);
  }

  function moveStep(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= schema.steps.length) return;
    mutate((draft) => {
      const [moved] = draft.steps.splice(index, 1);
      if (moved) draft.steps.splice(to, 0, moved);
      return draft;
    });
    // Follow the step you just moved, rather than whatever slid into its place.
    setStepIndex(to);
  }

  function describeStep(index: number, description: string) {
    mutate((draft) => {
      const target = draft.steps[index];
      if (target) target.description = description || undefined;
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
    setSelectedId(null);
    setView('questions');
    // The name field lives in the outline, so there is no point focusing it
    // while the outline is folded away.
    setOutlineOpen(true);
    setFocusTitle(true);
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

  /**
   * Search matches the label AND the hint, so "weight" finds Measurement even
   * though the word does not appear in its name. That is the whole reason the
   * hints are written in his vocabulary rather than the schema's.
   */
  const paletteMatches = useMemo(() => {
    const needle = paletteQuery.trim().toLowerCase();
    if (!needle) return PALETTE;
    return PALETTE.filter(
      (p) => p.label.toLowerCase().includes(needle) || p.hint.toLowerCase().includes(needle),
    );
  }, [paletteQuery]);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: paletteMatches.filter((p) => p.group === group),
      })).filter((g) => g.items.length > 0),
    [paletteMatches],
  );

  const totals = useMemo(() => {
    const ids = collectIds(schema);
    let clinicianOnly = 0;
    let branches = 0;
    const walk = (fields: FormField[]) => {
      for (const f of fields) {
        if (f.clinicianOnly) clinicianOnly += 1;
        for (const r of f.reveals ?? []) { branches += 1; walk(r.fields); }
      }
    };
    schema.steps.forEach((s) => walk(s.fields));
    return { questions: ids.size, branches, clinicianOnly };
  }, [schema]);

  return (
    <div className="flex h-[calc(100vh-60px)] flex-col">

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[15px] font-semibold text-ink">{serviceName}</h1>
          <div className="flex items-center gap-2 text-[11.5px] text-ink-faint">
            <span className="rounded-[4px] bg-review-100 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.05em] text-review-700">
              draft
            </span>
            <span>publishing creates a new version</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {currentVersion !== undefined ? (
            <span className="rounded-[5px] bg-sunk px-2 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-ink-faint">
              live: v{currentVersion}
            </span>
          ) : null}

          {previewHref ? (
            <a
              href={previewHref}
              className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
            >
              <ExternalLink size={13} strokeWidth={2} />
              Open as patient
            </a>
          ) : null}

          {published ? (
            <span className="flex items-center gap-1.5 rounded-[6px] bg-safe-100 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-safe-700">
              <Check size={12} strokeWidth={2.6} /> Published
            </span>
          ) : null}

          <button
            type="button"
            onClick={publish}
            disabled={publishing || !onPublish}
            className="rounded-control bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {publishing ? 'Publishing…' : 'Publish this version'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">

        {/* ── Steps ─────────────────────────────────────── */}
        <aside className="hidden w-[180px] shrink-0 flex-col border-r border-line bg-nav p-2.5 lg:flex">
          <div className="px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
            Steps
          </div>

          <div className="flex flex-col gap-0.5">
            {schema.steps.map((s, i) => {
              const active = i === stepIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setStepIndex(i); setSelectedId(null); setView('questions'); }}
                  // The rail is where you look at a step's name, so it is where
                  // you will try to change it. Double-click sends you to the
                  // field that does, rather than doing nothing.
                  onDoubleClick={() => {
                    setStepIndex(i);
                    setSelectedId(null);
                    setView('questions');
                    setOutlineOpen(true);
                    setFocusTitle(true);
                  }}
                  title={`${s.title} — double-click to rename`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-brand-50' : 'hover:bg-sunk',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-brand-600 transition-all',
                      active ? 'h-[18px] opacity-100' : 'h-0 opacity-0',
                    )}
                  />
                  <span className={cn('tabular w-[13px] shrink-0 font-mono text-[11px]', active ? 'text-brand-600' : 'text-ink-faint')}>
                    {i + 1}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate text-[13px]', active ? 'font-semibold text-brand-700' : 'font-medium text-ink-soft')}>
                    {s.title}
                  </span>
                  <span className={cn('tabular shrink-0 font-mono text-[10px]', active ? 'text-brand-400' : 'text-ink-faint')}>
                    {s.fields.length}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addStep}
            className="mt-1.5 flex items-center gap-2 rounded-control border border-dashed border-line px-2.5 py-2 text-[12.5px] font-medium text-ink-faint transition-colors hover:border-brand-300 hover:text-ink"
          >
            <Plus size={13} strokeWidth={2.2} />
            Add step
          </button>

          {/* A form's shape in three numbers. Branches especially: it is the one
              thing that is easy to lose track of and expensive to get wrong. */}
          <div className="mt-auto border-t border-line-soft pt-2.5">
            <div className="px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
              Whole form
            </div>

            {/*
              Not a step, so it does not sit in the step list — but it is part
              of the form and had nowhere at all to be edited before this.
            */}
            <button
              type="button"
              onClick={() => { setView('settings'); setOutlineOpen(true); }}
              aria-current={view === 'settings' ? 'true' : undefined}
              className={cn(
                'relative mb-2 flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors',
                view === 'settings' ? 'bg-brand-50' : 'hover:bg-sunk',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-brand-600 transition-all',
                  view === 'settings' ? 'h-[18px] opacity-100' : 'h-0 opacity-0',
                )}
              />
              <ClipboardCheck
                size={14}
                strokeWidth={1.9}
                className={cn('shrink-0', view === 'settings' ? 'text-brand-600' : 'text-ink-faint')}
              />
              <span className={cn('min-w-0 flex-1 truncate text-[13px]', view === 'settings' ? 'font-semibold text-brand-700' : 'font-medium text-ink-soft')}>
                Form settings
              </span>
            </button>

            <div className="px-2">
              <Total label="Questions" value={totals.questions} />
              <Total label="Branches" value={totals.branches} />
              <Total label="Pharmacist-only" value={totals.clinicianOnly} />
            </div>
          </div>
        </aside>

        {/* ── Outline ───────────────────────────────────── */}
        {outlineOpen ? (
          <section className="flex w-full min-w-0 shrink-0 flex-col border-r border-line bg-surface lg:w-[468px]">

          {view === 'settings' ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-line-soft bg-nav px-3 py-2">
                <button
                  type="button"
                  onClick={() => setView('questions')}
                  className="flex shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-[12.5px] font-medium text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
                >
                  <ArrowLeft size={13} strokeWidth={2} />
                  Questions
                </button>
                <span className="min-w-0 flex-1 truncate px-1 font-display text-[13.5px] font-semibold text-ink">
                  Form settings
                </span>
                <button
                  type="button"
                  onClick={() => setOutlineOpen(false)}
                  aria-label="Hide the outline"
                  title="Hide the outline"
                  className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
                >
                  <PanelLeftClose size={14} strokeWidth={2} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">

                <div className="mb-5 flex flex-col gap-3.5">
                  <Labelled label="Form heading">
                    <input
                      value={schema.title}
                      onChange={(e) => updateFormMeta({ title: e.target.value })}
                      aria-label="Form heading"
                      className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
                    />
                  </Labelled>

                  <Labelled label="Line under the heading">
                    <input
                      value={schema.description ?? ''}
                      onChange={(e) => updateFormMeta({ description: e.target.value || undefined })}
                      placeholder="Optional"
                      aria-label="Form description"
                      className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
                    />
                  </Labelled>

                  <Labelled label="How long it takes">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={schema.estimatedMinutes ?? ''}
                        onChange={(e) =>
                          updateFormMeta({
                            estimatedMinutes: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="—"
                        aria-label="Estimated minutes"
                        className="tabular w-[84px] rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
                      />
                      <span className="text-[12.5px] text-ink-faint">
                        minutes, shown to the patient before they start
                      </span>
                    </div>
                  </Labelled>

                  <Toggle
                    label="Number the questions"
                    hint="Shows 1, 2, 3… so staff and patients can refer to “question 7”"
                    checked={schema.numberQuestions ?? false}
                    onChange={(v) => updateFormMeta({ numberQuestions: v })}
                  />
                </div>

                <div className="mb-2.5 border-t border-line-soft pt-4">
                  <SectionHeading>Pharmacist declarations</SectionHeading>
                </div>

                {/*
                  Said plainly, because the preview beside this shows the
                  PATIENT's form and these will never appear in it. Without the
                  note it looks as though the editor is not working.
                */}
                <p className="mb-3 rounded-control border border-line-soft bg-sunk px-3 py-2.5 text-[12px] leading-relaxed text-ink-soft">
                  Ticked by the pharmacist on the consultation screen before a
                  consultation can be completed — never by the patient, and never
                  shown on the form in the preview.
                </p>

                <ClauseEditor
                  clauses={schema.clinicianDeclarations ?? []}
                  onChange={updateDeclarations}
                  idPrefix="declaration"
                  itemLabel="Declaration"
                  addLabel="Add a declaration"
                  emptyHint="No declarations. The pharmacist will be able to complete a consultation without confirming anything."
                  footnote="Every one must be ticked before a consultation can be completed. They are published with the version, so it stays provable what was confirmed."
                />
              </div>
            </>
          ) : (
            <>

            {/* Add a question — search, not a rail of eighteen */}
            <div className="relative shrink-0 border-b border-line-soft p-3">
              <div
                className={cn(
                  'flex items-center gap-2.5 rounded-control border bg-canvas px-3 py-2 transition-[border-color,box-shadow]',
                  paletteOpen ? 'border-brand-400 shadow-[0_0_0_3px_var(--color-brand-50)]' : 'border-line',
                )}
              >
                {paletteOpen ? (
                  <Search size={14} strokeWidth={2.2} className="shrink-0 text-brand-500" />
                ) : (
                  <Plus size={14} strokeWidth={2.2} className="shrink-0 text-ink-faint" />
                )}
                <input
                  value={paletteQuery}
                  onChange={(e) => { setPaletteQuery(e.target.value); setPaletteOpen(true); }}
                  onFocus={() => setPaletteOpen(true)}
                  onKeyDown={(e) => {
                    // Enter takes the best match — the fast path once he knows
                    // what things are called.
                    if (e.key === 'Enter') {
                      const best = paletteMatches[0];
                      if (best) addField(best.type, best.presentation);
                    }
                    if (e.key === 'Escape') { setPaletteQuery(''); setPaletteOpen(false); }
                  }}
                  placeholder="Add a question — type to find one…"
                  aria-label="Add a question"
                  className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
                />
                {paletteOpen ? (
                  <button
                    type="button"
                    onClick={() => { setPaletteQuery(''); setPaletteOpen(false); }}
                    aria-label="Close"
                    className="shrink-0 rounded-[5px] p-0.5 text-ink-faint transition-colors hover:text-ink"
                  >
                    <X size={13} strokeWidth={2.2} />
                  </button>
                ) : (
                  <kbd className="shrink-0 rounded-[5px] border border-line bg-surface px-1.5 py-px font-mono text-[10px] text-ink-faint">
                    /
                  </kbd>
                )}
              </div>

              {paletteOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => { setPaletteQuery(''); setPaletteOpen(false); }}
                    aria-hidden="true"
                  />
                  <div className="absolute inset-x-3 top-full z-20 mt-1 max-h-[420px] animate-pop overflow-y-auto rounded-panel border border-line bg-surface p-1.5 shadow-pop">
                    {grouped.length === 0 ? (
                      <p className="px-3 py-6 text-center text-[13px] text-ink-faint">
                        No question type matches “{paletteQuery}”.
                      </p>
                    ) : (
                      grouped.map(({ group, items }) => (
                        <div key={group}>
                          <div className="px-3 pb-1 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.11em] text-ink-faint">
                            {group}
                          </div>
                          {items.map((item) => (
                            <button
                              key={item.type + item.label}
                              type="button"
                              onClick={() => addField(item.type, item.presentation)}
                              className="flex w-full items-start gap-2.5 rounded-[9px] px-3 py-2 text-left transition-colors hover:bg-sunk"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13.5px] font-medium text-ink">{item.label}</span>
                                <span className="block text-[11.5px] leading-tight text-ink-faint">{item.hint}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>

            {/*
              The step's name, and how much logic is in it.

              The name is an input that looks like a heading until you touch it:
              no border at rest, one on hover, a focus ring when you are in it.
              A separate "rename" button would be a control you have to find;
              this is the label itself, where you already are.
            */}
            <div className="flex shrink-0 items-center gap-2 border-b border-line-soft bg-nav px-3 py-2">
              <input
                ref={titleRef}
                value={step?.title ?? ''}
                onChange={(e) => renameStep(stepIndex, e.target.value)}
                onBlur={() => ensureStepNamed(stepIndex)}
                onKeyDown={(e) => {
                  // Enter is "done naming", not "submit" — there is no form to
                  // submit and the change is already applied.
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                disabled={!step}
                placeholder="Name this step"
                aria-label="Step name"
                title="Rename this step"
                className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-2 py-1 font-display text-[13.5px] font-semibold text-ink transition-[border-color,background,box-shadow] placeholder:font-sans placeholder:font-normal placeholder:text-ink-faint hover:border-line hover:bg-surface focus:border-brand-400 focus:bg-surface focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              <span className="tabular shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                {step?.fields.length ?? 0}
              </span>

              {countBranches(step) > 0 ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-[6px] border border-review-200 bg-review-50 px-2 py-0.5 text-[11px] font-medium text-review-700">
                  <CornerDownRight size={11} strokeWidth={2.2} />
                  {countBranches(step)} branch{countBranches(step) === 1 ? '' : 'es'}
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
                aria-label="Hide the outline"
                title="Hide the outline"
                className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
              >
                <PanelLeftClose size={14} strokeWidth={2} />
              </button>
            </div>

            {/*
              The step's own subtitle and the operations on the step itself.

              The description is shown to the PATIENT under the step heading —
              "Please read these carefully before signing." — and was previously
              only settable in the seed files.
            */}
            <div className="flex shrink-0 items-center gap-1 border-b border-line-soft bg-nav px-3 pb-2">
              <input
                value={step?.description ?? ''}
                onChange={(e) => describeStep(stepIndex, e.target.value)}
                disabled={!step}
                placeholder="A line of guidance for the patient (optional)"
                aria-label="Step description"
                className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-2 py-1 text-[12.5px] text-ink-soft transition-[border-color,background,box-shadow] placeholder:text-ink-faint hover:border-line hover:bg-surface focus:border-brand-400 focus:bg-surface focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              <button
                type="button"
                onClick={() => moveStep(stepIndex, -1)}
                disabled={stepIndex === 0}
                aria-label="Move this step earlier"
                title="Move this step earlier"
                className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronUp size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => moveStep(stepIndex, 1)}
                disabled={stepIndex >= schema.steps.length - 1}
                aria-label="Move this step later"
                title="Move this step later"
                className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronDown size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => removeStep(stepIndex)}
                disabled={schema.steps.length <= 1}
                aria-label="Delete this step"
                title={
                  schema.steps.length <= 1
                    ? 'A form needs at least one step'
                    : `Delete this step and its ${step?.fields.length ?? 0} question${step?.fields.length === 1 ? '' : 's'}`
                }
                className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:bg-sunk hover:text-stop-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {step && step.fields.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {step.fields.map((f, i) => (
                    <QuestionNode
                      key={f.id}
                      field={f}
                      index={i}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      schema={schema}
                      selected={selected}
                      updateSelected={updateSelected}
                      removeSelected={removeSelected}
                      moveSelected={moveSelected}
                      updateConsentClauses={updateConsentClauses}
                    />
                  ))}
                </div>
              ) : (
                <EmptyOutline />
              )}
            </div>
            </>
          )}
          </section>
        ) : null}

        {/* ── Live preview ──────────────────────────────── */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-nav px-4 py-2">
            {!outlineOpen ? (
              <button
                type="button"
                onClick={() => setOutlineOpen(true)}
                title="Show the outline"
                className="flex shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
              >
                <PanelLeftOpen size={13} strokeWidth={2} />
                Outline
              </button>
            ) : null}
            <Eye size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />
            <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
              Live preview — the real patient form
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <FormWizard schema={schema} preview />
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── Outline pieces ──────────────────────────────────────────────────────── */

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[11.5px] text-ink-soft">
      <span>{label}</span>
      <span className="tabular font-mono">{value}</span>
    </div>
  );
}

function EmptyOutline() {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-ink">No questions yet</p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-faint">
        Add your first one from the field above. Everything you add appears in the
        patient form on the right as you go.
      </p>
    </div>
  );
}

/**
 * One question in the outline — and, when it is the selected one, its editor.
 *
 * Editing in place rather than in a panel on the far side of the screen is the
 * whole point of this layout: the row you clicked grows into the thing you
 * needed, and the question stays where you found it.
 *
 * Recursive, because a follow-up is a question like any other and has to be
 * editable the same way. It renders one level indented under a chip naming the
 * answer that reveals it, on a connector line — so the logic is legible without
 * opening anything.
 */
function QuestionNode({
  field,
  index,
  depth = 0,
  branchLabel,
  selectedId,
  onSelect,
  schema,
  selected,
  updateSelected,
  removeSelected,
  moveSelected,
  updateConsentClauses,
}: {
  field: FormField;
  index?: number;
  depth?: number;
  branchLabel?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  schema: FormSchema;
  selected: FormField | null;
  updateSelected: (patch: Partial<FormField>) => void;
  removeSelected: () => void;
  moveSelected: (direction: -1 | 1) => void;
  updateConsentClauses: (clauses: ConsentClause[]) => void;
}) {
  const isSelected = selectedId === field.id;

  const row = (
    <div
      className={cn(
        'overflow-hidden rounded-panel border transition-colors',
        isSelected ? 'border-brand-300 bg-brand-50' : 'border-line-soft bg-surface hover:border-brand-200',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(field.id)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
      >
        {depth === 0 ? (
          <GripVertical
            size={12}
            strokeWidth={2}
            className={cn('shrink-0', isSelected ? 'text-brand-400' : 'text-brand-300')}
          />
        ) : null}

        {branchLabel ? (
          <span className="shrink-0 rounded-[4px] bg-brand-100 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.04em] text-brand-700">
            if {branchLabel}
          </span>
        ) : (
          <span className={cn('tabular w-[14px] shrink-0 font-mono text-[11px]', isSelected ? 'text-brand-600' : 'text-ink-faint')}>
            {(index ?? 0) + 1}
          </span>
        )}

        <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', isSelected ? 'font-semibold text-brand-700' : 'text-ink')}>
          {field.label}
        </span>

        {field.clinicianOnly ? (
          <Stethoscope size={13} strokeWidth={2} className="shrink-0 text-brand-500" />
        ) : null}

        <span className="shrink-0 rounded-[4px] bg-sunk px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.04em] text-ink-faint">
          {field.type}
        </span>
      </button>

      {isSelected && selected ? (
        <div className="border-t border-brand-200 bg-surface px-3.5 pb-4 pt-3.5">
          <QuestionEditor
            selected={selected}
            selectedId={selectedId}
            schema={schema}
            onSelectField={onSelect}
            updateSelected={updateSelected}
            removeSelected={removeSelected}
            moveSelected={moveSelected}
            updateConsentClauses={updateConsentClauses}
            canReorder={depth === 0}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-1">
      {row}

      {(field.reveals ?? []).map((reveal, ri) =>
        reveal.fields.map((child) => (
          <div key={child.id} className="flex items-stretch">
            {/* The connector. Purely decorative, so it is hidden from
                assistive technology — the "if Other" chip carries the meaning. */}
            <div className="relative w-[26px] shrink-0" aria-hidden="true">
              <span className="absolute bottom-1/2 left-[13px] top-0 w-[2px] bg-brand-200" />
              <span className="absolute left-[13px] top-1/2 h-[2px] w-[10px] bg-brand-200" />
            </div>
            <div className="min-w-0 flex-1">
              <QuestionNode
                field={child}
                depth={depth + 1}
                branchLabel={answerLabel(field, reveal.whenValue)}
                selectedId={selectedId}
                onSelect={onSelect}
                schema={schema}
                selected={selected}
                updateSelected={updateSelected}
                removeSelected={removeSelected}
                moveSelected={moveSelected}
                updateConsentClauses={updateConsentClauses}
              />
            </div>
          </div>
        )),
      )}
    </div>
  );
}

/**
 * The editor that opens inside the selected row.
 *
 * Identical in content to the inspector it replaces — the same fields calling
 * the same functions — but arranged for a 400px column rather than a 300px
 * panel, and sitting under the question it edits.
 */
function QuestionEditor({
  selected,
  selectedId,
  schema,
  onSelectField,
  updateSelected,
  removeSelected,
  moveSelected,
  updateConsentClauses,
  canReorder,
}: {
  selected: FormField;
  selectedId: string | null;
  schema: FormSchema;
  onSelectField: (id: string) => void;
  updateSelected: (patch: Partial<FormField>) => void;
  removeSelected: () => void;
  moveSelected: (direction: -1 | 1) => void;
  updateConsentClauses: (clauses: ConsentClause[]) => void;
  canReorder: boolean;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <Labelled label="Question text">
        <textarea
          rows={2}
          value={selected.label}
          onChange={(e) => updateSelected({ label: e.target.value })}
          className="w-full resize-y rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
        />
      </Labelled>

      <Labelled label="Help text">
        <input
          value={selected.helpText ?? ''}
          onChange={(e) => updateSelected({ helpText: e.target.value || undefined })}
          placeholder="Optional"
          className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
        />
      </Labelled>

      {PLACEHOLDER_TYPES.includes(selected.type) ? (
        <Labelled label="Placeholder">
          <input
            value={selected.placeholder ?? ''}
            onChange={(e) => updateSelected({ placeholder: e.target.value || undefined })}
            placeholder="Greyed-out example text inside the box"
            className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
          />
        </Labelled>
      ) : null}

      {PRESENTATIONS[selected.type] ? (
        <Labelled label="How it looks">
          <div className="flex flex-wrap gap-1.5">
            {PRESENTATIONS[selected.type]!.map((option) => {
              const active = (selected.presentation ?? PRESENTATIONS[selected.type]![0]!.value) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateSelected({ presentation: option.value })}
                  aria-pressed={active}
                  className={cn(
                    'rounded-control border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    active
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </Labelled>
      ) : null}

      {selected.type === 'measurement' ? (
        <Labelled label="What is being measured">
          {/*
            Every measurement question created from the palette was hard-wired
            to weight, so a height question could not be built at all — the unit
            switch and the validation both key off this.
          */}
          <div className="flex flex-wrap gap-1.5">
            {MEASUREMENT_KINDS.map((kind) => {
              const active = (selected.measurementKind ?? 'weight') === kind.value;
              return (
                <button
                  key={kind.value}
                  type="button"
                  onClick={() => updateSelected({ measurementKind: kind.value })}
                  aria-pressed={active}
                  className={cn(
                    'rounded-control border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    active
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink',
                  )}
                >
                  {kind.label}
                </button>
              );
            })}
          </div>
        </Labelled>
      ) : null}

      {selected.type === 'derived' ? (
        <Labelled label="What to calculate">
          {/*
            The inputs move with the calculation. Choosing "Age" and leaving
            calculationInputs on ['weight','height'] would produce a field that
            silently never resolves, so the two are always set together.
          */}
          <div className="flex flex-wrap gap-1.5">
            {CALCULATIONS.map((calc) => {
              const active = (selected.calculation ?? 'bmi') === calc.value;
              return (
                <button
                  key={calc.value}
                  type="button"
                  onClick={() =>
                    updateSelected({ calculation: calc.value, calculationInputs: [...calc.inputs] })
                  }
                  aria-pressed={active}
                  className={cn(
                    'rounded-control border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    active
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink',
                  )}
                >
                  {calc.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 font-mono text-[10.5px] text-ink-faint">
            reads: {(selected.calculationInputs ?? ['weight', 'height']).join(', ')}
          </p>
        </Labelled>
      ) : null}

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

      <Toggle
        label="Half width"
        hint="Sits beside the next question on a wide screen"
        checked={selected.halfWidth ?? false}
        onChange={(v) => updateSelected({ halfWidth: v })}
      />

      {selected.options ? (
        <Labelled label="Options">
          <OptionEditor
            options={selected.options}
            onChange={(options) => updateSelected({ options })}
          />
        </Labelled>
      ) : null}

      {selected.type === 'consentList' ? (
        <>
          <Labelled label="Statements the patient must accept">
            {/*
              Which list is in force is stated before it is edited, because the
              two look identical and editing the wrong one silently changes
              another question.
            */}
            <div
              className={cn(
                'mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] border px-2.5 py-1.5 text-[11.5px] leading-snug',
                selected.consentClauses
                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                  : 'border-line-soft bg-sunk text-ink-soft',
              )}
            >
              <span>
                {selected.consentClauses
                  ? 'This question has its own statements.'
                  : 'Shared with every consent question in this form.'}
              </span>
              <button
                type="button"
                onClick={() =>
                  selected.consentClauses
                    ? updateSelected({ consentClauses: undefined })
                    : // Starts as a copy of what is already showing, so
                      // splitting the list never blanks the question.
                      updateSelected({
                        consentClauses: (schema.consentClauses ?? []).map((c) => ({ ...c })),
                      })
                }
                className="font-medium underline underline-offset-2 transition-colors hover:text-ink"
              >
                {selected.consentClauses ? 'Use the shared list' : 'Give it its own'}
              </button>
            </div>

            <ClauseEditor
              clauses={selected.consentClauses ?? schema.consentClauses ?? []}
              onChange={(clauses) =>
                selected.consentClauses
                  ? updateSelected({ consentClauses: clauses })
                  : updateConsentClauses(clauses)
              }
              idPrefix="clause"
              itemLabel="Consent statement"
              addLabel="Add a statement"
              emptyHint="No statements yet. The patient would see an empty box above the tick box — add at least one."
              footnote={
                selected.consentClauses
                  ? 'These belong to this question alone. Published with the version, so it stays provable which wording a patient agreed to.'
                  : 'These belong to the whole form. Published with the version, so it stays provable which wording a patient agreed to.'
              }
            />
          </Labelled>

          <Labelled label="Tick-box wording">
            <textarea
              rows={2}
              value={selected.confirmLabel ?? ''}
              onChange={(e) => updateSelected({ confirmLabel: e.target.value || undefined })}
              placeholder="I have read and agree to all of the above."
              className="w-full resize-y rounded-control border border-line bg-surface px-2.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
            />
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
              The one sentence the patient actually signs. Left blank, it reads
              “I have read and agree to all of the above.”
            </p>
          </Labelled>
        </>
      ) : null}

      <Labelled label="Only show this question when">
        <VisibilityEditor
          field={selected}
          schema={schema}
          onChange={(visibleWhen) =>
            updateSelected({ visibleWhen: visibleWhen.length ? visibleWhen : undefined })
          }
        />
      </Labelled>

      {selected.options ? (
        <Labelled label="Carry the answer's hidden data">
          <input
            value={selected.storeMetadataAs ?? ''}
            onChange={(e) => updateSelected({ storeMetadataAs: e.target.value || undefined })}
            placeholder="Leave blank to carry nothing"
            aria-label="Store metadata as"
            className="w-full rounded-control border border-line bg-surface px-2.5 py-2 font-mono text-[12.5px] text-ink placeholder:font-sans placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
          />
          <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
            Copies the chosen option's hidden data into the submission under this
            name — how a GP surgery's mailbox reaches the record without ever
            being shown to the patient. Set the data itself on each option above.
          </p>
        </Labelled>
      ) : null}

      {NUMERIC_LIMIT_TYPES.includes(selected.type) || TEXT_LIMIT_TYPES.includes(selected.type) ? (
        <Labelled label="Limits">
          <ValidationEditor
            field={selected}
            onChange={(validation) => updateSelected({ validation })}
          />
        </Labelled>
      ) : null}

      {answerChoices(selected).length > 0 ? (
        <Labelled label="Warnings">
          <WarningEditor
            field={selected}
            onChange={(warnWhen) =>
              updateSelected({ warnWhen: warnWhen.length ? warnWhen : undefined })
            }
          />
        </Labelled>
      ) : null}

      {/* Follow-ups for ANY answerable question, not just Yes/No.
          A dropdown with an "Other" option is the commonest case in his
          forms and previously had no way to reveal anything. */}
      {selected.options || selected.type === 'yesNo' || selected.type === 'yesNoNa' ? (
        <Labelled label="Follow-up questions">
          <RevealsEditor
            field={selected}
            usedIds={collectIds(schema)}
            selectedId={selectedId}
            onSelectField={onSelectField}
            onChange={(reveals) => updateSelected({ reveals })}
          />
        </Labelled>
      ) : null}

      <div className="flex items-center gap-1.5 border-t border-line-soft pt-3">
        {canReorder ? (
          <>
            <button
              type="button"
              onClick={() => moveSelected(-1)}
              aria-label="Move up"
              title="Move up"
              className="rounded-[6px] border border-line bg-surface p-1.5 text-ink-faint transition-colors hover:border-brand-300 hover:text-ink"
            >
              <ChevronUp size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => moveSelected(1)}
              aria-label="Move down"
              title="Move down"
              className="rounded-[6px] border border-line bg-surface p-1.5 text-ink-faint transition-colors hover:border-brand-300 hover:text-ink"
            >
              <ChevronDown size={14} strokeWidth={2} />
            </button>
          </>
        ) : null}
        <span className="ml-auto font-mono text-[10.5px] text-ink-faint">{selected.id}</span>
        <button
          type="button"
          onClick={removeSelected}
          aria-label="Delete this question"
          title="Delete this question"
          className="rounded-[6px] border border-line bg-surface p-1.5 text-ink-faint transition-colors hover:border-stop-200 hover:text-stop-700"
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-faint">
      {children}
    </h3>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.07em] text-ink-faint">
        {label}
      </span>
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

/**
 * Limits on an answer.
 *
 * Only the limits that do something for this type are shown — see
 * NUMERIC_LIMIT_TYPES / TEXT_LIMIT_TYPES above.
 *
 * Two things are called out in the UI because both surprise people:
 *
 * - The message replaces EVERY message for this question, including the one
 *   shown when a required answer is simply missing. It is a single override,
 *   not a per-limit message.
 *
 * - A pattern is a regular expression. An invalid one is now caught rather than
 *   crashing validation, but a valid-but-wrong one silently rejects real
 *   answers, so the field reports whether what you typed even parses.
 */
function ValidationEditor({
  field, onChange,
}: { field: FormField; onChange: (validation: FormField['validation']) => void }) {
  const rules = field.validation ?? {};
  const numeric = NUMERIC_LIMIT_TYPES.includes(field.type);
  const text = TEXT_LIMIT_TYPES.includes(field.type);

  /** Drops the whole object once nothing is set, rather than leaving `{}`. */
  function patch(next: Partial<NonNullable<FormField['validation']>>) {
    const merged = { ...rules, ...next };
    for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
      const v = merged[key];
      if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) {
        delete merged[key];
      }
    }
    onChange(Object.keys(merged).length ? merged : undefined);
  }

  const patternValid = (() => {
    if (!rules.pattern) return null;
    try {
      new RegExp(rules.pattern);
      return true;
    } catch {
      return false;
    }
  })();

  const numberField = 'tabular w-full rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none';

  return (
    <div className="flex flex-col gap-2">
      {numeric ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-faint">Least</span>
            <input
              type="number"
              value={rules.min ?? ''}
              onChange={(e) => patch({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="—"
              className={numberField}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-faint">Most</span>
            <input
              type="number"
              value={rules.max ?? ''}
              onChange={(e) => patch({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="—"
              className={numberField}
            />
          </label>
        </div>
      ) : null}

      {text ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-ink-faint">Least characters</span>
              <input
                type="number"
                min={0}
                value={rules.minLength ?? ''}
                onChange={(e) => patch({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="—"
                className={numberField}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-ink-faint">Most characters</span>
              <input
                type="number"
                min={0}
                value={rules.maxLength ?? ''}
                onChange={(e) => patch({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="—"
                className={numberField}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-faint">Must match (regular expression)</span>
            <input
              value={rules.pattern ?? ''}
              onChange={(e) => patch({ pattern: e.target.value })}
              placeholder="Leave blank for no pattern"
              aria-invalid={patternValid === false}
              className={cn(
                'w-full rounded-[6px] border bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink placeholder:font-sans placeholder:text-ink-faint focus:outline-none',
                patternValid === false ? 'border-stop-200 focus:border-stop-600' : 'border-line focus:border-brand-400',
              )}
            />
            {patternValid === false ? (
              <span className="mt-1 block text-[11.5px] text-stop-700">
                Not a valid expression — it will be ignored rather than applied.
              </span>
            ) : null}
          </label>
        </>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-[11.5px] text-ink-faint">Message when it fails</span>
        <input
          value={rules.message ?? ''}
          onChange={(e) => patch({ message: e.target.value })}
          placeholder="Say what to do, not just what is wrong"
          className="w-full rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
        />
        <span className="mt-1 block text-[11.5px] leading-snug text-ink-faint">
          Replaces every message for this question, including the one shown when
          a required answer is missing.
        </span>
      </label>
    </div>
  );
}

const OPERATORS: { value: VisibilityRule['operator']; label: string; takesValue: 'one' | 'many' | 'none' }[] = [
  { value: 'eq', label: 'is', takesValue: 'one' },
  { value: 'neq', label: 'is not', takesValue: 'one' },
  { value: 'in', label: 'is one of', takesValue: 'many' },
  { value: 'nin', label: 'is none of', takesValue: 'many' },
  { value: 'exists', label: 'has been answered', takesValue: 'none' },
  { value: 'notExists', label: 'has not been answered', takesValue: 'none' },
];

/**
 * Rules that decide whether a question appears at all.
 *
 * Distinct from a follow-up, and the difference is worth knowing: a follow-up
 * is OWNED by the answer that reveals it and sits directly beneath it, which
 * covers "Any allergies? → yes → which ones". Visibility is for a question that
 * lives somewhere else entirely and depends on an answer given several steps
 * earlier. Reach for a follow-up first; this is the escape hatch.
 *
 * ALL rules must pass — they are ANDed, never ORed — which is stated in the UI
 * because a list of conditions is otherwise read either way.
 *
 * The value is a picker built from the target question's own answers wherever
 * it has them, so a rule cannot be pointed at an answer that does not exist.
 * That failure is silent: the question simply never appears.
 */
function VisibilityEditor({
  field, schema, onChange,
}: {
  field: FormField;
  schema: FormSchema;
  onChange: (rules: VisibilityRule[]) => void;
}) {
  const rules = field.visibleWhen ?? [];
  const candidates = allQuestions(schema, field.id);

  function patch(index: number, next: Partial<VisibilityRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...next } : r)));
  }

  if (candidates.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-ink-faint">
        Always shown — there is no other question for it to depend on yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Always shown.
        </p>
      ) : null}

      {rules.map((rule, i) => {
        const target = candidates.find((c) => c.id === rule.field);
        const choices = target ? answerChoices(target.field) : [];
        const op = OPERATORS.find((o) => o.value === rule.operator) ?? OPERATORS[0]!;
        const selectClass = 'min-w-0 rounded-[6px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand-400';

        return (
          <div key={i} className="rounded-control border border-line-soft bg-sunk p-2">
            {i > 0 ? (
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                and
              </div>
            ) : null}

            <div className="flex items-start gap-1.5">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <select
                  value={rule.field}
                  onChange={(e) => patch(i, { field: e.target.value, value: undefined })}
                  aria-label={`Question for rule ${i + 1}`}
                  className={selectClass}
                >
                  {/* A rule pointing at a deleted question is kept and marked
                      rather than silently rebound to whichever question happens
                      to be first. */}
                  {target ? null : (
                    <option value={rule.field}>{rule.field} (no longer a question)</option>
                  )}
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.step} — {c.label}</option>
                  ))}
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) =>
                    patch(i, {
                      operator: e.target.value as VisibilityRule['operator'],
                      value: undefined,
                    })
                  }
                  aria-label={`Comparison for rule ${i + 1}`}
                  className={selectClass}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {op.takesValue === 'one' ? (
                  choices.length > 0 ? (
                    <select
                      value={String(rule.value ?? '')}
                      onChange={(e) => patch(i, { value: e.target.value })}
                      aria-label={`Answer for rule ${i + 1}`}
                      className={selectClass}
                    >
                      <option value="">Choose an answer…</option>
                      {choices.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={String(rule.value ?? '')}
                      onChange={(e) => patch(i, { value: e.target.value })}
                      placeholder="The answer to match"
                      aria-label={`Answer for rule ${i + 1}`}
                      className={selectClass}
                    />
                  )
                ) : null}

                {op.takesValue === 'many' ? (
                  choices.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {choices.map((c) => {
                        const list = Array.isArray(rule.value) ? (rule.value as unknown[]) : [];
                        const on = list.includes(c.value);
                        return (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() =>
                              patch(i, {
                                value: on
                                  ? list.filter((v) => v !== c.value)
                                  : [...list, c.value],
                              })
                            }
                            aria-pressed={on}
                            className={cn(
                              'rounded-[6px] border px-2 py-1 text-[12px] font-medium transition-colors',
                              on
                                ? 'border-brand-300 bg-brand-50 text-brand-700'
                                : 'border-line bg-surface text-ink-soft hover:border-brand-300',
                            )}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      value={(Array.isArray(rule.value) ? rule.value : []).join(', ')}
                      onChange={(e) =>
                        patch(i, {
                          value: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                        })
                      }
                      placeholder="Answers to match, separated by commas"
                      aria-label={`Answers for rule ${i + 1}`}
                      className={selectClass}
                    />
                  )
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
                aria-label={`Remove rule ${i + 1}`}
                title="Remove"
                className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:text-stop-700"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() =>
          onChange([...rules, { field: candidates[0]!.id, operator: 'eq', value: undefined }])
        }
        className="flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-brand-700"
      >
        <Plus size={12} strokeWidth={2.2} /> Add a condition
      </button>

      {rules.length > 1 ? (
        <p className="text-[11.5px] leading-snug text-ink-faint">
          Every condition must be true for the question to appear.
        </p>
      ) : null}
    </div>
  );
}

type Warning = NonNullable<FormField['warnWhen']>[number];

const SEVERITIES: { value: Warning['severity']; label: string; hint: string; tone: string }[] = [
  { value: 'info', label: 'Note', hint: 'Shown, nothing else happens', tone: 'border-line bg-sunk text-ink-soft' },
  { value: 'warn', label: 'Warn', hint: 'Flagged for the pharmacist', tone: 'border-review-200 bg-review-50 text-review-700' },
  { value: 'stop', label: 'Stop', hint: 'Blocks the consultation', tone: 'border-stop-200 bg-stop-50 text-stop-700' },
];

/**
 * Warnings shown when a question is answered a particular way.
 *
 * The most clinically consequential thing in the designer, and it had no editor
 * at all: the GLP-1 forms carry seven of these — including the one that stops
 * supply during pregnancy — and every word of them lived only in a seed file.
 *
 * The answer is a SELECT of the answers this question can actually take, never
 * a free-text box. A warning attached to an answer that does not exist is not a
 * broken-looking warning, it is a silent one, and this is not the place for a
 * failure mode nobody can see.
 *
 * Severity is spelled out rather than colour-coded alone, because "stop"
 * genuinely stops a consultation and whoever picks it should read the
 * consequence rather than infer it from a red swatch.
 */
function WarningEditor({
  field, onChange,
}: { field: FormField; onChange: (warnWhen: Warning[]) => void }) {
  const warnings = field.warnWhen ?? [];
  const choices = answerChoices(field);

  function patch(index: number, next: Partial<Warning>) {
    onChange(warnings.map((w, i) => (i === index ? { ...w, ...next } : w)));
  }

  return (
    <div className="flex flex-col gap-2">
      {warnings.map((warning, i) => {
        const skin = SEVERITIES.find((sv) => sv.value === warning.severity) ?? SEVERITIES[0]!;
        const known = choices.some((c) => c.value === String(warning.value ?? ''));
        return (
          <div key={i} className={cn('rounded-control border p-2', skin.tone)}>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em]">when</span>
              <select
                value={String(warning.value ?? '')}
                onChange={(e) => patch(i, { value: e.target.value })}
                aria-label={`Answer that triggers warning ${i + 1}`}
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 py-1 text-[12.5px] text-ink outline-none"
              >
                {/* An answer that no longer exists is kept and marked rather
                    than snapping to the first option, which would quietly
                    repoint a stop warning at a different answer. */}
                {known ? null : (
                  <option value={String(warning.value ?? '')}>
                    {String(warning.value ?? '-')} (no longer an answer)
                  </option>
                )}
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange(warnings.filter((_, j) => j !== i))}
                aria-label={`Remove warning ${i + 1}`}
                title="Remove"
                className="shrink-0 rounded-[5px] p-1 transition-opacity hover:opacity-70"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-1">
              {SEVERITIES.map((sv) => (
                <button
                  key={sv.value}
                  type="button"
                  onClick={() => patch(i, { severity: sv.value })}
                  aria-pressed={warning.severity === sv.value}
                  title={sv.hint}
                  className={cn(
                    'rounded-[6px] border px-2 py-1 text-[11.5px] font-medium transition-colors',
                    warning.severity === sv.value
                      ? 'border-ink-soft bg-surface text-ink'
                      : 'border-transparent text-ink-faint hover:text-ink',
                  )}
                >
                  {sv.label}
                </button>
              ))}
              <span className="ml-auto text-[11px] opacity-80">{skin.hint}</span>
            </div>

            <textarea
              rows={2}
              value={warning.message}
              onChange={(e) => patch(i, { message: e.target.value })}
              placeholder="What the patient is told"
              aria-label={`Warning message ${i + 1}`}
              className="w-full resize-y rounded-[6px] border border-line bg-surface px-2.5 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
            />
          </div>
        );
      })}

      <button
        type="button"
        disabled={choices.length === 0}
        onClick={() =>
          onChange([...warnings, { value: choices[0]?.value ?? '', message: '', severity: 'warn' }])
        }
        className="flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-brand-700 disabled:opacity-40"
      >
        <Plus size={12} strokeWidth={2.2} /> Add a warning
      </button>
    </div>
  );
}

/**
 * A list of numbered statements somebody has to accept.
 *
 * Used twice, for the two things in this system with that shape: the consent a
 * PATIENT ticks, and the declarations a PHARMACIST ticks before completing a
 * consultation. Neither had an editor — both existed only in the seed files,
 * and the flu form ships ten of the first and four of the second.
 *
 * Two decisions apply to both:
 *
 * - Each statement is a textarea rather than an input. These are sentences,
 *   often long ones about data protection or PGD criteria, and a single-line
 *   field that scrolls sideways is unreadable for exactly the text that most
 *   needs reading.
 *
 * - Ids are stable and never reused. A statement's id is what a stored
 *   submission or consultation points at to prove which wording was accepted,
 *   so renumbering on delete would quietly repoint old records at new text.
 */
function ClauseEditor({
  clauses, onChange, idPrefix, addLabel, emptyHint, footnote, itemLabel,
}: {
  clauses: ConsentClause[];
  onChange: (clauses: ConsentClause[]) => void;
  idPrefix: string;
  addLabel: string;
  emptyHint: string;
  footnote: React.ReactNode;
  itemLabel: string;
}) {

  function nextId(): string {
    const used = new Set(clauses.map((c) => c.id));
    let n = clauses.length + 1;
    while (used.has(`${idPrefix}_${n}`)) n += 1;
    return `${idPrefix}_${n}`;
  }

  function move(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= clauses.length) return;
    const next = [...clauses];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {clauses.length === 0 ? (
        <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-[12.5px] leading-relaxed text-ink-faint">
          {emptyHint}
        </p>
      ) : null}

      {clauses.map((clause, i) => (
        <div key={clause.id} className="rounded-control border border-line-soft bg-surface p-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="tabular font-mono text-[10px] text-ink-faint">{i + 1}</span>
            <span className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${itemLabel} ${i + 1} up`}
                title="Move up"
                className="rounded-[5px] p-1 text-ink-faint transition-colors hover:text-ink disabled:opacity-30"
              >
                <ChevronUp size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === clauses.length - 1}
                aria-label={`Move ${itemLabel} ${i + 1} down`}
                title="Move down"
                className="rounded-[5px] p-1 text-ink-faint transition-colors hover:text-ink disabled:opacity-30"
              >
                <ChevronDown size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onChange(clauses.filter((_, j) => j !== i))}
                aria-label={`Remove ${itemLabel} ${i + 1}`}
                title="Remove"
                className="rounded-[5px] p-1 text-ink-faint transition-colors hover:text-stop-700"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </span>
          </div>
          <textarea
            rows={3}
            value={clause.text}
            onChange={(e) => {
              const next = [...clauses];
              next[i] = { ...clause, text: e.target.value };
              onChange(next);
            }}
            aria-label={`${itemLabel} ${i + 1}`}
            className="w-full resize-y rounded-[6px] border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...clauses, { id: nextId(), text: '' }])}
        className="flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-brand-700"
      >
        <Plus size={12} strokeWidth={2.2} /> {addLabel}
      </button>

      <div className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{footnote}</div>
    </div>
  );
}

/**
 * Restores a value to the type it already had.
 *
 * Option metadata is a free-form bag that carries real things — a GP surgery's
 * mailbox, a medicine's strength, a dose-ladder index. Editing it through text
 * inputs would turn every number into a string, so the ORIGINAL type decides
 * how the typed text is read back. A number that is edited into something
 * unparseable keeps the text rather than becoming NaN, which would be worse
 * than either.
 */
function coerceLike(original: unknown, text: string): unknown {
  if (typeof original === 'number') {
    const n = Number(text);
    return text.trim() !== '' && !Number.isNaN(n) ? n : text;
  }
  if (typeof original === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
  return text;
}

/**
 * The answers to a choice question, and the hidden data each one carries.
 *
 * The metadata half was previously invisible: the flu form's GP surgery list
 * carries an @gov.im mailbox on every option, and that is how a practice gets
 * told their patient was vaccinated. It could not be seen, let alone corrected,
 * from the designer — and a wrong address there fails silently, because the mail
 * simply goes nowhere.
 *
 * It is collapsed by default. Most options carry none, and a key/value grid
 * under every option would bury the thing you actually came to edit.
 */
function OptionEditor({
  options, onChange,
}: { options: FieldOption[]; onChange: (options: FieldOption[]) => void }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function patchOption(i: number, next: Partial<FieldOption>) {
    const copy = [...options];
    copy[i] = { ...copy[i]!, ...next };
    onChange(copy);
  }

  function setMetaKey(i: number, key: string, text: string) {
    const meta = { ...(options[i]!.metadata ?? {}) };
    meta[key] = coerceLike(meta[key], text);
    patchOption(i, { metadata: meta });
  }

  function removeMetaKey(i: number, key: string) {
    const meta = { ...(options[i]!.metadata ?? {}) };
    delete meta[key];
    patchOption(i, { metadata: Object.keys(meta).length ? meta : undefined });
  }

  function addMetaKey(i: number) {
    const meta = { ...(options[i]!.metadata ?? {}) };
    let n = 1;
    while (`key_${n}` in meta) n += 1;
    meta[`key_${n}`] = '';
    patchOption(i, { metadata: meta });
  }

  /** Renaming has to preserve order, so the object is rebuilt rather than patched. */
  function renameMetaKey(i: number, from: string, to: string) {
    const current = options[i]!.metadata ?? {};
    if (!to || (to !== from && to in current)) return;
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(current)) meta[k === from ? to : k] = v;
    patchOption(i, { metadata: meta });
  }

  const cell = 'min-w-0 rounded-[5px] border border-line bg-surface px-2 py-1 font-mono text-[11.5px] text-ink focus:border-brand-400 focus:outline-none';

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option, i) => {
        const meta = option.metadata ?? {};
        const count = Object.keys(meta).length;
        const open = openIndex === i;

        return (
          <div key={i} className={cn('rounded-[7px]', open && 'border border-line-soft bg-sunk p-1.5')}>
            <div className="flex items-center gap-1.5">
              <input
                value={option.label}
                onChange={(e) => patchOption(i, { label: e.target.value })}
                aria-label={`Option ${i + 1}`}
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setOpenIndex(open ? null : i)}
                aria-expanded={open}
                title="Hidden data carried by this option"
                className={cn(
                  'shrink-0 rounded-[6px] border px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors',
                  count > 0
                    ? 'border-brand-200 bg-brand-50 text-brand-700'
                    : 'border-line text-ink-faint hover:border-brand-300 hover:text-ink',
                )}
              >
                data{count > 0 ? ` ${count}` : ''}
              </button>
              <button
                type="button"
                onClick={() => onChange(options.filter((_, j) => j !== i))}
                aria-label={`Remove ${option.label}`}
                className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:text-stop-700"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>

            {open ? (
              <div className="mt-1.5 flex flex-col gap-1 px-0.5">
                {count === 0 ? (
                  <p className="py-1 text-[11.5px] text-ink-faint">
                    Nothing carried. Anything added here travels into the
                    submission when this option is chosen, without being shown to
                    the patient.
                  </p>
                ) : null}

                {Object.entries(meta).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-1">
                    <input
                      defaultValue={key}
                      onBlur={(e) => renameMetaKey(i, key, e.target.value.trim())}
                      aria-label={`Name of ${key}`}
                      className={cn(cell, 'w-[34%]')}
                    />
                    <span className="text-ink-faint">:</span>
                    <input
                      value={value === null || value === undefined ? '' : String(value)}
                      onChange={(e) => setMetaKey(i, key, e.target.value)}
                      aria-label={`Value of ${key}`}
                      className={cn(cell, 'flex-1')}
                    />
                    <span
                      title={`stored as ${typeof value}`}
                      className="shrink-0 font-mono text-[9.5px] uppercase text-ink-faint"
                    >
                      {typeof value === 'number' ? '123' : 'abc'}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMetaKey(i, key)}
                      aria-label={`Remove ${key}`}
                      className="shrink-0 rounded-[5px] p-1 text-ink-faint transition-colors hover:text-stop-700"
                    >
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addMetaKey(i)}
                  className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint transition-colors hover:text-brand-700"
                >
                  <Plus size={11} strokeWidth={2.2} /> Add hidden data
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

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
