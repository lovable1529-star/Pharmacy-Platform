import { describe, it, expect } from 'vitest';
import { matchAllergens, normaliseAllergen } from '@/lib/clinical/allergens';

describe('normaliseAllergen', () => {
  it('lowercases and trims, so both sides can meet', () => {
    expect(normaliseAllergen('  Egg  ')).toBe('egg');
    expect(normaliseAllergen('PENICILLIN')).toBe('penicillin');
  });
});

describe('matchAllergens', () => {
  it('matches an exact allergen', () => {
    expect(matchAllergens(['egg'], ['egg'])).toEqual(['egg']);
  });

  it('matches across case and whitespace', () => {
    // The whole reason both sides are normalised on write. If this ever fails,
    // the safety check is present on screen and silently dead.
    expect(matchAllergens(['Egg'], ['  EGG '])).toEqual(['egg']);
  });

  it('matches when the patient recorded more detail than the product', () => {
    expect(matchAllergens(['egg'], ['egg protein'])).toEqual(['egg']);
  });

  it('matches when the product name is longer than the patient entry', () => {
    expect(matchAllergens(['gentamicin sulfate'], ['gentamicin'])).toEqual([
      'gentamicin sulfate',
    ]);
  });

  it('returns every clashing allergen, not just the first', () => {
    const result = matchAllergens(['egg', 'gentamicin'], ['egg', 'gentamicin']);
    expect(result.sort()).toEqual(['egg', 'gentamicin']);
  });

  it('does not repeat an allergen matched by two patient entries', () => {
    expect(matchAllergens(['egg'], ['egg', 'egg protein'])).toEqual(['egg']);
  });

  it('finds nothing when the patient has no recorded allergies', () => {
    expect(matchAllergens(['egg', 'latex'], [])).toEqual([]);
  });

  it('finds nothing when the product declares no allergens', () => {
    expect(matchAllergens([], ['egg'])).toEqual([]);
  });

  it('does not match unrelated substances', () => {
    expect(matchAllergens(['latex'], ['penicillin'])).toEqual([]);
  });

  it('requires short entries to match exactly', () => {
    // Without the floor, a three-letter entry substring-matches half the
    // dictionary, every product raises a warning, and staff learn to click
    // past the one that matters.
    expect(matchAllergens(['penicillin'], ['nic'])).toEqual([]);
    expect(matchAllergens(['soy'], ['soy'])).toEqual(['soy']);
  });

  it('ignores blank entries on either side', () => {
    expect(matchAllergens(['', '  '], ['egg'])).toEqual([]);
    expect(matchAllergens(['egg'], ['', '   '])).toEqual([]);
  });

  it('catches the case that matters clinically', () => {
    // Egg-grown influenza vaccine, patient with a recorded egg allergy. This is
    // the exact pairing the check exists for.
    const clash = matchAllergens(['egg'], ['egg — anaphylaxis as a child']);
    expect(clash).toEqual(['egg']);
  });
});
