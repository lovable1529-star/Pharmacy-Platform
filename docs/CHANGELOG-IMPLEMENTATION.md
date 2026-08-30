# Karsons Pharmacy Platform — Implementation Changelog

This changelog is intentionally separate from the existing presentation-only `platform/CHANGELOG-UI.md`.

It must be updated during implementation. Do not wait until the end of the project and reconstruct changes from memory.

## Format

For each work session/PR, add entries under the current date using:

- **Added** — new capability/data model/screen.
- **Changed** — existing workflow/behaviour modified.
- **Fixed** — defect corrected.
- **Database** — Supabase/Drizzle changes.
- **Security/Audit** — permission, guard, audit or clinical-safety change.
- **Tests** — test coverage added/updated.
- **Deferred** — explicitly not implemented and why.
- **Verified** — end-to-end behaviours manually/automatically confirmed.

Always name important files/migrations and describe behavioural impact, not just “updated code”.

---

## 31 August 2026 - Stage 05, payment as a tick box

### Changed

- **Approval no longer sends a payment link.** `requestPayment` gained
  `notifyPatient`, defaulting to FALSE, and the approval path passes false
  explicitly. No provider is integrated, so a link leads to a page that cannot
  take money - sending one is worse than sending nothing. The token, the
  `/pay/[token]` page and the provider abstraction all remain; this is switched
  off, not deleted.
- `requestPaymentForSubmission` is now `raisePendingPayment`, and returns the
  payment id rather than a URL.
- The "Link" button on the payments screen appears only in demo mode.
- "Paid at till" is replaced by **"Payment received"**, which opens a tick and
  an optional note rather than settling on one click. Confirming allocates a
  prescription number, so it should not sit a stray click from a row somebody
  was scrolling past.

### Added

- `confirmManualPayment` - settles through the same `settlePayment()` a
  provider webhook will call, with provider `MANUAL` and `confirmed_by`
  recording who asserted the money arrived. `paid_at` is the event; the person
  is the accountability.
- `MANUAL` as a payment provider, deliberately distinct from `IN_PERSON`:
  one is cash at the counter, the other is staff asserting money arrived by a
  route the system cannot see. Collapsing them would leave a later
  reconciliation unable to tell which was which.
- `prescription.payment_id` is now written at settlement, so there is a trail
  from money to medicine. The database keeps it unique, so one payment can
  never sit behind two prescriptions.
- `src/lib/payments/confirm.ts` - `canConfirmPayment`, pure and tested.

### Fixed

- **The approval email told every patient "you can pay when you collect".**
  That branch renders whenever no payment link is passed, which is now always,
  and it is untrue for anybody having their medicine posted.

### Known debt

- `confirmManualPayment` is guarded by `reports:edit`, matching the existing
  `takeAtTill` beside it. There is no `payments` resource in the permission
  matrix; adding one means touching the matrix and every role, so it is
  recorded here rather than done quietly.

### Tests

- `tests/payment-confirm.test.ts` - 9 tests, including that confirming twice
  succeeds and reports no change rather than showing a failure for something
  that worked, and that money cannot be taken against a rejected request.

639 passing, typecheck clean, production build clean.

---

## 31 August 2026 - Stage 04, new patient workspace and the verification call

### Added

- **Two lanes on the Weight Management screen.** New patients and repeat
  requests are different jobs - one needs reading, telephoning and a
  prescriber's decision, the other needs authorising and nothing more. Split on
  `service.kind`, not on name, because the pharmacy renames its own services
  and a rename must not reshuffle the work. The tab shows how many are still
  owed a call.
- **RAG filters appear only on the repeat lane.** Three zeroes beside a list of
  new patients invites the reading that they were all triaged green; the
  new-patient service has no ruleset at all.
- **`clinical_contact_event` recording.** Every attempt is its own row - rang
  twice and reached them on the third is three records. Identity is forced
  false on any outcome other than COMPLETED, so a voicemail cannot unlock the
  gate, and a completed call with no notes is refused.
- **`src/lib/clinical/new-patient-gate.ts`** - the approval rules, pure and
  tested, returning every blocker at once rather than one at a time. Enforced
  server-side in `reviewSubmission` for `CONSULTATION` services only: the
  client is explicit that a routine repeat needs no call.
- **The prescriber's authorisation.** Medicine, strength, quantity and
  directions are recorded on approval and used to raise the prescription.

### Fixed

- **The prescription was raised from the patient's request.** `raisePrescription`
  read `answers.requestedMedicine` and the patient's own supply quantity, so a
  dose reduced during the call was silently ignored and the patient got what
  they originally asked for. Where an authorisation is recorded it now wins.
- **Constants exported from a `'use server'` module.** Only async functions may
  be exported from one. It passed typecheck and every test and failed the
  production build - the vocabulary now lives in `src/lib/clinical/contact.ts`.

### Tests

- `tests/new-patient-gate.test.ts` - 14 tests, including the case that matters
  most: a completed call where identity was NOT confirmed must not unlock an
  approval.

630 passing, typecheck clean, production build clean.

### Deferred

- Defer / Decline / Escalate as distinct actions. `INFO_REQUESTED` and
  `REJECTED` already exist and carry reasons; a separate escalation path needs
  the urgent-task wiring from Stage 07.
- Assignment and SLA display. The columns exist from migration 21 and nothing
  writes them yet.

---

## 31 August 2026 - Stage 03, the remote new-patient form

### Changed

- `buildWeightManagementFirstForm` is now `buildWeightManagementNewPatientForm`.
  The service keeps its slug and id; only the display name changes, to
  "Weight Management - New Patient".
- Module header no longer describes new patients as seen in person.
- Consent clause `appointment` replaced by `contact`. The old wording promised
  "an appointment to see a pharmacist in person at any time", which this
  service does not offer - being seen in person means referral to a separate
  programme.
- Seed and SQL export renamed to match.

### Added - form structure

- **Pathway step.** Explains the remote service, offers face-to-face, and hard
  stops with a referral if it is chosen. Every later step is gated on the
  remote choice, so a patient told to book elsewhere cannot continue.
- **About you.** firstName, lastName, dateOfBirth, gender, phone, email,
  address, GP surgery, and the other-clinic route question. The previous form
  asked none of the identity fields across forty-two questions, which is why
  every submission arrived as "Unmatched patient" and approving one raised no
  prescription.
- **Transfer step**, shown only when they are coming from another clinic:
  prior clinic, current medicine and strength, when that strength started, last
  supply, starting weight, side effects. The client has not supplied the exact
  question wording or acceptable proof, so this collects the categories he
  named and stops there.
- **Evidence:** photo ID, a photograph of the patient, and evidence of current
  weight, for everyone. Evidence of the current prescription for transfers only.
- **Supply step:** delivery or collection, with the branch asked only for
  collection and an address only for delivery. Not an appointment.

### Fixed

- **The collection branch never reached the submission.** `collectMetadata` has
  always written it into `_metadata` and nothing ever read it, so every
  submission without a booking was stored with `branchId: null` even though the
  patient had picked a pharmacy. A prescription number is allocated per branch,
  so approving one of those raised no prescription and said nothing about why.
  A booked appointment still wins; a draft without one now takes the choice.
- **`collectionBranch` appeared twice** in the new-patient form once the supply
  step was added - two fields sharing an id write the same answer key. The one
  in the request step was removed; collection now lives with the supply choice.
- **"Asked a question" missed the box the prose is in.** `anythingElse` is a
  yes/no and the text sits in `anythingElseDetail`. Checking only the yes/no
  counted every "no" as a question and missed everyone who had actually
  written something. Both detail fields are now read.

### Added - logic

- `src/lib/clinical/wm-eligibility.ts` - routes a patient and judges them
  against the client's criteria: BMI 30+, or 27+ with a weight-related
  condition; transfers at BMI 20 to under 25 flagged as needing verified
  continuation. It reports rather than blocks, because the client has not yet
  said what happens to somebody outside the criteria. Nothing is silently
  passed as eligible: "cannot be judged" is a distinct answer from "meets it".

### Tests

- `tests/wm-eligibility.test.ts` - 21 tests.
- `tests/weight-management.test.ts` - 18 new, covering the gate, identity,
  routing, evidence, supply and consent wording. Existing tests updated to
  choose the remote pathway first, which is the new precondition.
- `tests/repeat-summary.test.ts` - 3 new for the detail fields.

616 passing, typecheck clean, production build clean.

### Deferred

- Resource links before consent. Needs `patient_resource`, which needs the
  migrations, and the content is blocked on the client.
- Whether an ineligible patient is stopped at the form or accepted for review.
  Awaiting the client.

---

## 31 August 2026 - Stage 01, Drizzle schema

Migrations are NOT applied. The client is running every SQL script in one pass
once the code is finished, so the schema is written ahead of the database.

### Added - schema.ts

From `21_remote_weight_management_workflow.sql`:

- `submission.assignedTo`, `submission.reviewDueAt`
- `payment.confirmedBy`, `payment.confirmationNote`
- `paymentProviderEnum` value `MANUAL`
- `prescription.paymentId`
- `gpNotification.prescriptionId`
- `clinicalContactEvent`
- `prescriptionFulfilment`

From `22_service_experience_resources.sql`:

- `service.bookingMode`
- `servicePublicProfile`
- `patientResource`
- `resourceAcknowledgement`

### Tests

- `tests/pending-schema.test.ts` - 18 tests parsing the pending SQL and
  asserting every created table, added column and enum value is represented in
  `schema.ts`, and that neither script has crept into `platform/supabase/`.
  Written because deferring the migrations removes the usual safety net: the
  code targets a database it cannot be checked against, nothing fails, no type
  complains, and the first symptom would be a runtime error on a live system.

574 passing, typecheck clean.

### Deferred

- Applying 21 and 22. Held in `docs/pending-migrations/` at the client's
  request until all code changes are complete.

---

## 31 August 2026 — Stage 02, flu inventory and administration

### Changed

- **Receiving a batch moved from Settings to Inventory.** It is now a
  "Receive stock" action on the Inventory page itself, next to the list it
  changes, rather than a permanent form inside Settings → Stock. The dialog
  stays open after a successful receipt because a delivery is rarely one batch.
- Settings → Stock keeps the product catalogue and a read-only batch list, and
  points at Inventory for receipts.

### Fixed — clinical safety

- **A recall reported zero patients for any vaccination given through the
  administration path.** `getRecallImpact()` queried `consultation.batch_id`
  alone. Vaccinations recorded via `vaccine_administration` write their batch
  there and leave the consultation column null — on the live database that is
  already true of the only administered vaccination, so recalling its batch
  would have said nobody received it. Both sources are now queried and merged
  on patient id, keeping the earliest evidenced administration time.
- **A batch expiring today was refused.** The old check compared the parsed
  date (midnight UTC) against `new Date()`, so from shortly after midnight a
  batch that had not yet expired was rejected. Comparison is now at day
  resolution.
- **A receipt of zero doses was accepted.** It is now refused and points at
  adjustments, which carry a reason — recording zero as a delivery makes the
  movement ledger assert stock arrived when none did.

### Added

- `src/lib/inventory/receipts.ts` — receipt validation as a pure function, used
  by both the dialog and the server action so the answer is the same either way
  and the pharmacist gets it without a round trip to Seoul.
- `receiveBatch()` in the inventory domain, auditing as `inventory.receipt`.

### Database

None. Stage 02 touches no schema.

### Tests

- `tests/receipts.test.ts` — 14 tests. 556 passing overall, typecheck clean.

### Verified

- `/inventory`, `/settings` and `/vaccinations` compile and serve.
- Visual confirmation of the Receive dialog is outstanding — it needs a
  signed-in staff session.

---

## 31 August 2026 — Stage 00, safety net

Branch `feature/remote-weight-management` opened from `main` at `443e1d0`.

### Verified — baseline before any functional change

- 542 tests passing across 30 files.
- `tsc --noEmit` clean.
- `next build` completes; 40 routes compile.
- Tagged `baseline/pre-remote-wm` so this exact state is recoverable by name.

### Added

- `docs/IMPLEMENTATION_PLAN.md` — the supplied implementation plan, committed
  so future work is reviewed against it rather than against memory.
- `docs/CHANGELOG-IMPLEMENTATION.md` — this file, committed BEFORE functional
  work starts.
- `docs/pending-migrations/` — scripts 21 and 22 staged deliberately OUTSIDE
  `platform/supabase/`, with a README explaining the ordering hazard.

### Database — NOT yet applied

Nothing has touched the database. `_migration` still does not exist.

`pnpm db:migrate --baseline` records every `.sql` file present in
`platform/supabase/` at the moment it runs, and executes none of them. If 21
and 22 were in that directory during the baseline they would be recorded as
applied without ever running, leaving a ledger that claims success over a
database missing every new table. They are therefore held in
`docs/pending-migrations/` until the baseline is done.

Outstanding before Stage 01 can start:

1. Database backup taken by the client.
2. `pnpm db:migrate --baseline` run against a folder holding only 01–20.
3. `organisation_id` predicate added to the `update public.service` in script 22.

### Deferred

- Baseline screenshots. The authenticated screens need a signed-in staff
  session, and the dev server session was lost when the production build wrote
  to the shared `.next` directory. The git tag records the code state; the
  screens can be captured by whoever next signs in.

---

## 30 August 2026 — Planning baseline

### Added — planned

- Remote NEW Weight Management workflow specification.
- NEW patient remote-vs-F2F pathway gate.
- NEW-to-treatment vs transfer/continuation onboarding branch.
- Client-supplied new-treatment BMI criterion: BMI ≥30, or BMI ≥27 with weight-related comorbidity.
- Client-supplied transfer rule: current BMI 20–<25 may proceed only as verified continuation.
- Structured NEW-patient pharmacist verification call.
- Manual staff “Payment received” confirmation gate.
- Weight Management prescription fulfilment model supporting collection and delivery.
- Mandatory WM pack batch/expiry before supply.
- Configurable patient resource library and acknowledgement snapshots.
- Standalone patient-facing Weight Management branding with Karsons fulfilment identity.
- Service booking modality (`REQUIRED` / `OPTIONAL` / `NONE`).
- Operational Weight Management queue/dashboard design.

### Changed — planned

- `Weight Management — First Consultation` becomes the remote `Weight Management — New Patient` journey; historical service identity/slug should be retained unless a deliberate URL migration is made.
- Weight Management NEW and REPEAT are both non-F2F.
- Face-to-face preference no longer creates an ordinary internal WM appointment; it exits to the separate Karsons F2F programme.
- Repeat GREEN no longer means automatic clinical approval; it means fast-track prescriber authorisation.
- Repeat AMBER requires documented pharmacist assessment/contact.
- Repeat RED cannot proceed to payment.
- Approval no longer automatically sends a payment link in the current phase.
- GP notification timing for Weight Management follows latest client chat: after payment confirmation when Rx is issued.
- Day-to-day batch receipt moves from Settings to Inventory.

### Database — proposed

- `21_remote_weight_management_workflow.sql`
  - submission assignment/SLA columns;
  - payment manual confirmation audit;
  - payment→prescription linkage;
  - structured `clinical_contact_event`;
  - `prescription_fulfilment`;
  - GP notification→prescription linkage.
- `22_service_experience_resources.sql`
  - `service.booking_mode`;
  - `service_public_profile`;
  - `patient_resource`;
  - `resource_acknowledgement`;
  - Weight Management service metadata update.

### Deferred

- SmarterPayments/live e-commerce integration.
- Exact 3-month repeat-supply eligibility rule.
- Exact transfer-patient question wording/evidence rules beyond the client's latest route-level requirements.
- Final standalone clinic branding/content.
- Final digital resource URLs/content.
- Delivery-carrier API integration.

### Current implementation status

**Planning only. No application source code or production database has been changed by this package.**

---

## Template for next implementation entry

## YYYY-MM-DD — <short milestone>

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Database
- ...

### Security/Audit
- ...

### Tests
- ...

### Deferred
- ...

### Verified
- ...

