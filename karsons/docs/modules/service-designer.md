# Module — Service Designer & Form Runtime

## Purpose

Lets the client build a complete clinical service — questions, branching, clinician
form, declarations, outputs — without a developer. This is the capability Zoho could
not deliver and the reason this platform exists.

## Files

| File | Role |
|---|---|
| `src/types/form-schema.ts` | Schema structure |
| `src/lib/forms/runtime.ts` | Visibility, validation, pruning, numbering |
| `src/lib/forms/services/flu-vaccine.ts` | Flu service as pure configuration |
| `tests/form-runtime.test.ts` | Runtime behaviour |

## Field types

Text, textarea, number, date, dateOfBirth, select, multiselect, yesno, radio,
checkbox, scale, email, phone, address, signature, fileUpload, photoCapture,
measurement, info.

`measurement` handles the imperial/metric toggle — patients enter stones and inches,
the database stores kg and cm. Conversion happens at the UI boundary via
`src/lib/units`.

## Conditional logic

Two mechanisms, deliberately separate:

**`visibleWhen`** — show or hide based on any earlier answer. Works on fields and on
whole steps. All rules must pass.

**`reveals`** — a field spawns children when answered a particular way. This is the
client's most common pattern: *"Do you have allergies?" → Yes → detail box*. Reveals
nest arbitrarily deep.

## The rule that prevents contradictory records

`pruneHiddenAnswers()` **must** be called before persisting.

Consider: a patient answers "Yes" to allergies, types "Penicillin", then changes
their answer to "No". Without pruning, the record simultaneously says the patient
has no allergies and is allergic to penicillin. That is a clinical safety problem,
not untidiness.

## Clinician-only questions

Fields marked `clinicianOnly` appear inside the patient form in the correct clinical
order but are answered by the pharmacist at the appointment — for example *"Have you
had a fever in the last 24 hours?"*. Patient-side validation excludes them;
clinician-side validation includes them via `includeClinicianOnly: true`.

## Hidden option metadata

An option can carry data the patient never sees. Selecting a GP surgery captures its
`@gov.im` address; selecting a vaccine captures batch number and expiry.
`collectMetadata()` extracts these on submission.

This is exactly the auto-fill behaviour the client asked for, expressed as
configuration rather than code.

## Versioning

Published versions are immutable and submissions bind to the version they were
completed against. Editing a form never rewrites history.

## Gotchas

- Field `id` must be unique across the whole form, not just its step.
- `info` fields are display-only — never validated, never numbered.
- Question numbering runs across steps and includes revealed children.
