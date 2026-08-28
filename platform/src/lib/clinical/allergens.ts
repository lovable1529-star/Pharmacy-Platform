/**
 * Matching a product's allergens against what a patient reacts to.
 *
 * Both sides are stored lowercase and trimmed precisely so this comparison
 * works. "Egg" on the patient record and "egg" on the product would otherwise
 * silently fail to match — which is the worst kind of safety check, one that
 * looks present and never fires.
 *
 * Everything here WARNS. Nothing blocks: an egg allergy contraindicates some
 * influenza vaccines and not others, and the pharmacist working to a PGD is the
 * one qualified to decide. The trade is false positives, and that is the right
 * way round — a pharmacist shown a warning that does not apply loses five
 * seconds, while one shown nothing loses the patient.
 */

/** Normalised the same way on both sides, or the comparison is theatre. */
export function normaliseAllergen(value: string): string {
  return value.trim().toLowerCase();
}

/** Escapes a value being placed into a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `needle` appear inside `haystack` as a whole word?
 *
 * Word boundaries rather than raw substring, and rather than a minimum length.
 * The first version of this used a length floor and it was wrong in exactly the
 * case that matters most: "egg" is a real three-letter allergen, and a patient
 * record reading "egg protein" or "egg — anaphylaxis as a child" must match a
 * product whose allergen is simply "egg". A floor tuned to stop "nic" matching
 * inside "penicillin" also stopped that, leaving the check dead where it was
 * needed. The tests caught it.
 *
 * Boundaries separate the two cleanly: "egg" is a whole word inside "egg
 * protein"; "nic" is not a whole word inside "penicillin".
 */
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`\\b${escapeForRegExp(needle)}\\b`).test(haystack);
}

/** Which of the product's allergens this patient has a recorded reaction to. */
export function matchAllergens(
  productAllergens: readonly string[],
  patientAllergies: readonly string[],
): string[] {
  const declared = patientAllergies.map(normaliseAllergen).filter(Boolean);
  if (declared.length === 0) return [];

  const matched = new Set<string>();

  for (const raw of productAllergens) {
    const allergen = normaliseAllergen(raw);
    if (!allergen) continue;

    for (const patient of declared) {
      // Either direction: the product may name the substance more precisely
      // than the patient did, or the patient may have written a sentence
      // around it.
      if (containsWord(patient, allergen) || containsWord(allergen, patient)) {
        matched.add(allergen);
        break;
      }
    }
  }

  return [...matched];
}
