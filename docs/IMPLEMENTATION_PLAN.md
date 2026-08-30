# Karsons Pharmacy Platform — Detailed Implementation Plan

**Prepared:** 30 August 2026  
**Repository reviewed:** `Pharmacy-Platform-main/platform`  
**Primary requirement source:** latest client WhatsApp conversation and the latest NEW-patient workflow image. Earlier client documents apply only where they do not conflict with the newer chat.  
**Current implementation decision:** payment is a staff-confirmed **Payment received** gate for now; no live SmarterPayments integration in this phase.

---

## 1. Implementation objective

Enhance the current platform rather than rebuild it.

The existing code already has strong foundations: versioned configurable forms, patient records, audit logging, RAG evaluation, repeat-care enrolment, prescriptions, payment lifecycle, inventory movements, vaccination administration, appointments, communications and role/branch permissions. The work should preserve those foundations while changing the workflow so the product matches the client's current operating model.

The target product has:

1. **Flu Vaccination** — appointment-led but walk-in capable, face-to-face administration, real batch selection, automatic stock deduction and GP reporting.
2. **Weight Management — NEW patient** — remote/low-touch, no routine F2F; remote-pathway gate; new-treatment vs transfer/continuation routing; ID/photo/evidence; pharmacist review and mandatory verification call; clinical decision; manual payment confirmation; prescription; batch/expiry; collection/delivery.
3. **Weight Management — REPEAT** — remote; only previously onboarded patients; smart pre-population; RAG engine; GREEN fast-track prescriber authorisation, AMBER documented assessment/contact, RED safety stop; then the same payment/prescription/fulfilment path.

The implementation should also improve information architecture, admin configurability, queue visibility, auditability and future integration readiness.

---

## 2. Non-negotiable implementation principles

### 2.1 Latest client chat wins

If the code or an older SOW says something different from the latest client chat, implement the latest client chat.

Examples:

- Existing first Weight Management form says it is completed before an in-person appointment. **This must change.**
- Existing README says GREEN auto-approves. **This must change:** GREEN still requires prescriber authorisation.
- Existing RAG messages say some cases need review “in person”. **This must change:** the low-touch service uses pharmacist phone contact/intervention; F2F is a separate external Karsons programme.
- The current code creates/sends a payment link after approval. **This must be disabled for this phase** and replaced with manual confirmation.

### 2.2 Do not rebuild the shell

Keep the current Next.js/React/TypeScript/Supabase/Drizzle architecture. Refactor workflows and modules in place.

### 2.3 Keep clinical facts separate

Do not collapse clinical approval, payment, prescription issue, dispensing and supply into one status. They are different auditable events.

### 2.4 Server-side gates are mandatory

Buttons may be disabled in the browser for UX, but the server/database must also enforce:

- NEW patient cannot be approved without the required verification-call evidence.
- RED repeat cannot proceed to payment or prescription.
- Prescription cannot be issued before payment confirmation.
- Weight Management supply cannot complete without batch and expiry.
- Flu cannot administer from expired, recalled or zero-stock batches.

### 2.5 Preserve immutable/versioned clinical history

Published form/rules versions remain immutable. If a form or ruleset changes, publish a new version. Do not edit a historical version in place.

### 2.6 Keep the system configurable

Where the client is expected to maintain something operationally — form wording, resources, branding, product masters, dose ladders, clinical rule thresholds/advice — build admin controls against data/versioned configuration rather than hard-coding it into one screen.

---

## 3. Current codebase: what should be reused

### Keep with small/no structural change

- `src/types/form-schema.ts` — strong versioned schema model.
- `src/components/form/wizard.tsx` — generic patient form runtime.
- `src/components/fields/*` — uploads, photo capture, signature and conditional controls already exist.
- `src/lib/rules/engine.ts` — pure RAG engine with complete trace and “most severe wins”.
- `src/lib/rules/glp1-ruleset.ts` — useful starting clinical rule content; messages/semantics need updating.
- `rule_evaluation` — already stores outcome + full trace + advice.
- `repeat_enrolment` — correct safety gate for repeat access.
- `src/lib/clinical/derived.ts`, `previous-supply.ts`, `repeat-request.ts` — keep as repeat calculation layer.
- `payment` + `src/lib/payments/lifecycle.ts` — keep one settlement event as the gate; simplify the active entry point.
- `prescription` + `src/lib/prescriptions/issue.ts` — existing PENDING_PAYMENT → ISSUED concept is useful.
- `vaccine_administration` + `src/lib/vaccination/administration.ts` — already close to the Flu requirement.
- `stock_level` / `stock_movement` — already a good ledger/projection model.
- `document`, `consent_record`, `gp_notification`, `urgent_task`, `audit_event` — preserve and extend.
- appointments/calendar — retain for Flu and future appointment-led services.

### Areas to change significantly

- `src/lib/services/weight-management.ts`
- `src/app/(staff)/repeat-care/*`
- NEW Weight Management staff review/call UI (new feature)
- `src/app/(staff)/payments/*`
- `src/lib/payments/lifecycle.ts`
- `src/lib/prescriptions/issue.ts`
- `src/app/(staff)/prescriptions/*`
- `src/app/(staff)/inventory/*`
- `src/app/(staff)/settings/*`
- `src/app/(staff)/page.tsx` (Today dashboard)
- `src/lib/notifications/*`
- `src/app/f/[slug]/*` public branding/resource rendering
- Service Designer / Rules admin where configuration is missing

---

# 4. Recommended implementation sequence

Implement in the following order. Do not start with visual polish; start with data/gates, then workflows, then dashboard/navigation.

---

## Phase 0 — Baseline, branch and safety net

### Tasks

1. Create a feature branch, e.g. `feature/remote-weight-management`.
2. Run existing tests/build before changing anything.
3. Capture existing screenshots of:
   - Today dashboard
   - Weight Management first form
   - repeat form/access page
   - repeat-care queue
   - payments
   - prescriptions
   - inventory
   - Settings → Stock
   - Flu administration
4. Add the implementation `CHANGELOG.md` from this package to the repository root or `docs/`.
5. Record the current database migration level (01–20).
6. Back up the Supabase database before applying migrations 21/22.

### Exit criteria

- Existing baseline behaviour is reproducible.
- Build/tests are green or known failures are documented before implementation.
- Changelog is committed before functional work begins.

---

## Phase 1 — Database model and Drizzle schema

### Apply migrations

1. `supabase/21_remote_weight_management_workflow.sql`
2. `supabase/22_service_experience_resources.sql`

### Update `src/lib/db/schema.ts` to match

Add:

- `submission.assignedTo`
- `submission.reviewDueAt`
- `payment.confirmedBy`
- `payment.confirmationNote`
- `paymentProviderEnum` value `MANUAL`
- `prescription.paymentId`
- `clinicalContactEvent`
- `prescriptionFulfilment`
- `gpNotification.prescriptionId`
- `service.bookingMode`
- `servicePublicProfile`
- `patientResource`
- `resourceAcknowledgement`

### Why these DB changes are justified

#### `clinical_contact_event`
The client's NEW-patient call is a clinical safety touchpoint and workflow gate. A free-text note on the request is not sufficient to prove who called, whether identity was verified, what the outcome was and whether follow-up is required.

#### `prescription_fulfilment`
Existing prescription lifecycle has no delivery path and no structured mandatory WM pack batch/expiry record. Physical fulfilment should not be overloaded into the legal prescription record.

#### resource tables
Resources must be configurable, reusable in emails and provably acknowledged. Hard-coded links in the form cannot satisfy all three cleanly.

#### `service.booking_mode`
Appointment modality is independent from `service.kind`. Flu is appointment-capable with walk-ins; both Weight Management services have no internal booking.

#### public profile
The Weight Management clinic needs standalone patient-facing branding while Karsons remains the fulfilment pharmacy.

### Important: do not add unnecessary tables

Do **not** add a new Weight-Management-specific case table unless implementation proves it is needed. The existing chain already models the request well:

`submission → rule_evaluation/review_event/contact_event → payment → prescription → fulfilment`

This avoids duplicate status sources.

### Exit criteria

- Supabase migrations succeed on a non-production environment.
- Drizzle schema compiles.
- No current records are destroyed or rewritten.
- Both WM services have `booking_mode = NONE`; Flu has `OPTIONAL`.

---

## Phase 2 — Redefine service configuration: NEW Weight Management

### Current conflict

`src/lib/services/weight-management.ts` explicitly states:

- FIRST CONSULTATION is in person.
- new patients are not self-serve.
- form description tells patient to complete it before an appointment.

That entire assumption is now obsolete.

### Keep the existing service record, change its meaning

For minimum risk, do **not** delete/recreate the service. Keep the existing service ID and slug `weight-management-first` unless there is a deliberate URL migration. Rename its display name to:

**Weight Management — New Patient**

This preserves old links/history while making its current purpose clear.

### NEW patient form v2 structure

Publish a new form version; do not modify v1.

#### Step 1 — Remote pathway choice

Required question:

- Continue with the low-touch remote service
- I want face-to-face care

If F2F is chosen:

- show clear guidance that the remote service may not be suitable;
- show configured Karsons F2F booking link;
- stop progression of this online form;
- do not create an internal Weight Management appointment.

The referral URL must come from `service_public_profile.f2f_referral_url` when configured, not from a hard-coded URL.

#### Step 2 — Onboarding route

Use the client's wording/meaning:

> Are you currently receiving, or have you recently received, weight-management treatment from another clinic?

- `No` → new to treatment
- `Yes` → transfer / continuation

#### Step 3A — New to treatment eligibility

Client-supplied route criterion:

- BMI ≥ 30; OR
- BMI ≥ 27 plus a weight-related comorbidity.

Implementation approach:

- calculate BMI from height/weight using existing derived field;
- reuse `WEIGHT_RELATED_CONDITIONS` options;
- add an explicit eligibility information/warning layer;
- do not invent additional treatment eligibility conditions that the client has not supplied.

A patient outside the supplied route criterion should not silently continue as eligible. Route them to review/not-eligible handling according to the configured clinical policy.

#### Step 3B — Transfer / continuation

Conditional content when prior/current clinic treatment = yes.

Known requirements:

- prior clinic details;
- baseline/treatment evidence questions;
- ID/photo/BMI evidence;
- prior prescription/treatment evidence;
- current BMI 20–<25 may proceed only as verified continuation.

Important: exact individual transfer questions are not fully supplied yet. Build the branch and configuration capability; do not fabricate clinical question wording.

#### Step 4 — Common clinical safety dataset

Reuse appropriate existing first-form content:

- measurements;
- contraindications;
- medical history;
- other medication;
- allergies;
- recent surgery;
- pregnancy/other relevant safety questions where applicable;
- requested treatment data only where clinically appropriate.

Review current wording so no question implies a face-to-face appointment.

#### Step 5 — Evidence

Use existing `fileUpload` / `photoCapture` capabilities.

At minimum support configured evidence prompts for:

- ID;
- patient photo where required;
- BMI/measurement evidence;
- prior prescription/current medicine evidence for transfers.

Each stored file should continue to register under `document` / `PATIENT_EVIDENCE` where appropriate.

#### Step 6 — Resources

Load active `patient_resource` records for the service and selected medicine where applicable.

Display before final consent/signature.

For every resource with `requires_acknowledgement=true`:

- require acknowledgement before submission;
- insert a `resource_acknowledgement` snapshot when final submission is accepted.

#### Step 7 — declarations / T&Cs / privacy / signature

Update old GLP-1 consent wording that currently says the patient can make an in-person appointment “at any time”. Replace it with wording consistent with the new remote clinic and external F2F referral model, using final client-approved wording when supplied.

Keep exact consent snapshot via existing `consent_record` and form versioning.

#### Step 8 — delivery/collection choice

Capture:

- Collection + selected fulfilment branch; OR
- Delivery + delivery address confirmation.

Do not treat this as an appointment.

### Public copy changes

No public NEW WM screen should say:

- “before your appointment”
- “seen in person”
- “book an appointment” as the ordinary path.

### Exit criteria

- NEW form can complete remotely end-to-end.
- F2F choice exits to external Karsons route.
- new vs transfer branch works.
- supplied BMI rules are enforced/flagged.
- evidence and resource acknowledgement are captured.
- no old appointment-dependent copy remains in the active v2 form.

---

## Phase 3 — NEW Weight Management staff queue, review and phone call

### New staff workflow

Create a dedicated NEW-patient queue or a clear tab/filter within a unified Weight Management workspace.

Recommended route:

`/weight-management` or extend `/repeat-care` into a Weight Management workspace with tabs:

- New patients
- Repeat GREEN
- Repeat AMBER
- Repeat RED
- Awaiting payment
- Fulfilment

Avoid scattering one process across unrelated screens.

### NEW queue card/table fields

Show:

- patient name/DOB;
- route: New to treatment / Transfer;
- submitted age (“18 min ago”);
- assigned staff;
- due/SLA indicator;
- BMI;
- evidence completion;
- patient question/flags;
- call state: Not called / No answer / Completed / Follow-up required;
- request state.

### Structured verification call

Add server actions/UI writing to `clinical_contact_event`.

Purpose key:

`NEW_PATIENT_VERIFICATION`

Minimum fields:

- attempt/start time;
- clinician/staff;
- reached patient?;
- identity verified?;
- verification details;
- findings;
- advice;
- notes;
- follow-up required;
- outcome;
- completion time.

### Server-side approval gate

Before NEW patient approval, query for a completed contact event:

- same submission;
- purpose `NEW_PATIENT_VERIFICATION`;
- outcome `COMPLETED`;
- identity verified = true.

If missing, refuse approval server-side.

### Clinical decision form

Actions:

- Approve
- Defer for information
- Decline
- Escalate

On approval require final prescriber fields:

- medicine;
- strength/dose;
- quantity/supply period;
- directions/instructions;
- rationale;
- clinician/prescriber identity.

Important: do not use the patient's requested medicine as the authoritative final prescription if the prescriber changed it.

Use `review_event` for the decision event and rationale; `raisePrescription()` receives the final authorised values.

### Defer for information

- set `submission.status = INFO_REQUESTED`;
- record `review_event`;
- queue patient notification if configured;
- preserve exact missing-information request;
- on resubmission return it to the queue with history visible.

### Decline

- require reason;
- store `review_event` and rejection document;
- communicate safe/non-clinically-sensitive patient wording;
- no payment, no Rx.

### Escalate

- keep request in review;
- create/update `urgent_task` or equivalent clinical escalation task;
- require reason;
- no payment, no Rx until resolved and explicitly approved.

### Exit criteria

- NEW patient cannot be approved without completed verified call.
- all decisions are attributable and timestamped.
- final prescribed product is clinician-controlled.

---

## Phase 4 — Repeat Weight Management: align RAG with newest workflow

### Keep repeat enrolment gate

`repeat_enrolment` remains required. Non-enrolled patients should not access repeat form.

Change the user-facing failure direction:

- old code points them to booking;
- new target should direct them to the appropriate NEW remote pathway, unless the client deliberately wants F2F.

### Smart prepopulation

Repeat form should prepopulate/read-only-display where appropriate:

- last supplied medicine;
- last supplied strength;
- last supply date;
- previous weight;
- height;
- due date / time since last supply.

Continue to calculate:

- age;
- BMI;
- weight loss %;
- weeks on current dose;
- dose step change;
- missed-dose number.

Baseline/history must only move forward after a real supply is completed, not at approval or payment.

### RAG semantics

#### GREEN

- system says protocol criteria met;
- appears in a fast-track prescriber queue;
- **still requires prescriber authorisation**;
- no mandatory phone call.

#### AMBER

- requires documented assessment/contact;
- approval requires note/rationale;
- phone contact can be recorded via `clinical_contact_event`;
- after resolution, prescriber can approve or decline.

#### RED

- no normal payment action;
- no prescription issue;
- create/surface urgent task;
- patient receives safe advice/signposting;
- pharmacist intervention required.

### Update outdated rule messages

In `src/lib/rules/glp1-ruleset.ts`, replace phrases such as:

- “reviewing in person”
- “Needs review in person”
- “Book them in”

with wording consistent with remote pharmacist review/contact and the separate F2F referral pathway.

### 3-month supply

Keep the existing “3 months → AMBER” rule as an interim conservative configuration if needed, but label the exact 3-month permission criteria as pending client confirmation. Do not silently convert it to GREEN based on an invented rule.

### Rules admin enhancement

The DB already has `ruleset_version.definition`. Build the missing client-facing admin capability rather than adding a second rules model.

Minimum rules admin features:

- list rules with label/outcome/priority/enabled;
- edit threshold/condition values safely;
- edit clinician message, patient message and advice;
- draft vs published version;
- publish creates a new immutable version;
- simulator against sample/historical submission before publish;
- show diff from current published version.

Do not expose arbitrary executable code.

### Exit criteria

- GREEN never auto-issues an Rx.
- AMBER cannot be approved without documented review rationale.
- RED cannot reach payment.
- trace is visible in staff review.
- existing clinical rules continue to evaluate with previous weight/dose history correctly wired.

---

## Phase 5 — Replace live payment-link flow with manual Payment received

### Current behaviour to change

`src/app/(staff)/repeat-care/actions.ts` currently calls `requestPaymentForSubmission()` after approval, which can create and send a payment link.

For this phase:

- approval should create/retain a pending payment gate;
- **do not send the patient `/pay/[token]` link**;
- request moves to Awaiting Payment;
- staff confirms payment manually.

### UI

On approved case/payment card:

> Payment verification  
> ☐ I confirm payment has been received for this order.  
> **Confirm payment & issue prescription**

Optional display:

- expected amount;
- patient;
- service;
- branch;
- approved product.

### Server action

Create `confirmManualPayment(paymentId, acknowledgement)`.

Requirements:

1. require acknowledgement = true;
2. authorise user;
3. ensure payment is still PENDING;
4. call the same `settlePayment()` lifecycle used by future webhooks;
5. provider = `MANUAL`;
6. set `confirmed_by = actor.userId`;
7. write `audit_event action = payment.confirmed_manual`;
8. settlement remains idempotent.

### Refactor `settlePayment`

Extend input:

- `confirmedBy?: string | null`
- `confirmationNote?: string | null`

When settled, attach `prescription.payment_id` before/while issuing.

### Do not delete future integration code

Keep:

- provider abstraction;
- payment token machinery;
- `/pay/[token]` route;
- webhook-ready settlement model.

But make the active current workflow manual.

### Exit criteria

- approval never sends a live payment link in this phase.
- Rx cannot issue without paid state.
- manual payment confirmation is attributable.
- repeated click/request does not create duplicate prescription/number.

---

## Phase 6 — Prescription issue, GP notification and fulfilment

### Prescription timing

Keep internal prescription row creation on clinical approval if useful, but:

- status stays `PENDING_PAYMENT`;
- no issued number/document until payment confirmed;
- payment settlement allocates number and moves to `ISSUED`.

### Important fix to current approval path

Current repeat approval raises the prescription using `answers.requestedMedicine` and patient-requested quantity.

Change it so approval action explicitly passes the **prescriber-authorised** values:

- medicine;
- strength;
- quantity;
- directions;
- price if applicable;
- clinician;
- rationale stays in review history.

### Prescription document generation

On `ISSUED`:

- generate/store locked PDF;
- register document as `PRESCRIPTION`;
- attach to patient and submission;
- route to selected branch inbox/dispensary queue.

### GP notification

Latest client chat takes precedence:

- trigger GP notification when payment is confirmed and the prescription is issued;
- record `gp_notification.prescription_id`;
- preserve recipient snapshot, status/failure and resend history.

Do not require a fake appointment/consultation relationship for a remote WM prescription.

### Create fulfilment record

When Rx becomes `ISSUED`, create one `prescription_fulfilment` record from the patient choice:

- COLLECTION; or
- DELIVERY.

Snapshot delivery address if delivery.

### Assembly workflow

Statuses:

- PENDING
- ASSEMBLING
- READY
- DISPATCHED (delivery only)
- COLLECTED (collection only)
- SUPPLIED
- CANCELLED

### Batch/expiry gate

Before READY/DISPATCHED/COLLECTED/SUPPLIED:

- batch number required;
- expiry required;
- expiry must be later than the effective supply date.

This is enforced in DB migration 21 and must also be validated server-side for clear user errors.

### Accuracy/dispensing check

Reuse `dispensing_signoff` rather than creating a second signature table.

### Collection

Reuse `collection_signoff`.

After collection:

- fulfilment → COLLECTED/SUPPLIED;
- prescription → COLLECTED where appropriate;
- repeat baseline updates.

### Delivery

Record:

- carrier;
- tracking number;
- dispatch time;
- staff member;
- delivery address snapshot.

At dispatch:

- queue patient SMS from Karsons Pharmacy when SMS integration is configured;
- prescription can remain DISPENSED while fulfilment says DISPATCHED, then complete when business logic considers supply complete.

### Repeat baseline update

Only after `SUPPLIED`:

- `last_supplied_at`;
- final medicine;
- final strength;
- `strength_since` if strength changed;
- last submitted/current weight.

Use final authorised/supplied values, not merely patient-requested values.

### Exit criteria

- GP notification is tied to issued Rx.
- fulfilment is visible and auditable.
- batch/expiry hard gate works.
- delivery and collection diverge cleanly.
- repeat baseline changes only after supply.

---

## Phase 7 — Flu inventory and administration UX

### Move “Receive a new batch”

Current location:

`Settings → Stock → Receive a new batch`

Target:

`Inventory → Receive stock / Add batch`

### Do not duplicate server logic

Move/reuse the existing action/form rather than creating a second batch-receipt implementation.

Recommended file changes:

- move batch receipt action out of `src/app/(staff)/settings/actions.ts` into inventory domain, or extract shared `src/lib/inventory/receipts.ts`;
- add prominent `Receive stock` button/dialog on Inventory page;
- remove AddBatch form from Settings;
- keep `AddProductForm` / product catalogue under Settings/Admin.

### Flu administration

Verify/retain:

- branch-specific available batch list;
- product → batch selection;
- batch number/expiry auto-display;
- reject expired;
- reject recalled;
- reject zero quantity;
- administration creates exactly one stock movement;
- double submission cannot deduct twice.

### Recall enhancement check

Current recall impact reads `consultation.batchId`. New vaccination record is `vaccine_administration.batchId` as well. Ensure recall impact queries the canonical vaccine administration table so all completed vaccinations are included.

### Exit criteria

- pharmacist receives stock entirely from Inventory.
- Settings contains masters, not day-to-day stock operations.
- Flu dose deducts one stock unit exactly once.

---

## Phase 8 — Patient resources admin

### New admin screen

Under Weight Management service configuration add `Resources`.

CRUD/version behaviour:

- create resource;
- assign service;
- optional medicine (Mounjaro/Wegovy/all);
- title/description/url;
- display stage: before submission / after Rx / both;
- acknowledgement required yes/no;
- order;
- deactivate/archive;
- version increment when clinically meaningful content/link changes.

### Patient form

Before signature:

- show applicable active resources;
- external links open safely;
- required acknowledgements block submit.

### Confirmation email

After Rx issue:

- include applicable `AFTER_RX`/`BOTH` links;
- do not embed unnecessary clinical detail into SMS.

### Exit criteria

- client can change a resource without deployment.
- historical acknowledgement proves which title/url/version patient saw.

---

## Phase 9 — Standalone Weight Management branding

### Public-only branding layer

Use `service_public_profile` for patient-facing UI.

Public form should support:

- standalone brand name;
- logo;
- primary/secondary colours;
- support email/phone;
- privacy link;
- terms link;
- F2F referral link.

### Fulfilment identity

Karsons remains visible where the client expects it as fulfiller/dispatcher.

Do not falsify legal/prescriber identity for the sake of white-labelling.

### Scope

Apply branding only to:

- public form entry;
- repeat access/form;
- patient emails where appropriate.

The internal staff platform can remain Karsons-branded unless the client later asks for multi-brand staff UI.

### Exit criteria

- WM patient journey can look like a separate clinic.
- Karsons is still correctly shown as fulfilment entity where required.

---

## Phase 10 — Dashboard / information architecture enhancement

### Today page

Keep global patient search at the top.

Add operational queue cards/counters.

#### Flu

- appointments today;
- forms awaiting administration;
- incomplete vaccination records;
- GP notifications pending/failed;
- low/expiring stock.

#### Weight Management

- NEW awaiting review;
- NEW calls required / failed call attempts;
- REPEAT GREEN awaiting authorisation;
- REPEAT AMBER review required;
- REPEAT RED urgent;
- awaiting payment;
- ready to dispense / batch needed;
- ready for collection;
- delivery pending/dispatched.

Each count should link directly to a filtered working list.

### Navigation

Keep current major modules but make Weight Management work obvious.

Recommended:

Clinical
- Today
- Patients
- Weight Management
- Vaccinations
- Appointments

Operations
- Inventory
- Prescriptions / Fulfilment
- Communications
- Reports

Administration
- Services
- Settings
- Users
- Compliance

Do not expose generic “Repeat care” as if it is the only Weight Management process once NEW is implemented.

### Exit criteria

A pharmacist can answer “what needs me now?” from Today without hunting through Settings or generic record lists.

---

## Phase 11 — Service Designer / rule configurability enhancement

### Form Designer

Extend only where necessary.

Current schema already supports:

- conditional reveals;
- step visibility;
- measurements/derived BMI;
- file upload;
- photo capture;
- signature;
- consents;
- info blocks.

Potential enhancement:

- add a generic `resourceList` form field only if the runtime cannot render DB-backed resources cleanly outside the schema. Prefer a small generic feature over hard-coding “Mounjaro links” into the wizard.

### Rules Builder

Use `ruleset_version.definition`.

Implement safe editing, not raw JSON as the main UI.

Recommended editor controls:

- outcome;
- priority;
- enabled;
- field path from known schema/derived vocabulary;
- operator;
- value/range;
- nested ALL/ANY condition groups;
- internal message;
- patient message;
- advice.

### Publish guard

Before publish:

- run schema validation;
- run simulator cases;
- show affected historical/sample cases if practical;
- require admin/prescriber confirmation for clinical rules.

---

# 5. Exact code-level change map

| Area | Current files | Planned change |
|---|---|---|
| WM forms | `src/lib/services/weight-management.ts` | Replace F2F first-form assumptions; add remote gate, new/transfer branch, evidence, delivery/collection; update consents/copy. |
| Form runtime | `src/types/form-schema.ts`, `src/components/form/wizard.tsx`, controls | Only extend generically if needed for resource rendering; reuse uploads/photo/signature. |
| Public form | `src/app/f/[slug]/*` | Load standalone profile/resources; enforce resource acknowledgement; public branding. |
| Repeat access | `src/app/repeat/[slug]/*`, `src/lib/repeat-care/access.ts` | Keep enrolment gate; redirect non-enrolled to NEW remote path, not normal appointment. |
| RAG | `src/lib/rules/engine.ts` | Keep core; add tests for missing-data safe fallback and severity. |
| GLP1 rules | `src/lib/rules/glp1-ruleset.ts` | Remove in-person wording; ensure latest workflow semantics; leave 3-month exact permission configurable/pending. |
| Repeat history | `src/lib/clinical/*` | Verify prefill/derived values come from last supplied record only. |
| NEW staff review | new/extended staff route | Queue + structured call + decision UI. |
| Repeat staff review | `src/app/(staff)/repeat-care/*` | Tabs/filters by RAG; GREEN authorisation, AMBER contact/review, RED block. |
| Review action | `src/app/(staff)/repeat-care/actions.ts` | Stop automatic payment-link sending; accept prescriber-final medicine/dose/qty/directions; enforce RAG rules. |
| Payments | `src/lib/payments/lifecycle.ts`, staff payments UI/actions | Add MANUAL settlement, confirmedBy, no active link send; preserve idempotence. |
| Patient pay page | `src/app/pay/[token]/*` | Keep dormant for future integration; remove links from active workflow. |
| Rx issue | `src/lib/prescriptions/issue.ts` | Link settlement, use clinician-authorised snapshots, issue only after payment. |
| Rx/fulfilment UI | `src/app/(staff)/prescriptions/*` | Add fulfilment method/status, batch/expiry gate, delivery fields, collection path. |
| GP notification | communications/notifications modules | Allow prescription-linked GP send at issue time. |
| Inventory | `src/app/(staff)/inventory/*` | Add Receive stock. |
| Settings | `src/app/(staff)/settings/*` | Remove operational batch receipt; retain product/master config. |
| Vaccination | `src/lib/vaccination/administration.ts`, vaccination pages | Verify existing batch filtering/deduction; improve selection UX if needed. |
| Resources admin | service/admin module | CRUD/version resource records. |
| Branding | public form/repeat pages + service settings | Load `service_public_profile`. |
| Booking | booking/scheduling queries | Filter out services with `booking_mode = NONE`; Flu OPTIONAL remains bookable/walk-in. |
| Today | `src/app/(staff)/page.tsx` | Add operational queue counters. |
| Docs | README/docs | Remove “GREEN auto-approves” and old WM in-person assumptions. |

---

# 6. Workflow guards to implement as reusable domain functions

Avoid burying critical conditions inside React components.

Recommended domain functions:

### `canApproveNewWeightManagement(submissionId)`
Checks:

- patient linked;
- required evidence/form validation complete;
- remote pathway selected;
- not F2F-exited;
- completed verified `NEW_PATIENT_VERIFICATION` call;
- required resource acknowledgements stored;
- final prescriber fields supplied.

Returns explicit blockers for UI and server action.

### `canAuthoriseRepeat(submissionId)`
Checks:

- active repeat enrolment;
- latest RAG evaluation exists;
- RED → false;
- AMBER → documented review/contact + note;
- GREEN → prescriber authorisation allowed without call;
- final prescriber fields supplied.

### `canConfirmPayment(paymentId)`
Checks:

- pending payment;
- associated request is clinically approved/authorised;
- staff permission.

### `canIssuePrescription(prescriptionId)`
Checks:

- payment PAID;
- prescriber snapshot exists;
- final medicine/dose/quantity/directions valid;
- not already issued/cancelled.

### `canAdvanceFulfilment(prescriptionId, targetStatus)`
Checks:

- Rx issued;
- batch + expiry for ready/supply;
- expiry > supply date;
- dispensing signoff at appropriate point;
- method-specific fields.

These functions should be unit-tested and used by server actions.

---

# 7. Notification/event plan

Use the existing outbox rather than sending directly from random screens.

Recommended template keys:

- `wm.new.submitted.staff`
- `wm.new.info_requested.patient`
- `wm.new.declined.patient`
- `wm.repeat.amber.staff`
- `wm.repeat.red.staff`
- `wm.prescription.issued.patient`
- `wm.prescription.issued.gp`
- `wm.prescription.issued.pharmacy`
- `wm.fulfilment.ready_collection.patient`
- `wm.fulfilment.dispatched.patient_sms`

For current payment phase, do **not** send `payment_request` links.

SMS should remain low-detail.

---

# 8. Audit vocabulary to add

Use stable audit action names:

- `submission.assigned`
- `wm.new.call_attempted`
- `wm.new.call_completed`
- `wm.new.approved`
- `wm.new.deferred`
- `wm.new.declined`
- `wm.new.escalated`
- `wm.repeat.authorised_green`
- `wm.repeat.approved_amber`
- `wm.repeat.rejected`
- `payment.confirmed_manual`
- `prescription.issued`
- `fulfilment.batch_recorded`
- `fulfilment.ready`
- `fulfilment.dispatched`
- `fulfilment.collected`
- `fulfilment.supplied`
- `resource.created`
- `resource.versioned`
- `service.branding.updated`
- `inventory.receipt`

Never audit every keystroke/autosave.

---

# 9. Testing plan

## Unit tests

### NEW route eligibility

- BMI 31, no prior clinic → new-treatment route passes route criterion.
- BMI 28 + qualifying comorbidity → passes route criterion.
- BMI 28 + no qualifying comorbidity → must not silently pass.
- transfer patient BMI 23 + no verified prior evidence → cannot proceed as verified continuation.
- transfer BMI 23 + valid continuation evidence → can proceed to clinical review.

### RAG

- severe AE → RED.
- moderate AE → AMBER.
- stable same dose + all criteria → GREEN.
- GREEN supportive rule + RED safety rule → RED wins.
- missing derived field → rule is skipped and default cannot become GREEN accidentally.
- dose jump >1 → RED.
- 3-month request → configured interim outcome, not invented auto-GREEN.

### Approval gates

- NEW approval without completed call → rejected.
- NEW completed call but identity not verified → rejected.
- GREEN repeat can authorise without call.
- AMBER repeat approval without note/contact → rejected.
- RED repeat approval → rejected.

### Payment

- manual tick false → action rejected.
- first confirmation → payment PAID + one Rx issued.
- duplicate confirmation → no duplicate Rx/number.

### Fulfilment

- READY without batch/expiry → rejected.
- expired pack → rejected.
- COLLECTION cannot DISPATCH.
- DELIVERY cannot COLLECT.

### Flu

- expired/recalled/zero batch → rejected.
- valid administration → one stock movement and -1 stock.
- duplicate submission → no second administration/deduction.

## Integration tests

### NEW WM happy path

Remote → New to treatment → evidence → resources → submit → queue → verified call → approve → pending payment → manual confirm → Rx → GP/pharmacy notify → batch/expiry → delivery/collection → supplied.

### NEW transfer happy path

Remote → transfer → prior treatment evidence → verified call → approve → rest of supply flow.

### F2F exit

F2F choice → external referral; no online WM request proceeds.

### Repeat GREEN

Enrolled patient → smart form → GREEN → prescriber authorises → manual payment → Rx → fulfilment → baseline updated.

### Repeat AMBER

AMBER → contact/review note → approve → normal paid supply.

### Repeat RED

RED → urgent queue → no payment/Rx action.

## Regression tests

- Flu booking still works.
- Flu walk-in still works.
- other service forms still render after form-runtime changes.
- old historical form versions still render unchanged.
- current role permissions still apply.
- PDF generation remains valid.
- reports do not count pending prescriptions as supplied.

---

# 10. Deployment plan

## Development/staging

1. Apply DB scripts 21/22 to staging.
2. Deploy schema-compatible code.
3. Seed/publish NEW WM form v2 and repeat form/rules versions.
4. Configure placeholder/test public profile.
5. Add test resources.
6. Run automated tests.
7. Run full manual workflows with synthetic patient records.

## Production release order

1. Database backup.
2. Apply migrations 21 then 22.
3. Deploy application code that understands the new columns/tables.
4. Publish new form versions.
5. Publish updated repeat ruleset version.
6. Configure standalone brand/resources only when client provides final content.
7. Verify queues/payment/Rx/fulfilment with a controlled test record.
8. Enable public links.

## Rollback strategy

Migrations are additive. If the UI deployment must be rolled back:

- previous code should ignore new tables/columns;
- do not drop new tables immediately;
- revert published service/form pointer to previous version if needed;
- keep audit/contact/payment/fulfilment records already written;
- fix forward rather than deleting clinical history.

---

# 11. Implementation priorities

## P0 — must work before client testing

1. NEW WM remote form + route branching.
2. F2F external referral gate.
3. NEW staff review + mandatory call.
4. Repeat RAG semantics/authorisation.
5. Manual payment confirmation.
6. Correct Rx issue after payment.
7. GP + branch routing.
8. batch/expiry + collection/delivery fulfilment.
9. Flu Receive Stock moved to Inventory.
10. Flu batch selection/deduction verification.

## P1 — strongly recommended in same delivery

1. Weight Management operational dashboard/queues.
2. Resource library + acknowledgement.
3. standalone branding support.
4. notification templates.
5. rules admin/version simulator.
6. service `booking_mode` enforcement everywhere.

## P2 — later integration/polish

1. SmarterPayments webhook/provider.
2. carrier/tracking API.
3. automated SMS/WhatsApp if credentials/provider ready.
4. richer SLA assignment automation.
5. advanced analytics.

---

# 12. Known client items still pending — do not invent

1. Exact transfer/continuation questionnaire wording and acceptable evidence details beyond the route-level requirements already supplied.
2. Exact 3-month repeat-supply eligibility rule.
3. final standalone clinic brand name/logo/colours/support details.
4. final T&Cs/privacy text.
5. final resource URLs/content and which are mandatory by medicine.
6. exact carrier/tracking integration, if any.

Build the configurable slots now; leave clinical content pending where the client has not supplied it.

---

# 13. Definition of complete

The implementation is ready for client review only when:

- Flu stock receipt is operationally in Inventory.
- Flu administration uses an actual valid batch and deducts stock.
- NEW WM has no routine internal appointment dependency.
- F2F choice exits to Karsons F2F programme.
- NEW vs transfer routing works with the supplied BMI/evidence rules.
- NEW approval requires a verified phone call.
- repeat access requires active enrolment.
- RAG reasons are visible and traceable.
- GREEN requires prescriber authorisation but no mandatory phone call.
- AMBER requires documented review/contact.
- RED cannot be paid/issued.
- manual Payment received is required and audited.
- Rx is not issued before payment.
- final prescribed medicine is clinician-authorised, not blindly copied from patient request.
- GP is notified at Rx issue according to latest client chat.
- branch receives the prescription.
- WM batch/expiry is required before supply.
- collection and delivery both work.
- repeat baseline updates only after supply.
- patient resources are configurable and acknowledgement is stored.
- Weight Management can use standalone patient-facing branding.
- changelog is current.
- all new DB changes are represented in both Supabase SQL and Drizzle schema.

