# Module — Decision Engine

## Purpose

Triages a patient submission to GREEN, AMBER or RED and produces a complete,
storable explanation of how it reached that outcome.

## Regulatory constraint — read before changing anything here

The engine **triages**. It does not decide.

A pharmacist confirms every supply, including GREEN. Clinician-facing messages are
phrased as *"Meets criteria for increase — confirm?"*, never *"Increase to 5mg"*.
Patients see status only, never a dose recommendation.

Software that autonomously recommends dose changes can be classified as a medical
device under UK MDR / IMDRF Rule 11, bringing third-party conformity assessment, a
quality management system and post-market surveillance obligations. Keeping a human
in the loop avoids that entire regime at negligible cost.

Do not add an auto-approval path. If a future requirement appears to need one,
escalate rather than implement.

## Files

| File | Role |
|---|---|
| `src/types/rule-schema.ts` | The JSONB rule tree structure |
| `src/lib/rules/engine.ts` | Pure evaluator |
| `src/lib/rules/glp1-ruleset.ts` | Initial GLP-1 ruleset from the client's matrices |
| `tests/rules-engine.test.ts` | Engine behaviour |
| `tests/glp1-clinical.test.ts` | Clinical acceptance tests |

## How evaluation works

1. Disabled rules removed, the rest sorted by priority descending.
2. **Every** rule is evaluated — not just up to the first match — because the trace
   must show what was considered, not only what fired.
3. Advice from all matched rules is collected; guidance is additive.
4. The most severe matched outcome wins (RED > AMBER > GREEN). Ties go to the
   higher-priority rule.
5. If nothing matches, `defaultOutcome` applies.

## Two behaviours that exist for safety

**Default is AMBER, never GREEN.** An unrecognised or incomplete request goes to a
pharmacist. This matches the client's stated philosophy — encourage supply, do not
block unnecessarily, but never approve silently on missing data.

**Missing fields skip the rule, they do not satisfy it.** A rule referencing an
absent answer is recorded as skipped, with a reason. A safety rule must never pass
because a question went unanswered.

## Derived values

Rules reference `derived.*` for values computed before evaluation: `bmi`, `age`,
`weightLossPercent`, `weeksOnCurrentDose`, `doseStepChange`. Compute these in the
calling code and pass them in — the engine does no arithmetic of its own, which
keeps it pure and keeps the derivation independently testable.

## The simulator

Because evaluation is pure, a draft ruleset can be replayed against historical
submissions to show exactly which past decisions would change. Clinical rule
changes stop being a leap of faith.

## Gotchas

- Priority is descending — higher numbers evaluate first.
- `between` is inclusive at both ends.
- `contains` is case-insensitive for strings, exact for arrays.
- Empty string counts as absent for `exists` / `notExists`.
- Published ruleset versions are immutable. Changes create a new version.
