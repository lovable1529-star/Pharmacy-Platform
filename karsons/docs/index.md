# Karsons Pharmacy Platform

A multi-company clinical services platform for a pharmacy group on the Isle of Man.
It runs vaccination services, GLP-1 weight management repeat prescribing, and any
other clinical service the client configures himself.

---

## The core idea

Every clinical service is the same object underneath:

> patient intake → clinician review → clinical action → notification → immutable audit record

Flu vaccination, GLP-1 repeat care and any future service are *configurations* of
that one pipeline, not separate builds. This is the decision that separates this
platform from the Zoho attempt that preceded it.

`src/lib/forms/services/flu-vaccine.ts` is the proof: the entire flu service —
every question, every conditional branch, the clinician form, the declarations,
the outputs — is a single data structure. No flu-specific logic exists anywhere
else in the codebase.

---

## Where to start

**Building or maintaining the system?**
Read `CLAUDE.md` first, then Architecture, then the module you are working on.

**Running the pharmacy?**
Start with the guides under *For pharmacy staff*. They are written for pharmacy
teams, not developers.

**Deploying it?**
Go straight to the Deployment runbook.

---

## Documentation map

| Section | For |
|---|---|
| **Architecture** | How the system fits together and why |
| **Modules** | Each subsystem in detail, with its gotchas |
| **Deployment** | Step-by-step setup, hosting and cost |
| **For pharmacy staff** | Day-to-day use, written without jargon |

---

## Non-negotiable rules

These exist for legal and regulatory reasons, not stylistic ones.

1. **Never delete clinical data.** Version it or archive it.
2. **Every mutation writes an audit event.** The log is append-only and hash-chained.
3. **A pharmacist confirms every supply.** There is no autonomous approval path —
   this keeps the product outside medical device regulation.
4. **Patients are organisation-scoped.** Findable at any branch, which is also
   what makes cross-branch safety checks possible.
5. **No real patient data outside production.** Seed data is synthetic; only
   reference data is real.

---

## Current state

**265 tests passing** across twelve suites.

| Layer | Status |
|---|---|
| Database schema, all 12 modules | Complete |
| Decision engine + GLP-1 ruleset | Complete, tested |
| Rule simulator | Complete, tested |
| Form schema, runtime and renderer | Complete, tested |
| Service Designer | Complete |
| Scoped RBAC + action wrapper | Complete, tested |
| Audit log (hash-chained) | Complete, tested |
| Patient search + duplicate detection | Complete, tested |
| Clinical safety checks | Complete, tested |
| Inventory, expiry forecast, recall | Complete, tested |
| Scheduling and walk-in queue | Complete, tested |
| GP batching and delivery monitoring | Complete, tested |
| Prescription PDF | Complete |
| Performance and cost controls | Complete, tested |

---

## Compliance position

Built to UK GDPR standards, which the Isle of Man regime closely mirrors. All
data stays in UK-region infrastructure.

Before real patient data: DPIA, penetration test, WCAG 2.2 AA audit, signed DPAs,
medical device regulatory opinion, clinical hazard log, and a named Clinical
Safety Officer.
