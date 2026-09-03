/**
 * Which questions a ruleset depends on, and whether the form still asks them.
 *
 * A rule reads answers by dot path — `answers.pregnancy`, `derived.bmi`. The
 * form is versioned separately and the pharmacy can now republish it from the
 * designer whenever they like. Nothing connects the two: rename a field id and
 * the rule that reads it does not error, it simply stops matching. The request
 * comes back AMBER by default and looks like an ordinary cautious result.
 *
 * That is the quiet failure this module exists to make loud. It answers one
 * question — for every rule, does the published form still ask what it reads?
 * — so a broken rule is something you can see rather than something you find
 * out about from a patient who was supplied when they should not have been.
 *
 * Pure. No database, no schema imports beyond the two shapes it compares.
 */

import type { Condition, Rule, RulesetDefinition } from '@/lib/rules/engine';
import type { FormSchema } from '@/types/form-schema';

/** Where a rule's value comes from. */
export type FieldSource = 'answers' | 'derived' | 'unknown';

export interface RuleDependency {
  /** The full dot path as written in the rule. */
  path: string;
  source: FieldSource;
  /** The part after the prefix — the form field id, for `answers.*`. */
  key: string;
}

/** Every field a condition tree reads, in the order it reads them. */
export function conditionDependencies(condition: Condition): RuleDependency[] {
  const found: RuleDependency[] = [];

  const walk = (node: Condition): void => {
    if ('all' in node) { node.all.forEach(walk); return; }
    if ('any' in node) { node.any.forEach(walk); return; }
    if ('not' in node) { walk(node.not); return; }

    const [prefix, ...rest] = node.field.split('.');
    const key = rest.join('.');

    found.push({
      path: node.field,
      source: prefix === 'answers' || prefix === 'derived' ? prefix : 'unknown',
      // An unprefixed path is the whole string — treating it as a key with no
      // prefix is more useful than reporting an empty one.
      key: key || node.field,
    });
  };

  walk(condition);
  return found;
}

/** Deduplicated, so a rule reading `answers.bmi` twice reports it once. */
export function ruleDependencies(rule: Pick<Rule, 'when'>): RuleDependency[] {
  const seen = new Map<string, RuleDependency>();
  for (const dep of conditionDependencies(rule.when)) seen.set(dep.path, dep);
  return [...seen.values()];
}

/**
 * Every field id the form can produce an answer for.
 *
 * Includes revealed follow-ups, which live nested inside their parent and are
 * answered under their own id — missing them would report a working rule as
 * broken, which is worse than useless because it trains people to ignore this.
 *
 * Also includes `derived` fields: a calculated BMI is a form field AND the
 * thing `derived.bmi` refers to.
 */
export function answerableFieldIds(schema: FormSchema): Set<string> {
  const ids = new Set<string>();

  const walk = (fields: FormSchema['steps'][number]['fields']): void => {
    for (const field of fields) {
      ids.add(field.id);
      for (const reveal of field.reveals ?? []) walk(reveal.fields);
    }
  };

  for (const step of schema.steps) walk(step.fields);
  return ids;
}

export type DependencyStatus = 'asked' | 'missing' | 'computed';

export interface CheckedDependency extends RuleDependency {
  status: DependencyStatus;
}

export interface RuleCoverage {
  ruleId: string;
  label: string;
  outcome: Rule['outcome'];
  priority: number;
  enabled: boolean;
  dependencies: CheckedDependency[];
  /** True when at least one `answers.*` path the rule reads is not asked. */
  broken: boolean;
}

export interface RulesetCoverage {
  defaultOutcome: RulesetDefinition['defaultOutcome'];
  rules: RuleCoverage[];
  /** The rules that can never match against this form version. */
  brokenRules: RuleCoverage[];
  /** Distinct `answers.*` keys no longer asked, across every rule. */
  missingKeys: string[];
}

/**
 * Check a ruleset against the form version it will actually run on.
 *
 * `derived.*` paths are reported as computed rather than checked. They are
 * produced by `deriveValues` from other answers, not read from the form
 * directly, so comparing them against field ids would report every one of them
 * as missing.
 */
export function checkRulesetCoverage(
  ruleset: RulesetDefinition,
  schema: FormSchema | null,
): RulesetCoverage {
  const asked = schema ? answerableFieldIds(schema) : null;

  const rules = ruleset.rules.map((rule): RuleCoverage => {
    const dependencies = ruleDependencies(rule).map((dep): CheckedDependency => {
      if (dep.source === 'derived') return { ...dep, status: 'computed' };

      /*
       * With no published form there is nothing to check against, so nothing
       * is claimed. Reporting every rule as broken because the form has not
       * been published yet would be a false alarm at exactly the moment
       * somebody is setting a service up.
       */
      if (!asked) return { ...dep, status: 'computed' };

      return { ...dep, status: asked.has(dep.key) ? 'asked' : 'missing' };
    });

    return {
      ruleId: rule.id,
      label: rule.label,
      outcome: rule.outcome,
      priority: rule.priority,
      enabled: rule.enabled !== false,
      dependencies,
      broken: dependencies.some((d) => d.status === 'missing'),
    };
  });

  const missingKeys = [...new Set(
    rules.flatMap((r) => r.dependencies.filter((d) => d.status === 'missing').map((d) => d.key)),
  )].sort();

  return {
    defaultOutcome: ruleset.defaultOutcome,
    rules,
    brokenRules: rules.filter((r) => r.broken),
    missingKeys,
  };
}

/** Rules grouped by what they decide, most severe first. */
export function byOutcome(rules: readonly RuleCoverage[]): {
  outcome: Rule['outcome'];
  rules: RuleCoverage[];
}[] {
  const order: Rule['outcome'][] = ['RED', 'AMBER', 'GREEN'];

  return order
    .map((outcome) => ({
      outcome,
      // Highest priority first, which is the order the engine considers them.
      rules: rules
        .filter((r) => r.outcome === outcome)
        .slice()
        .sort((a, b) => b.priority - a.priority),
    }))
    .filter((group) => group.rules.length > 0);
}

/* ── Reading a rule out loud ─────────────────────────────────────────────── */

const OPERATOR_WORDS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is over',
  gte: 'is at least',
  lt: 'is under',
  lte: 'is at most',
  in: 'is one of',
  nin: 'is none of',
  contains: 'includes',
  exists: 'was answered',
  notExists: 'was not answered',
  between: 'is between',
};

/** `answers.doseRequest` → `dose request`. */
function readableField(path: string): string {
  const key = path.includes('.') ? path.slice(path.indexOf('.') + 1) : path;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function readableValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => readableValue(v)).join(' or ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/_/g, ' ');
  return String(value);
}

/**
 * A condition as a sentence, for a pharmacist rather than an engineer.
 *
 * The screen this feeds is read by somebody deciding whether a rule says what
 * they meant, and `{"op":"lt","field":"derived.bmi","value":23}` does not
 * answer that question. Nesting is shown with brackets rather than indentation
 * because these trees are two deep at most and a bracketed line stays scannable
 * in a list of twenty-four.
 */
export function describeCondition(condition: Condition): string {
  if ('all' in condition) {
    return condition.all.map(describeCondition).join(' and ');
  }

  if ('any' in condition) {
    const parts = condition.any.map(describeCondition);
    // Brackets only where there is something to disambiguate.
    return parts.length > 1 ? `(${parts.join(' or ')})` : parts.join('');
  }

  if ('not' in condition) return `not (${describeCondition(condition.not)})`;

  const field = readableField(condition.field);
  const words = OPERATOR_WORDS[condition.op] ?? condition.op;

  if (condition.op === 'exists' || condition.op === 'notExists') {
    return `${field} ${words}`;
  }

  if (condition.op === 'between' && condition.range) {
    return `${field} ${words} ${condition.range[0]} and ${condition.range[1]}`;
  }

  return `${field} ${words} ${readableValue(condition.value)}`.trim();
}
