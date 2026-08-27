/**
 * GLP-1 Repeat Care ruleset.
 *
 * Translated directly from the decision matrices in the client's
 * "GLP1 Repeat Care Scope of Work" document. Each rule below cites the section
 * of that document it implements, so a clinical reviewer can check our work
 * against their own specification.
 *
 * This ships as the *initial* ruleset. Once the platform is live the client
 * edits these through the rule builder — the definition below is seed data,
 * not hard-coded logic. That distinction matters both for the product and for
 * regulatory positioning: the pharmacy authors its clinical rules, we supply
 * the tooling.
 *
 * Governing principle, in the client's own words:
 *   "We want to ENCOURAGE the quick and easy supply of medicines. The tool is
 *    to help speed up the process, and NOT block supplies. Unless there's
 *    anything dangerous... our default for any queries should be AMBER."
 *
 * Hence `defaultOutcome: 'AMBER'` — an unmatched request goes to a pharmacist,
 * never to an automatic approval and never to an outright block.
 */

import type { RulesetDefinition } from '@/types/rule-schema';

export const GLP1_REPEAT_RULESET: RulesetDefinition = {
  schemaVersion: 1,
  defaultOutcome: 'AMBER',
  rules: [
    // ── Eligibility (SOW §5, Decision Matrix table 1) ────────────────────
    // Highest priority: these are absolute safety blocks.
    {
      id: 'elig-pregnancy',
      label: 'Pregnant or breastfeeding',
      priority: 1000,
      outcome: 'RED',
      when: {
        any: [
          { field: 'answers.pregnant', op: 'eq', value: 'Yes' },
          { field: 'answers.breastfeeding', op: 'eq', value: 'Yes' },
        ],
      },
      message: 'Pregnancy or breastfeeding declared — treatment must be discontinued.',
      patientMessage:
        'We need to speak with you before we can continue your treatment. Please book an appointment.',
    },
    {
      id: 'elig-age-wegovy',
      label: 'Wegovy age range 18–74',
      priority: 990,
      outcome: 'RED',
      when: {
        all: [
          { field: 'answers.medicine', op: 'eq', value: 'Wegovy' },
          { not: { field: 'derived.age', op: 'between', range: [18, 74] } },
        ],
      },
      message: 'Patient is outside the licensed age range for Wegovy (18–74).',
      patientMessage: 'Please book an appointment to discuss your treatment.',
    },
    {
      id: 'elig-age-mounjaro',
      label: 'Mounjaro age range 18–84',
      priority: 990,
      outcome: 'RED',
      when: {
        all: [
          { field: 'answers.medicine', op: 'eq', value: 'Mounjaro' },
          { not: { field: 'derived.age', op: 'between', range: [18, 84] } },
        ],
      },
      message: 'Patient is outside the licensed age range for Mounjaro (18–84).',
      patientMessage: 'Please book an appointment to discuss your treatment.',
    },

    // ── Adverse effects (Decision Matrix table 6) ────────────────────────
    {
      id: 'ae-severe',
      label: 'Severe adverse effects or red flag symptoms',
      priority: 950,
      outcome: 'RED',
      when: {
        any: [
          { field: 'answers.adverseEffects', op: 'eq', value: 'Severe' },
          { field: 'answers.redFlagSymptoms', op: 'eq', value: 'Yes' },
        ],
      },
      message: 'Severe adverse effects reported — clinical review required before any supply.',
      patientMessage:
        'Based on your answers we need to see you before supplying more medication. Please book an appointment.',
    },

    // ── Missed doses (Decision Matrix table 5) ───────────────────────────
    {
      id: 'adherence-missed-2plus',
      label: 'Two or more doses missed in past 4 weeks',
      priority: 900,
      outcome: 'RED',
      when: { field: 'answers.missedDoses', op: 'gte', value: 2 },
      message: 'Two or more missed doses in the last 4 weeks — adherence review needed.',
      patientMessage: 'Please book an appointment so we can review your treatment with you.',
    },

    // ── BMI (Decision Matrix table 4) ────────────────────────────────────
    {
      id: 'bmi-under-23-not-decrease',
      label: 'BMI under 23 and not requesting a decrease',
      priority: 880,
      outcome: 'RED',
      when: {
        all: [
          { field: 'derived.bmi', op: 'lt', value: 23 },
          { field: 'answers.doseRequest', op: 'neq', value: 'Decrease' },
        ],
      },
      message: 'BMI below 23 without a dose reduction request — must be seen.',
      patientMessage: 'Please book an appointment to review your treatment plan.',
    },
    {
      id: 'bmi-under-23-decrease',
      label: 'BMI under 23 with a decrease request (tapering)',
      priority: 870,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'derived.bmi', op: 'lt', value: 23 },
          { field: 'answers.doseRequest', op: 'eq', value: 'Decrease' },
        ],
      },
      message: 'Tapering request at low BMI — appropriate.',
      advice:
        'Congratulations on reaching a healthy weight. Reducing your strength is a sensible next step — speak to us if you would like support tapering off.',
    },
    {
      id: 'bmi-23-to-25',
      label: 'BMI between 23 and 24.9',
      priority: 700,
      outcome: 'AMBER',
      when: { field: 'derived.bmi', op: 'between', range: [23, 24.9] },
      message: 'BMI in the 23–24.9 range — pharmacist review.',
      advice:
        'You are approaching a healthy BMI. It may be worth discussing a lower strength or a plan to taper off.',
    },

    // ── Dose change rules (Decision Matrix table 2) ──────────────────────
    {
      id: 'dose-step-skip',
      label: 'Dose change skipping more than one strength',
      priority: 860,
      outcome: 'RED',
      when: { field: 'derived.doseStepChange', op: 'gt', value: 1 },
      message: 'Requested strength is more than one step from the last supply.',
      patientMessage:
        'We can only change your strength one step at a time. Please book an appointment to discuss.',
    },
    {
      id: 'dose-change-too-soon',
      label: 'Dose change requested before 3 weeks on current strength',
      priority: 650,
      outcome: 'AMBER',
      when: {
        all: [
          { field: 'answers.doseRequest', op: 'in', value: ['Increase', 'Decrease'] },
          { field: 'derived.weeksOnCurrentDose', op: 'lt', value: 3 },
        ],
      },
      message: 'Fewer than 3 weeks on the current strength — pharmacist review before change.',
    },

    // ── Supply length (Decision Matrix table 3) ──────────────────────────
    {
      id: 'supply-2month-unstable',
      label: 'Two-month supply without 6 weeks stability',
      priority: 640,
      outcome: 'AMBER',
      when: {
        all: [
          { field: 'answers.supplyMonths', op: 'gte', value: 2 },
          { field: 'derived.weeksOnCurrentDose', op: 'lt', value: 6 },
        ],
      },
      message: 'Two-month supply requested without 6 weeks stable on the current strength.',
    },
    {
      id: 'supply-over-2-months',
      label: 'More than two months requested',
      priority: 630,
      outcome: 'AMBER',
      when: { field: 'answers.supplyMonths', op: 'gt', value: 2 },
      message: 'Supply longer than two months — review the reason given.',
    },

    // ── Adverse effects, non-blocking (Decision Matrix table 6) ──────────
    {
      id: 'ae-moderate',
      label: 'Moderate adverse effects',
      priority: 620,
      outcome: 'AMBER',
      when: { field: 'answers.adverseEffects', op: 'eq', value: 'Moderate' },
      message: 'Moderate adverse effects — consider a dose reduction for tolerability.',
      advice:
        'Some people find side effects settle at a lower strength. Book an appointment if you would like to talk this through.',
    },
    {
      id: 'adherence-missed-1',
      label: 'One dose missed in past 4 weeks',
      priority: 610,
      outcome: 'AMBER',
      when: { field: 'answers.missedDoses', op: 'eq', value: 1 },
      message: 'One missed dose — check adherence.',
      advice:
        'Try to take your dose on the same day each week. Setting a recurring reminder helps.',
    },

    // ── Health changes since last supply (SOW §4) ────────────────────────
    {
      id: 'health-changes',
      label: 'New medicines or health conditions since last supply',
      priority: 600,
      outcome: 'AMBER',
      when: { field: 'answers.healthChanges', op: 'eq', value: 'Yes' },
      message: 'Patient reports new medicines or conditions — review before supply.',
    },
    {
      id: 'patient-question',
      label: 'Patient has asked a question',
      priority: 590,
      outcome: 'AMBER',
      when: { field: 'answers.patientQuestion', op: 'exists' },
      message: 'Patient has asked a question — flag for the dispensing pharmacist.',
    },

    // ── Effectiveness (Decision Matrix table 7) ──────────────────────────
    {
      id: 'effectiveness-poor',
      label: 'Poor suppression or frequent snacking',
      priority: 580,
      outcome: 'AMBER',
      when: {
        any: [
          {
            field: 'answers.appetiteSuppression',
            op: 'in',
            value: ['Wearing off before next dose', 'Poor suppression'],
          },
          {
            field: 'answers.snacking',
            op: 'in',
            value: ['Daily snacking habit creeping back in', 'Frequent snacking / grazing'],
          },
        ],
      },
      message: 'Suppression wearing off or snacking increasing — consider an increase if eligible.',
      advice:
        'Focus on high-protein, lower-carbohydrate meals and controlled portion sizes. Increasing physical activity gradually gives the best results.',
    },

    // ── The GREEN path (Decision Matrix table 2, same dose row) ──────────
    // Note: GREEN means "no concerns flagged". A pharmacist still confirms.
    {
      id: 'green-stable-same-dose',
      label: 'Stable on the same dose with good progress',
      priority: 100,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'answers.doseRequest', op: 'eq', value: 'Same' },
          { field: 'derived.weightLossPercent', op: 'gte', value: 2 },
          {
            field: 'answers.appetiteSuppression',
            op: 'in',
            value: ['Full suppression all week', 'Mostly suppressed'],
          },
          {
            field: 'answers.snacking',
            op: 'in',
            value: ['Less than 3 regular meals, no snacks', 'Occasional small snack(s), still controlled'],
          },
          { field: 'answers.adverseEffects', op: 'in', value: ['None', 'Mild'] },
          { field: 'answers.missedDoses', op: 'eq', value: 0 },
          { field: 'derived.bmi', op: 'gte', value: 25 },
        ],
      },
      message: 'Meets all criteria for continuation at the same strength — confirm to proceed.',
      advice:
        'You are making good progress. Keep going with high-protein meals and regular activity.',
    },

    // ── Hydration advice — never blocking (Decision Matrix table 7) ──────
    {
      id: 'advice-hydration-low',
      label: 'Low hydration with related adverse effects',
      priority: 50,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'answers.hydration', op: 'in', value: ['1.0–1.4 L/day', '< 1.0 L/day'] },
          { field: 'answers.adverseEffects', op: 'neq', value: 'None' },
        ],
      },
      advice:
        'Aim for 1.5–2 litres of fluid a day. Good hydration helps with constipation, headaches and dizziness, and high-fibre foods help too.',
    },
    {
      id: 'advice-hydration-good',
      label: 'Good hydration',
      priority: 40,
      outcome: 'GREEN',
      when: { field: 'answers.hydration', op: 'eq', value: '≥ 2.0 L/day' },
      advice: 'Your hydration is excellent — keep it up.',
    },
  ],
};
