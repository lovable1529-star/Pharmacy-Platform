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

