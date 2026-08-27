import { describe, expect, it } from 'vitest';
import {
  checkAllergies,
  checkBatch,
  checkCrossBranchSupply,
  checkStock,
  runPreAdministrationChecks,
  summariseSafety,
} from '@/lib/clinical/safety';

const NOW = new Date('2026-08-27T10:00:00Z');

const fluenz = {
  id: 'p1',
  name: 'Fluenz Tetra Nasal Spray',
  allergens: ['egg', 'gelatin'],
};

const validBatch = {
  batchNumber: 'NS55210',
  expiryDate: new Date('2027-01-31T00:00:00Z'),
  recalledAt: null,
};

describe('allergy cross-check', () => {
  it('blocks a direct allergen match', () => {
    const findings = checkAllergies([{ substance: 'egg', severity: 'Anaphylaxis' }], fluenz);
    expect(findings[0]?.severity).toBe('BLOCK');
    expect(findings[0]?.code).toBe('ALLERGY_CONFLICT');
  });

  it('matches through a synonym — patient says "eggs", product lists "ovalbumin"', () => {
    const product = { id: 'p2', name: 'Vaccine X', allergens: ['ovalbumin'] };
    const findings = checkAllergies([{ substance: 'eggs' }], product);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('BLOCK');
  });

  it('matches gelatine spelled either way', () => {
    expect(checkAllergies([{ substance: 'gelatine' }], fluenz)).toHaveLength(1);
  });

  it('matches a penicillin class member', () => {
    const product = { id: 'p3', name: 'Amoxicillin 500mg', allergens: ['amoxicillin'] };
    expect(checkAllergies([{ substance: 'penicillin' }], product)).toHaveLength(1);
  });

  it('does not flag an unrelated allergy', () => {
    expect(checkAllergies([{ substance: 'shellfish' }], fluenz)).toHaveLength(0);
  });

  it('returns nothing when the product has no recorded allergens', () => {
    const product = { id: 'p4', name: 'Sterile Water', allergens: [] };
    expect(checkAllergies([{ substance: 'egg' }], product)).toHaveLength(0);
  });

  it('includes the recorded severity in the message so the pharmacist sees the stakes', () => {
    const findings = checkAllergies([{ substance: 'egg', severity: 'Anaphylaxis' }], fluenz);
    expect(findings[0]?.detail).toContain('Anaphylaxis');
  });
});

describe('batch checks', () => {
  it('passes a valid batch', () => {
    expect(checkBatch(validBatch, NOW)).toHaveLength(0);
  });

  it('blocks an expired batch', () => {
    const expired = { ...validBatch, expiryDate: new Date('2026-06-30T00:00:00Z') };
    const findings = checkBatch(expired, NOW);
    expect(findings[0]?.severity).toBe('BLOCK');
    expect(findings[0]?.code).toBe('BATCH_EXPIRED');
  });

  it('blocks a recalled batch', () => {
    const recalled = { ...validBatch, recalledAt: NOW, recallReason: 'Manufacturer withdrawal' };
    const findings = checkBatch(recalled, NOW);
    expect(findings[0]?.severity).toBe('BLOCK');
    expect(findings[0]?.detail).toContain('Manufacturer withdrawal');
  });

  it('flags a batch expiring within 30 days as info, not a block', () => {
    const soon = { ...validBatch, expiryDate: new Date('2026-09-10T00:00:00Z') };
    const findings = checkBatch(soon, NOW);
    expect(findings[0]?.severity).toBe('INFO');
    expect(findings[0]?.detail).toMatch(/use this batch first/i);
  });
});

describe('stock checks', () => {
  it('passes when stock is sufficient', () => {
    expect(checkStock(10, 1, 'Fluenz')).toHaveLength(0);
  });

  it('blocks when stock is insufficient and says what is available', () => {
    const findings = checkStock(0, 1, 'Fluenz');
    expect(findings[0]?.severity).toBe('BLOCK');
    expect(findings[0]?.detail).toContain('Available: 0');
  });
});

describe('cross-branch supply', () => {
  it('warns when the patient was supplied at another branch recently', () => {
    const findings = checkCrossBranchSupply(
      [{ branchName: 'Onchan', suppliedAt: new Date('2026-08-24T10:00:00Z'), medicine: 'Mounjaro', months: 1 }],
      'Kirk Michael',
      NOW,
    );
    expect(findings[0]?.severity).toBe('WARN');
    expect(findings[0]?.message).toContain('Onchan');
    expect(findings[0]?.message).toContain('3 days ago');
  });

  it('warns rather than blocks — there are legitimate explanations', () => {
    const findings = checkCrossBranchSupply(
      [{ branchName: 'Onchan', suppliedAt: new Date('2026-08-26T10:00:00Z'), medicine: 'Wegovy', months: 1 }],
      'Kirk Michael',
      NOW,
    );
    expect(summariseSafety(findings).canProceed).toBe(true);
    expect(summariseSafety(findings).requiresAcknowledgement).toBe(true);
  });

  it('ignores supply at the same branch', () => {
    const findings = checkCrossBranchSupply(
      [{ branchName: 'Kirk Michael', suppliedAt: new Date('2026-08-24T10:00:00Z'), medicine: 'Mounjaro', months: 1 }],
      'Kirk Michael',
      NOW,
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores supply outside the window', () => {
    const findings = checkCrossBranchSupply(
      [{ branchName: 'Onchan', suppliedAt: new Date('2026-06-01T10:00:00Z'), medicine: 'Mounjaro', months: 1 }],
      'Kirk Michael',
      NOW,
    );
    expect(findings).toHaveLength(0);
  });
});

describe('runPreAdministrationChecks', () => {
  const baseInput = {
    allergies: [],
    product: fluenz,
    batch: validBatch,
    availableStock: 50,
    requiredQuantity: 1,
    identityVerified: true,
    hasAllergyHistory: true,
    now: NOW,
  };

  it('allows a clean administration', () => {
    const result = runPreAdministrationChecks(baseInput);
    expect(result.canProceed).toBe(true);
    expect(result.requiresAcknowledgement).toBe(false);
  });

  it('blocks when identity is not verified', () => {
    const result = runPreAdministrationChecks({ ...baseInput, identityVerified: false });
    expect(result.canProceed).toBe(false);
  });

  it('warns when no allergy history exists — absence of evidence is not safety', () => {
    const result = runPreAdministrationChecks({ ...baseInput, hasAllergyHistory: false });
    expect(result.canProceed).toBe(true);
    expect(result.requiresAcknowledgement).toBe(true);
    expect(result.findings.some((f) => f.code === 'NO_ALLERGY_HISTORY')).toBe(true);
  });

  it('blocks on an allergy conflict', () => {
    const result = runPreAdministrationChecks({
      ...baseInput,
      allergies: [{ substance: 'egg', severity: 'Anaphylaxis' }],
    });
    expect(result.canProceed).toBe(false);
  });

  it('surfaces several problems at once', () => {
    const result = runPreAdministrationChecks({
      ...baseInput,
      allergies: [{ substance: 'egg' }],
      batch: { ...validBatch, expiryDate: new Date('2026-01-01T00:00:00Z') },
      availableStock: 0,
    });
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    expect(result.canProceed).toBe(false);
  });

  it('orders blocks before warnings before information', () => {
    const result = runPreAdministrationChecks({
      ...baseInput,
      allergies: [{ substance: 'egg' }],
      hasAllergyHistory: false,
      batch: { ...validBatch, expiryDate: new Date('2026-09-05T00:00:00Z') },
    });
    expect(result.findings[0]?.severity).toBe('BLOCK');
    expect(result.findings.at(-1)?.severity).toBe('INFO');
  });
});
