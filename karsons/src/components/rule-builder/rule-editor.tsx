'use client';

/**
 * Rule editor.
 *
 * Lets the client author a clinical rule — its conditions, thresholds and
 * outcome — without a developer. Toggling rules on and off was not enough:
 * "you author your own clinical rules" is a headline claim, and it is also the
 * regulatory position. The pharmacy is the clinical author; we supply tooling.
 *
 * Deliberately constrained. The rule schema supports arbitrary nesting, but a
 * UI that exposes arbitrary nesting is a UI a pharmacist will not use. This
 * edits one level of ALL/ANY over leaf conditions, which covers every rule in
 * the seeded GLP-1 ruleset.
 */

import { useState } from 'react';
import type {
  ComparisonOperator,
  Condition,
  LeafCondition,
  Outcome,
  Rule,
} from '@/types/rule-schema';

/**
 * Fields the client may write rules against, in his language rather than ours.
 * Adding a field here is what makes it available in the builder.
 */
export const RULE_FIELDS: {
  path: string;
  label: string;
  kind: 'number' | 'choice';
  options?: string[];
  hint?: string;
}[] = [
  { path: 'derived.bmi', label: 'BMI', kind: 'number' },
  { path: 'derived.age', label: 'Age', kind: 'number' },
  { path: 'derived.weightLossPercent', label: 'Weight lost since last supply (%)', kind: 'number' },
  { path: 'derived.weeksOnCurrentDose', label: 'Weeks on current strength', kind: 'number' },
  { path: 'derived.doseStepChange', label: 'Strength steps changed', kind: 'number', hint: 'One step = the next strength up or down' },
  { path: 'answers.missedDoses', label: 'Doses missed in last 4 weeks', kind: 'number' },
  { path: 'answers.supplyMonths', label: 'Months of supply requested', kind: 'number' },
  { path: 'answers.doseRequest', label: 'Dose request', kind: 'choice', options: ['Same', 'Increase', 'Decrease'] },
  { path: 'answers.adverseEffects', label: 'Side effects', kind: 'choice', options: ['None', 'Mild', 'Moderate', 'Severe'] },
  { path: 'answers.pregnant', label: 'Pregnant', kind: 'choice', options: ['Yes', 'No'] },
  { path: 'answers.breastfeeding', label: 'Breastfeeding', kind: 'choice', options: ['Yes', 'No'] },
  { path: 'answers.healthChanges', label: 'New medicines or conditions', kind: 'choice', options: ['Yes', 'No'] },
  { path: 'answers.redFlagSymptoms', label: 'Red flag symptoms', kind: 'choice', options: ['Yes', 'No'] },
  { path: 'answers.medicine', label: 'Medicine', kind: 'choice', options: ['Mounjaro', 'Wegovy', 'Ozempic', 'Saxenda'] },
];

const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  nin: 'is not one of',
  contains: 'contains',
  exists: 'has been answered',
  notExists: 'has not been answered',
  between: 'is between',
};

const NUMBER_OPERATORS: ComparisonOperator[] = ['gte', 'gt', 'lte', 'lt', 'eq', 'between'];
const CHOICE_OPERATORS: ComparisonOperator[] = ['eq', 'neq', 'in', 'exists', 'notExists'];

function isLeaf(condition: Condition): condition is LeafCondition {
  return 'field' in condition;
}

/** Flattens a one-level condition tree into rows the editor can render. */
function toRows(condition: Condition): { mode: 'all' | 'any'; leaves: LeafCondition[] } {
  if ('all' in condition) {
    return { mode: 'all', leaves: condition.all.filter(isLeaf) };
  }
  if ('any' in condition) {
    return { mode: 'any', leaves: condition.any.filter(isLeaf) };
  }
  if (isLeaf(condition)) {
    return { mode: 'all', leaves: [condition] };
  }
  return { mode: 'all', leaves: [] };
}

function fromRows(mode: 'all' | 'any', leaves: LeafCondition[]): Condition {
  if (leaves.length === 1) return leaves[0]!;
  return mode === 'all' ? { all: leaves } : { any: leaves };
}

/**
 * Plain-English preview of a rule.
 *
 * The client should be able to read back what he has built without decoding
 * field paths. If this sentence does not make sense, the rule probably does not
 * either.
 */
export function describeRule(rule: Rule): string {
  const { mode, leaves } = toRows(rule.when);
  if (leaves.length === 0) return 'No conditions set.';

  const parts = leaves.map((leaf) => {
    const field = RULE_FIELDS.find((f) => f.path === leaf.field);
    const name = field?.label ?? leaf.field;
    const operator = OPERATOR_LABELS[leaf.op];

    if (leaf.op === 'exists' || leaf.op === 'notExists') return `${name} ${operator}`;
    if (leaf.op === 'between' && leaf.range) {
      return `${name} ${operator} ${leaf.range[0]} and ${leaf.range[1]}`;
    }
    if (Array.isArray(leaf.value)) return `${name} ${operator} ${leaf.value.join(' or ')}`;
    return `${name} ${operator} ${String(leaf.value)}`;
  });

  const joiner = mode === 'all' ? ' and ' : ' or ';
  return `If ${parts.join(joiner)}, mark this request ${rule.outcome}.`;
}

export function RuleEditor({
  rule,
  onChange,
  onCancel,
  onSave,
}: {
  rule: Rule;
  onChange: (rule: Rule) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { mode, leaves } = toRows(rule.when);
  const [conditionMode, setConditionMode] = useState<'all' | 'any'>(mode);

  function updateLeaves(next: LeafCondition[], nextMode = conditionMode) {
    onChange({ ...rule, when: fromRows(nextMode, next) });
  }

  function updateLeaf(index: number, patch: Partial<LeafCondition>) {
    updateLeaves(leaves.map((leaf, i) => (i === index ? { ...leaf, ...patch } : leaf)));
  }

  const inputClass = 'rounded-lg border border-line px-3 py-2 text-sm';

  return (
    <div className="rounded-card border-2 border-brand-600 bg-surface p-5">
      <h3 className="mb-4 text-base">Edit rule</h3>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm font-semibold">Name this rule</span>
        <input
          value={rule.label}
          onChange={(e) => onChange({ ...rule, label: e.target.value })}
          className={`${inputClass} w-full`}
          placeholder="e.g. Two or more doses missed"
        />
      </label>

      <div className="mb-4">
        <span className="mb-1.5 block text-sm font-semibold">When</span>

        {leaves.length > 1 && (
          <div className="mb-2 inline-flex rounded-lg border border-line p-0.5">
            {(['all', 'any'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={conditionMode === option}
                onClick={() => {
                  setConditionMode(option);
                  updateLeaves(leaves, option);
                }}
                className={`rounded px-3 py-1 text-xs font-semibold ${
                  conditionMode === option ? 'bg-brand-600 text-white' : ''
                }`}
              >
                {option === 'all' ? 'All are true' : 'Any is true'}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {leaves.map((leaf, index) => {
            const field = RULE_FIELDS.find((f) => f.path === leaf.field);
            const operators = field?.kind === 'number' ? NUMBER_OPERATORS : CHOICE_OPERATORS;
            const needsValue = leaf.op !== 'exists' && leaf.op !== 'notExists';

            return (
              <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas p-2.5">
                <select
                  value={leaf.field}
                  onChange={(e) => {
                    const next = RULE_FIELDS.find((f) => f.path === e.target.value);
                    updateLeaf(index, {
                      field: e.target.value,
                      // Reset operator and value — a number operator on a choice
                      // field would silently never match.
                      op: next?.kind === 'number' ? 'gte' : 'eq',
                      value: next?.kind === 'number' ? 0 : next?.options?.[0] ?? '',
                      range: undefined,
                    });
                  }}
                  className={`${inputClass} flex-1 min-w-[180px]`}
                  aria-label="Field"
                >
                  {RULE_FIELDS.map((f) => (
                    <option key={f.path} value={f.path}>{f.label}</option>
                  ))}
                </select>

                <select
                  value={leaf.op}
                  onChange={(e) => updateLeaf(index, { op: e.target.value as ComparisonOperator })}
                  className={inputClass}
                  aria-label="Comparison"
                >
                  {operators.map((op) => (
                    <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                  ))}
                </select>

                {needsValue && leaf.op === 'between' && (
                  <>
                    <input type="number" aria-label="From"
                      value={leaf.range?.[0] ?? 0}
                      onChange={(e) => updateLeaf(index, { range: [Number(e.target.value), leaf.range?.[1] ?? 0] })}
                      className={`${inputClass} w-20`} />
                    <span className="text-sm text-ink-soft">and</span>
                    <input type="number" aria-label="To"
                      value={leaf.range?.[1] ?? 0}
                      onChange={(e) => updateLeaf(index, { range: [leaf.range?.[0] ?? 0, Number(e.target.value)] })}
                      className={`${inputClass} w-20`} />
                  </>
                )}

                {needsValue && leaf.op !== 'between' && field?.kind === 'number' && (
                  <input type="number" step="0.1" aria-label="Value"
                    value={Number(leaf.value ?? 0)}
                    onChange={(e) => updateLeaf(index, { value: Number(e.target.value) })}
                    className={`${inputClass} w-24`} />
                )}

                {needsValue && leaf.op !== 'between' && field?.kind === 'choice' && (
                  <select
                    value={String(leaf.value ?? '')}
                    onChange={(e) => updateLeaf(index, { value: e.target.value })}
                    className={inputClass}
                    aria-label="Value"
                  >
                    {field.options?.map((option) => <option key={option}>{option}</option>)}
                  </select>
                )}

                <button type="button" aria-label="Remove condition"
                  onClick={() => updateLeaves(leaves.filter((_, i) => i !== index))}
                  className="ml-auto rounded border border-line bg-surface px-2 py-1 text-xs text-triage-red-700">
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() =>
            updateLeaves([...leaves, { field: 'derived.bmi', op: 'gte', value: 25 }])
          }
          className="mt-2 rounded-lg border border-dashed border-brand-300 px-3 py-1.5 text-sm font-semibold text-brand-700"
        >
          + Add a condition
        </button>
      </div>

      <div className="mb-4">
        <span className="mb-1.5 block text-sm font-semibold">Then mark the request</span>
        <div className="flex gap-2">
          {(['GREEN', 'AMBER', 'RED'] as Outcome[]).map((outcome) => (
            <button
              key={outcome}
              type="button"
              aria-pressed={rule.outcome === outcome}
              onClick={() => onChange({ ...rule, outcome })}
              className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-bold ${
                rule.outcome === outcome
                  ? outcome === 'RED'
                    ? 'border-triage-red-700 bg-triage-red-700 text-white'
                    : outcome === 'AMBER'
                      ? 'border-triage-amber-700 bg-triage-amber-700 text-white'
                      : 'border-clinical-green-700 bg-clinical-green-700 text-white'
                  : 'border-line bg-surface'
              }`}
            >
              {outcome}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-soft">
          {rule.outcome === 'RED'
            ? 'The patient is asked to book an appointment and cannot proceed online.'
            : rule.outcome === 'AMBER'
              ? 'A pharmacist reviews before anything is supplied.'
              : 'Nothing is flagged — but a pharmacist still confirms every supply.'}
        </p>
      </div>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm font-semibold">Note for the pharmacist</span>
        <input
          value={rule.message ?? ''}
          onChange={(e) => onChange({ ...rule, message: e.target.value })}
          className={`${inputClass} w-full`}
          placeholder="What should the pharmacist know when this fires?"
        />
      </label>

      {/* Read the rule back in plain English before it is saved. */}
      <div className="mb-4 rounded-lg border border-brand-300 bg-brand-50 p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
          In plain English
        </p>
        <p className="text-sm text-brand-700">{describeRule(rule)}</p>
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">
          Cancel
        </button>
        <button type="button" onClick={onSave}
          disabled={toRows(rule.when).leaves.length === 0 || !rule.label.trim()}
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">
          Save rule
        </button>
      </div>
    </div>
  );
}
