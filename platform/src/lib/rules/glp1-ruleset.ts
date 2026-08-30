/**
 * GLP-1 repeat care ruleset.
 *
 * This is his decision matrix, executable. Section numbers below map to the
 * tables in "GLP1_Repeat_Care_Scope_of_Work" so a pharmacist can check it line
 * by line against his own document.
 *
 * The governing instruction, in his words:
 *
 *   "Bottom line: we want to ENCOURAGE the quick and easy supply of medicines.
 *    The tool is to help speed up the process, and NOT block supplies. Unless
 *    there's anything dangerous, or its obvious that someone is trying to game
 *    the system, our default for any queries should be AMBER."
 *
 * So the default outcome is AMBER, RED is reserved for genuine safety, and
 * GREEN requires every condition to be affirmatively satisfied.
 *
 * This is CONFIGURATION. He edits it in the rule builder; publishing an edit
 * creates a new version, and the simulator shows which past cases would change
 * before it goes live.
 */

import type { RulesetDefinition } from './engine';

export const GLP1_REPEAT_RULESET: RulesetDefinition = {
  schemaVersion: 1,
  defaultOutcome: 'AMBER',
  rules: [
    // ── 1. Eligibility ────────────────────────────────────────
    {
      id: 'pregnancy',
      label: 'Pregnant or breastfeeding',
      priority: 1000,
      outcome: 'RED',
      when: { field: 'answers.pregnancy', op: 'eq', value: 'yes' },
      message: 'Pregnancy or breastfeeding declared. Treatment must be discontinued.',
      patientMessage:
        'We cannot supply this treatment at the moment. Please stop taking your medicine and contact the pharmacy.',
    },
    {
      id: 'age-wegovy',
      label: 'Wegovy outside the 18–74 age range',
      priority: 990,
      outcome: 'RED',
      when: {
        all: [
          { field: 'derived.medicine', op: 'eq', value: 'Wegovy' },
          { any: [
            { field: 'derived.age', op: 'lt', value: 18 },
            { field: 'derived.age', op: 'gt', value: 74 },
          ] },
        ],
      },
      message: 'Outside the licensed age range for Wegovy (18–74).',
    },
    {
      id: 'age-mounjaro',
      label: 'Mounjaro outside the 18–84 age range',
      priority: 990,
      outcome: 'RED',
      when: {
        all: [
          { field: 'derived.medicine', op: 'eq', value: 'Mounjaro' },
          { any: [
            { field: 'derived.age', op: 'lt', value: 18 },
            { field: 'derived.age', op: 'gt', value: 84 },
          ] },
        ],
      },
      message: 'Outside the licensed age range for Mounjaro (18–84).',
    },

    // ── 6. Adverse effects ────────────────────────────────────
    {
      id: 'adverse-severe',
      label: 'Severe adverse effects or red-flag symptoms',
      priority: 960,
      outcome: 'RED',
      when: { field: 'answers.adverseEffects', op: 'in', value: ['severe', 'red_flag'] },
      message: 'Severe or red-flag adverse effects reported. Do not supply; contact the patient.',
      patientMessage:
        'Please stop taking your medicine and contact the pharmacy today so we can talk this through.',
    },

    // ── 5. Missed doses ───────────────────────────────────────
    {
      id: 'missed-two-plus',
      label: 'Two or more doses missed in the past 4 weeks',
      priority: 950,
      outcome: 'RED',
      when: { field: 'derived.missedDoses', op: 'gte', value: 2 },
      message: 'Two or more doses missed. Adherence and re-titration need a pharmacist to speak to them.',
    },

    // ── 2. Dose request rules ─────────────────────────────────
    {
      id: 'dose-skip',
      label: 'Dose change skipping more than one strength',
      priority: 940,
      outcome: 'RED',
      when: {
        any: [
          { field: 'derived.doseStepChange', op: 'gt', value: 1 },
          { field: 'derived.doseStepChange', op: 'lt', value: -1 },
        ],
      },
      message: 'Requested change is more than one step on the ladder. Only same or ±1 is permitted.',
    },

    // ── 4. BMI ────────────────────────────────────────────────
    {
      id: 'bmi-low-not-decreasing',
      label: 'BMI under 23 and not requesting a decrease',
      priority: 930,
      outcome: 'RED',
      when: {
        all: [
          { field: 'derived.bmi', op: 'lt', value: 23 },
          { field: 'answers.doseRequest', op: 'neq', value: 'decrease' },
        ],
      },
      message: 'BMI is below 23 and the patient is not tapering. A pharmacist must review before any supply.',
    },
    {
      id: 'bmi-low-tapering',
      label: 'BMI under 23 with a decrease request (tapering)',
      priority: 920,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'derived.bmi', op: 'lt', value: 23 },
          { field: 'answers.doseRequest', op: 'eq', value: 'decrease' },
        ],
      },
      message: 'Tapering at a healthy BMI. Appropriate to support.',
      advice:
        'Congratulations on reaching a healthy weight. Reducing your dose gradually is the right way to come off treatment — speak to us if you are unsure.',
    },
    {
      id: 'bmi-borderline',
      label: 'BMI between 23 and 24.9',
      priority: 700,
      outcome: 'AMBER',
      when: { field: 'derived.bmi', op: 'between', range: [23, 24.9] },
      message: 'BMI is in the 23–24.9 band. Confirm continuing treatment remains appropriate.',
    },

    // ── 2. Dose timing ────────────────────────────────────────
    {
      id: 'dose-change-too-soon',
      label: 'Dose change requested before 3 weeks on the current strength',
      priority: 690,
      outcome: 'AMBER',
      when: {
        all: [
          { field: 'answers.doseRequest', op: 'in', value: ['increase', 'decrease'] },
          { field: 'derived.weeksOnDose', op: 'lt', value: 3 },
        ],
      },
      message: 'Fewer than three weeks on the current strength. Confirm the change is appropriate.',
    },

    // ── 3. Supply length ──────────────────────────────────────
    {
      id: 'supply-two-pens-unstable',
      label: 'Two pens requested without 6 weeks stable on the dose',
      priority: 680,
      outcome: 'AMBER',
      when: {
        all: [
          { field: 'answers.supplyQuantity', op: 'eq', value: '2' },
          { field: 'derived.weeksOnDose', op: 'lt', value: 6 },
        ],
      },
      message: 'Eight weeks requested before six weeks stable on this dose.',
    },
    {
      /*
       * INTERIM. The client's newest workflow allows one, two or three months
       * "where permitted" without saying when. Until he defines it, three
       * months is reviewed rather than refused or waved through — inventing a
       * permission is as wrong as inventing a restriction.
       */
      id: 'supply-three-pens',
      label: 'More than two months of supply requested',
      priority: 675,
      outcome: 'AMBER',
      when: { field: 'answers.supplyQuantity', op: 'eq', value: '3' },
      message: 'Twelve weeks requested. Confirm the reason — travel, or established stability.',
    },

    // ── 6. Moderate adverse effects ───────────────────────────
    {
      id: 'adverse-moderate',
      label: 'Moderate adverse effects',
      priority: 670,
      outcome: 'AMBER',
      when: { field: 'answers.adverseEffects', op: 'eq', value: 'moderate' },
      message: 'Moderate adverse effects. Consider a dose reduction for tolerability.',
      advice: 'Consider whether a lower strength would be better tolerated.',
    },

    // ── 5. One missed dose ────────────────────────────────────
    {
      id: 'missed-one',
      label: 'One dose missed in the past 4 weeks',
      priority: 660,
      outcome: 'AMBER',
      when: { field: 'derived.missedDoses', op: 'eq', value: 1 },
      message: 'One dose missed. Check the reason before supplying.',
      advice: 'Try to take your dose on the same day each week — a phone reminder helps.',
    },

    // ── Medical history change ────────────────────────────────
    {
      id: 'history-changed',
      label: 'Medicines or health conditions changed since last supply',
      priority: 650,
      outcome: 'AMBER',
      when: { field: 'answers.historyChanged', op: 'eq', value: 'yes' },
      message: 'Patient reports a change to medicines or health. Review before supplying.',
    },

    // ── 7. Supportive checks — efficacy ───────────────────────
    {
      id: 'poor-response',
      label: 'Poor suppression or frequent snacking',
      priority: 640,
      outcome: 'AMBER',
      when: {
        any: [
          { field: 'answers.appetiteSuppression', op: 'in', value: ['wearing_off', 'poor'] },
          { field: 'answers.snacking', op: 'in', value: ['daily', 'frequent'] },
        ],
      },
      message: 'Treatment response is dropping off. The answers support considering an increase.',
      advice:
        'Focus on protein at each meal and keep portions controlled — this helps most when appetite control is fading.',
    },
    {
      id: 'weight-loss-below-target',
      label: 'Weight loss below the 2% monthly target',
      priority: 630,
      outcome: 'AMBER',
      when: { field: 'derived.weightLossPercent', op: 'lt', value: 2 },
      message: 'Under the 2% monthly target. Consider whether the dose is right.',
    },

    // ── Patient asked a question ──────────────────────────────
    {
      id: 'patient-question',
      label: 'Patient has asked a question',
      priority: 620,
      outcome: 'AMBER',
      when: { field: 'answers.questionsForPharmacist', op: 'exists' },
      message: 'The patient has asked something. Make sure they are spoken to at collection.',
    },
    {
      id: 'wants-clinic',
      label: 'Patient asked to visit the clinic',
      priority: 610,
      outcome: 'AMBER',
      when: { field: 'answers.consultType', op: 'eq', value: 'clinic' },
      /*
       * They are not booked into this service. Weight Management is remote at
       * the client's explicit instruction, and somebody who wants to be seen
       * is referred to the separate face-to-face programme rather than given
       * an internal appointment.
       */
      message: 'Patient asked to be seen rather than supplied online. Refer them to the '
        + 'face-to-face programme.',
    },

    // ── The GREEN path ────────────────────────────────────────
    // Every condition must be affirmatively satisfied. Anything not covered
    // here falls through to the AMBER default.
    {
      id: 'stable-continue',
      label: 'Stable on the same dose and meeting target',
      priority: 500,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'answers.doseRequest', op: 'eq', value: 'same' },
          { field: 'answers.adverseEffects', op: 'in', value: ['none', 'mild'] },
          { field: 'derived.missedDoses', op: 'eq', value: 0 },
          { field: 'derived.weeksOnDose', op: 'gte', value: 3 },
          { field: 'derived.bmi', op: 'gte', value: 25 },
          { field: 'derived.weightLossPercent', op: 'gte', value: 2 },
          { field: 'answers.appetiteSuppression', op: 'in', value: ['full', 'mostly'] },
          { field: 'answers.snacking', op: 'in', value: ['controlled', 'occasional'] },
          { field: 'answers.historyChanged', op: 'eq', value: 'no' },
        ],
      },
      message: 'No concerns flagged. Continuing the same dose.',
      advice: 'Keep going — you are on track. Aim for 1.5 to 2 litres of water a day.',
    },
    {
      id: 'increase-supported',
      label: 'Increase supported by the answers, and eligible on timing',
      priority: 490,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'answers.doseRequest', op: 'eq', value: 'increase' },
          { field: 'derived.doseStepChange', op: 'eq', value: 1 },
          { field: 'derived.weeksOnDose', op: 'gte', value: 3 },
          { field: 'answers.adverseEffects', op: 'in', value: ['none', 'mild'] },
          { field: 'derived.missedDoses', op: 'eq', value: 0 },
          { field: 'derived.bmi', op: 'gte', value: 25 },
          { field: 'answers.historyChanged', op: 'eq', value: 'no' },
        ],
      },
      message: 'Meets criteria for an increase — confirm?',
    },

    // ── 7. Hydration advice — never a blocker ─────────────────
    {
      id: 'hydration-low',
      label: 'Low fluid intake',
      priority: 100,
      outcome: 'GREEN',
      when: { field: 'answers.hydration', op: 'in', value: ['low', 'very_low'] },
      advice:
        'Try to drink at least 1.5 to 2 litres of water a day. It helps with constipation, headaches and dizziness, which are common on this medicine.',
    },
    /*
     * ── Holiday supply — §5.5 ────────────────────────────────
     *
     * Absent from the earlier scope of work entirely, and the one place where a
     * patient asking for MORE is routine rather than suspicious: people go away.
     *
     * Priorities sit above the ordinary supply-length rules, because a holiday
     * request that also breaks the stability rule should be judged as a holiday
     * request. Ranked worst first among themselves — two strengths across a long
     * supply is a stockpile whatever else is true about it.
     */
    {
      id: 'holiday-two-strengths',
      label: 'Holiday supply spanning two strengths',
      priority: 930,
      outcome: 'RED',
      when: {
        all: [
          { field: 'answers.holidaySupply', op: 'eq', value: 'yes' },
          { field: 'answers.holidayTwoStrengths', op: 'eq', value: 'yes' },
          { field: 'answers.supplyQuantity', op: 'in', value: ['2', '3'] },
        ],
      },
      message:
        'Two months or more covering two different strengths. This needs a pharmacist before any supply.',
      patientMessage:
        'We need to see you before we can supply this much across two different strengths.',
    },
    {
      id: 'holiday-increase-and-two-months',
      label: 'Holiday supply with a strength change',
      priority: 620,
      outcome: 'AMBER',
      when: {
        all: [
          { field: 'answers.holidaySupply', op: 'eq', value: 'yes' },
          { field: 'answers.supplyQuantity', op: 'in', value: ['2', '3'] },
          { field: 'answers.doseRequest', op: 'neq', value: 'same' },
        ],
      },
      message: 'Changing strength and requesting two months together — confirm before supply.',
    },
    {
      id: 'holiday-same-strength-stable',
      label: 'Holiday supply, same strength, stable dose',
      priority: 480,
      outcome: 'GREEN',
      when: {
        all: [
          { field: 'answers.holidaySupply', op: 'eq', value: 'yes' },
          { field: 'answers.doseRequest', op: 'eq', value: 'same' },
          { field: 'derived.weeksOnDose', op: 'gte', value: 4 },
          { field: 'answers.adverseEffects', op: 'in', value: ['none', 'mild'] },
        ],
      },
      message: 'Early or extra supply of the same strength, on a stable dose.',
      advice: 'Take your pen in hand luggage and keep it cool. It does not need to be frozen.',
    },
    {
      id: 'hydration-good',
      label: 'Good fluid intake',
      priority: 90,
      outcome: 'GREEN',
      when: { field: 'answers.hydration', op: 'eq', value: 'high' },
      advice: 'Your fluid intake is where we want it — keep that up.',
    },
    {
      id: 'mild-effects-advice',
      label: 'Mild adverse effects',
      priority: 80,
      outcome: 'GREEN',
      when: { field: 'answers.adverseEffects', op: 'eq', value: 'mild' },
      advice:
        'Mild nausea usually settles. Smaller meals, eating slowly, and avoiding fatty food all help.',
    },
  ],
};
