# Module — Clinical Safety

## Purpose

The last checks before something reaches a patient. Runs at the moment a
pharmacist is about to administer or supply.

## Files

| File | Role |
|---|---|
| `src/lib/clinical/safety.ts` | All checks |
| `src/lib/patients/search.ts` | Search ranking, duplicate detection |
| `tests/clinical-safety.test.ts` | 23 tests |
| `tests/patient-search.test.ts` | 29 tests |

## Severity

| Severity | Effect |
|---|---|
| `BLOCK` | Stops the action. Override requires recorded clinical justification |
| `WARN` | Requires explicit acknowledgement, recorded with the pharmacist's name |
| `INFO` | Displayed only |

## The rule that matters most

**A check that cannot be performed returns a warning, not a pass.**

If no allergy history exists, `checkDataCompleteness` warns that the check could
not be made. Absence of evidence is not evidence of safety, and silently passing
is how software contributes to harm.

## Allergy cross-check

Compares the product's allergens against the patient's recorded allergies, with
synonym expansion — a patient records "eggs", a product lists "ovalbumin".
Without the mapping the check silently passes.

`ALLERGEN_SYNONYMS` is deliberately conservative. It catches obvious misses; it
does not replace a pharmacist reading the label.

A match is a `BLOCK`. This is the failure mode that actually harms someone.

## Batch checks

Recalled batches and expired batches both `BLOCK`. Batches within 30 days of
expiry produce an `INFO` telling the pharmacist to use that stock first.

## Cross-branch supply

Flags a patient obtaining supply at more than one branch inside 21 days.

The client raised this concern directly. It is detectable **only because patients
are organisation-scoped** — in two separate systems it would be invisible.

`WARN`, not `BLOCK`. There are legitimate explanations: travel, a damaged pen. It
needs a conversation, not an automatic refusal.

## Patient search

One free-text box. A pharmacist types whatever they have — a surname, a date of
birth, sometimes both at once — and `parseQuery()` works out which is which.

Date of birth is weighted heaviest. On the Isle of Man surnames repeat constantly
— Kelly, Quayle, Corlett — and a date of birth is nearly unique.

Fuzzy matching tolerates typos and misheard names: "Kermodee" finds Kermode.

## Duplicate detection

Runs before creating a patient. Duplicates are a genuine clinical risk — half the
allergy history in one record, half in the other.

It **suggests**. It never merges automatically. Merging needs a human.

## Gotchas

- A postcode is two tokens ("IM3 1AR"), lifted out before whitespace splitting.
- Two-digit years expand to the past: "74" means 1974.
- Impossible dates like 31 February are rejected, not rolled over.
