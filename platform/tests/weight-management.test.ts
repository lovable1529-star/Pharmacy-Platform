import { describe, it, expect } from 'vitest';
import {
  visibleFields, validateForm, pruneHiddenAnswers, activeWarnings, numberQuestions,
} from '@/lib/forms/runtime';
import {
  buildWeightManagementNewPatientForm, buildWeightManagementRepeatForm,
  MEDICINE_STRENGTH_OPTIONS, CONTRAINDICATIONS, MOUNJARO_STRENGTHS, WEGOVY_STRENGTHS,
  GLP1_CLINICIAN_DECLARATIONS,
} from '@/lib/services/weight-management';

const BRANCHES = [
  { id: 'br-onchan', name: 'Onchan' },
  { id: 'br-kirk', name: 'Kirk Michael' },
];

const FIRST = buildWeightManagementNewPatientForm(BRANCHES);
const REPEAT = buildWeightManagementRepeatForm(BRANCHES);

const ids = (schema: Parameters<typeof visibleFields>[0], answers: Record<string, unknown>) =>
  visibleFields(schema, answers, { includeClinicianOnly: true }).map((f) => f.id);

/**
 * The new-patient form now opens by offering face-to-face care, and everything
 * after that step is hidden until the patient chooses to continue online. Tests
 * about the clinical questions have to get past that gate first, so they say so
 * explicitly rather than relying on a default.
 */
const REMOTE = { pathwayChoice: 'remote' };

describe('dose ladders feed the ±1 step rule', () => {
  it('carries Mounjaro strengths in clinical order', () => {
    expect(MOUNJARO_STRENGTHS).toEqual(['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg']);
  });

  it('carries Wegovy strengths in clinical order', () => {
    expect(WEGOVY_STRENGTHS).toEqual(['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg']);
  });

  it('attaches medicine, strength and ladder position to every option', () => {
    const option = MEDICINE_STRENGTH_OPTIONS.find((o) => o.value === 'mounjaro_7.5mg');
    expect(option?.metadata).toEqual({ medicine: 'Mounjaro', strength: '7.5mg', ladderIndex: 2 });
  });

  it('offers all eleven strengths across both medicines', () => {
    expect(MEDICINE_STRENGTH_OPTIONS).toHaveLength(11);
  });
});

describe('contraindication screening', () => {
  it('corrects the legacy MED2 typo to MEN2', () => {
    const labels = CONTRAINDICATIONS.map((c) => c.label);
    expect(labels.some((l) => l.includes('MEN2'))).toBe(true);
    expect(labels.some((l) => l.includes('MED2'))).toBe(false);
  });

  it("restores the apostrophe in Crohn's disease", () => {
    expect(CONTRAINDICATIONS.some((c) => c.label.includes("Crohn's"))).toBe(true);
  });

  it('offers an explicit "none of the above" so a blank is never ambiguous', () => {
    expect(CONTRAINDICATIONS.some((c) => c.value === 'none')).toBe(true);
  });
});

describe('new patient — gender-conditional safety questions', () => {
  const base = { ...REMOTE, gender: 'female' };

  it('asks a female patient about pregnancy and contraception', () => {
    const shown = ids(FIRST, base);
    expect(shown).toContain('pregnancy');
    expect(shown).toContain('oralContraception');
    expect(shown).not.toContain('bleedingDisorder');
  });

  it('asks a male patient about bleeding disorders instead', () => {
    const shown = ids(FIRST, { ...REMOTE, gender: 'male' });
    expect(shown).toContain('bleedingDisorder');
    expect(shown).not.toContain('pregnancy');
    expect(shown).not.toContain('oralContraception');
  });

  it('treats "other" as needing the female safety questions', () => {
    const shown = ids(FIRST, { ...REMOTE, gender: 'other' });
    expect(shown).toContain('pregnancy');
    expect(shown).not.toContain('bleedingDisorder');
  });
});

describe('new patient — nested reveals', () => {
  it('hides the gallbladder detail until Yes', () => {
    expect(ids(FIRST, { ...REMOTE, gallbladder: 'no' })).not.toContain('gallbladderDetail');
    expect(ids(FIRST, { ...REMOTE, gallbladder: 'yes' })).toContain('gallbladderDetail');
  });

  it('hides the liver detail until Yes', () => {
    expect(ids(FIRST, { ...REMOTE, liver: 'yes' })).toContain('liverDetail');
  });

  it('asks which previous medicines only after Yes', () => {
    expect(ids(FIRST, { ...REMOTE, everUsedWeightLossMeds: 'no' })).not.toContain('previousMeds');
    expect(ids(FIRST, { ...REMOTE, everUsedWeightLossMeds: 'yes' })).toContain('previousMeds');
  });

  it('discards gallbladder detail when the answer is changed back to No', () => {
    const answered = { ...REMOTE, gallbladder: 'yes', gallbladderDetail: ['current'], gender: 'male' };
    const pruned = pruneHiddenAnswers(FIRST, { ...answered, gallbladder: 'no' });
    expect(pruned.gallbladderDetail).toBeUndefined();
  });
});

describe('new patient — hard stops', () => {
  it('stops on pregnancy', () => {
    const warnings = activeWarnings(FIRST, { ...REMOTE, gender: 'female', pregnancy: 'yes' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('warns, but does not stop, on oral contraception', () => {
    const warnings = activeWarnings(FIRST, { ...REMOTE, gender: 'female', oralContraception: 'yes' });
    expect(warnings.some((w) => w.severity === 'warn')).toBe(true);
    expect(warnings.some((w) => w.severity === 'stop')).toBe(false);
  });
});

describe('repeat request — the fields the decision engine reads', () => {
  it('collects everything his decision matrix needs', () => {
    const shown = ids(REPEAT, { gender: 'female' });
    for (const required of [
      'weight', 'bmi', 'weightLostThisMonth', 'currentMedicine', 'weeksOnDose',
      'missedDoses', 'adverseEffects', 'pregnancy', 'appetiteSuppression',
      'snacking', 'hydration', 'doseRequest', 'supplyQuantity',
    ]) {
      expect(shown).toContain(required);
    }
  });

  it('offers missed doses in the bands the rules use', () => {
    const field = REPEAT.steps
      .flatMap((s) => s.fields)
      .find((f) => f.id === 'missedDoses');
    expect(field?.options?.map((o) => o.value)).toEqual(['0', '1', '2+']);
  });

  it('grades adverse effects from none through to red flag', () => {
    const field = REPEAT.steps.flatMap((s) => s.fields).find((f) => f.id === 'adverseEffects');
    expect(field?.options?.map((o) => o.value)).toEqual([
      'none', 'mild', 'moderate', 'severe', 'red_flag',
    ]);
  });

  it('offers up to three pens, unlike the first consultation which caps at two', () => {
    const repeatSupply = REPEAT.steps.flatMap((s) => s.fields).find((f) => f.id === 'supplyQuantity');
    const firstSupply = FIRST.steps.flatMap((s) => s.fields).find((f) => f.id === 'supplyDuration');
    expect(repeatSupply?.options).toHaveLength(3);
    expect(firstSupply?.options).toHaveLength(2);
  });

  it('has no leading whitespace in any option value — the legacy " mild" bug', () => {
    const allValues = [...FIRST.steps, ...REPEAT.steps]
      .flatMap((s) => s.fields)
      .flatMap((f) => f.options ?? [])
      .map((o) => o.value);
    expect(allValues.every((v) => v === v.trim())).toBe(true);
  });
});

describe('repeat request — safety', () => {
  it('stops on a red-flag symptom', () => {
    const warnings = activeWarnings(REPEAT, { adverseEffects: 'red_flag' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('stops on severe side effects', () => {
    const warnings = activeWarnings(REPEAT, { adverseEffects: 'severe' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('stays quiet on mild side effects, which are allowed to continue', () => {
    expect(activeWarnings(REPEAT, { adverseEffects: 'mild' })).toEqual([]);
  });

  it('stops on pregnancy', () => {
    const warnings = activeWarnings(REPEAT, { gender: 'female', pregnancy: 'yes' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });
});

describe('both forms are valid configurations', () => {
  it('start invalid because required answers are missing', () => {
    expect(validateForm(FIRST, {}).valid).toBe(false);
    expect(validateForm(REPEAT, {}).valid).toBe(false);
  });

  it('number their questions sequentially', () => {
    const numbered = numberQuestions(REPEAT);
    const numbers = numbered.steps
      .flatMap((s) => s.fields)
      .filter((f) => f.type !== 'infoBlock')
      .map((f) => f.number ?? 0);
    expect(numbers).toEqual(numbers.slice().sort((a, b) => a - b));
    expect(numbers[0]).toBe(1);
  });

  it('carry the seven pharmacist declarations from his scope of work', () => {
    expect(GLP1_CLINICIAN_DECLARATIONS).toHaveLength(7);
    expect(FIRST.clinicianDeclarations).toHaveLength(7);
    expect(REPEAT.clinicianDeclarations).toHaveLength(7);
  });

  it('compute BMI rather than asking the patient for it', () => {
    const bmi = REPEAT.steps.flatMap((s) => s.fields).find((f) => f.id === 'bmi');
    expect(bmi?.type).toBe('derived');
    expect(bmi?.calculation).toBe('bmi');
    expect(bmi?.calculationInputs).toEqual(['weight', 'height']);
  });

  it('every field carries a stable id', () => {
    const all = [...FIRST.steps, ...REPEAT.steps].flatMap((s) => s.fields);
    expect(all.every((f) => typeof f.id === 'string' && f.id.length > 0)).toBe(true);
  });
});

describe('new patient — the remote pathway gate', () => {
  /*
   * The client's first step: offer face-to-face care, and if they take it,
   * stop. Everything clinical hangs behind this choice, so a patient who has
   * been told to book elsewhere cannot carry on and submit a request anyway.
   */
  it('asks nothing else until they choose', () => {
    const shown = ids(FIRST, {});
    expect(shown).toContain('pathwayChoice');
    expect(shown).not.toContain('firstName');
    expect(shown).not.toContain('height');
    expect(shown).not.toContain('consent');
  });

  it('opens the form once they choose to continue online', () => {
    const shown = ids(FIRST, REMOTE);
    expect(shown).toContain('firstName');
    expect(shown).toContain('height');
    expect(shown).toContain('consent');
  });

  it('keeps the form shut when they ask to be seen in person', () => {
    const shown = ids(FIRST, { pathwayChoice: 'in_person' });
    expect(shown).not.toContain('firstName');
    expect(shown).not.toContain('height');
    expect(shown).not.toContain('signature');
  });

  it('shows a hard stop pointing at the face-to-face programme', () => {
    const warnings = activeWarnings(FIRST, { pathwayChoice: 'in_person' });
    const stop = warnings.find((w) => w.severity === 'stop');
    expect(stop).toBeDefined();
    expect(stop!.message).toMatch(/face-to-face/i);
  });
});

describe('new patient — knowing who they are', () => {
  /*
   * The version this replaces asked forty-two questions and none of them was
   * the patient's name, so every submission arrived unattached to a record.
   * `readIdentity` matches on exactly these three.
   */
  it('asks the three fields a patient record is built from', () => {
    const shown = ids(FIRST, REMOTE);
    for (const field of ['firstName', 'lastName', 'dateOfBirth']) {
      expect(shown).toContain(field);
    }
  });

  it('asks how to reach them, since a pharmacist has to telephone', () => {
    const shown = ids(FIRST, REMOTE);
    expect(shown).toContain('phone');
    expect(shown).toContain('email');
  });

  it('requires all of them', () => {
    const flagged = validateForm(FIRST, REMOTE).issues.map((i) => i.fieldId);
    for (const field of ['firstName', 'lastName', 'dateOfBirth', 'phone']) {
      expect(flagged).toContain(field);
    }
  });
});

describe('new patient — routing to the right questions', () => {
  const remoteNew = { ...REMOTE, otherClinic: 'no' };
  const remoteTransfer = { ...REMOTE, otherClinic: 'yes' };

  it('asks the transfer questions only of someone coming from another clinic', () => {
    expect(ids(FIRST, remoteNew)).not.toContain('priorClinicName');
    expect(ids(FIRST, remoteTransfer)).toContain('priorClinicName');
  });

  it('collects the evidence categories the client named for transfers', () => {
    const shown = ids(FIRST, remoteTransfer);
    for (const field of ['priorMedicine', 'priorStartedOn', 'priorStartingWeight']) {
      expect(shown).toContain(field);
    }
  });

  it('asks everyone for identity and measurement evidence', () => {
    for (const answers of [remoteNew, remoteTransfer]) {
      const shown = ids(FIRST, answers);
      expect(shown).toContain('photoId');
      expect(shown).toContain('patientPhoto');
      expect(shown).toContain('measurementEvidence');
    }
  });

  /* Proof of the CURRENT prescription only makes sense for a transfer. */
  it('asks only transfers for their current prescription', () => {
    expect(ids(FIRST, remoteNew)).not.toContain('evidence');
    expect(ids(FIRST, remoteTransfer)).toContain('evidence');
  });

  it('discards the transfer answers if they change their mind', () => {
    const answered = { ...remoteTransfer, priorClinicName: 'Another clinic' };
    const pruned = pruneHiddenAnswers(FIRST, { ...answered, otherClinic: 'no' });
    expect(pruned.priorClinicName).toBeUndefined();
  });
});

describe('new patient — how the medicine reaches them', () => {
  it('asks which branch only when they are collecting', () => {
    expect(ids(FIRST, { ...REMOTE, fulfilmentMethod: 'delivery' }))
      .not.toContain('collectionBranch');
    expect(ids(FIRST, { ...REMOTE, fulfilmentMethod: 'collection' }))
      .toContain('collectionBranch');
  });

  it('asks for an address only when they are having it posted', () => {
    expect(ids(FIRST, { ...REMOTE, fulfilmentMethod: 'collection' }))
      .not.toContain('deliveryAddress');
    expect(ids(FIRST, { ...REMOTE, fulfilmentMethod: 'delivery' }))
      .toContain('deliveryAddress');
  });

  /*
   * The branch has to survive as metadata, because `submission.branchId` is
   * set from it — and a prescription number is allocated per branch.
   */
  it('carries the branch id through as metadata', () => {
    const field = FIRST.steps
      .flatMap((s) => s.fields)
      .find((f) => f.id === 'collectionBranch');
    expect(field?.storeMetadataAs).toBe('collectionBranchDetail');
    expect(field?.options?.[0]?.metadata).toEqual({ branchId: 'br-onchan' });
  });
});

describe('new patient — consent matches the service on offer', () => {
  /*
   * The old wording promised "an appointment to see a pharmacist in person at
   * any time". This service does not offer that; being seen in person means a
   * referral to a separate programme.
   */
  it('no longer promises an in-person appointment on demand', () => {
    const text = (FIRST.consentClauses ?? []).map((c) => c.text).join(' ');
    expect(text).not.toMatch(/appointment to see a pharmacist in person/i);
    expect(text).toMatch(/remote service/i);
  });

  it('still records the clauses that carry legal weight', () => {
    const clauseIds = (FIRST.consentClauses ?? []).map((c) => c.id);
    for (const id of ['risks', 'accurate', 'storage', 'gp']) {
      expect(clauseIds).toContain(id);
    }
  });
});

describe('new patient — no appointment language survives', () => {
  it('does not tell the patient to complete it before an appointment', () => {
    expect(FIRST.description ?? '').not.toMatch(/appointment/i);
    expect(FIRST.title).toBe('Weight Management — New Patient');
  });
});
