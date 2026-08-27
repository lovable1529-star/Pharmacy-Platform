# Module — Authorisation & Server Actions

## Purpose

Controls who may do what, and where. Ensures no mutation happens without an
authorisation check and an audit entry.

## Files

| File | Role |
|---|---|
| `src/lib/auth/scope.ts` | Pure permission resolution |
| `src/lib/actions.ts` | Server action wrapper enforcing scope + audit |
| `tests/scope.test.ts` | Permission behaviour |
| `tests/actions.test.ts` | Wrapper guarantees |

## The scoping model

A user holds **role assignments**, each scoped to a level of the tenancy tree:

| Assignment | Covers |
|---|---|
| `companyId: null, branchId: null` | The whole organisation |
| `companyId: 'co_1', branchId: null` | Every branch in that company |
| `companyId: 'co_1', branchId: 'br_kirk'` | That branch only |

Assignments also carry `validFrom` and `validTo`. A locum granted access for a
fortnight loses it automatically — nobody has to remember to revoke it.

Permissions from multiple assignments combine, but only where each applies. A
receptionist organisation-wide who is also a pharmacist at Onchan can issue
prescriptions at Onchan and nowhere else. There is a test for exactly that.

## Why permissions are explicit, not hierarchical

`ROLE_PERMISSIONS` lists every permission for every role in full. A hierarchy
would be shorter, but hierarchies invite the assumption that higher roles inherit
everything — which is how a receptionist quietly ends up able to issue a
prescription.

Two deliberate boundaries worth knowing:

- **Pharmacists cannot publish rulesets.** Authoring clinical rules is an
  administrative act with its own audit trail, separate from using them.
- **Only OWNER holds `billing.manage`.** ADMIN does everything else.

`displayRole()` exists for showing a job title in the UI. Never use it for an
authorisation decision — a group-wide title says nothing about a given branch.

## The action wrapper

`CLAUDE.md` requires every mutation to check scope and write an audit event. A
rule relying on memory will eventually be forgotten, and the one time it is
forgotten is an unlogged change to a clinical record.

So the wrapper makes it structural:

```ts
export const updatePatient = action<UpdateInput>('patient.write')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
  .handler(async (input, { actor, tx }) => {
    const before = await tx.patient.findUniqueOrThrow({ where: { id: input.id } });
    const after  = await tx.patient.update({ where: { id: input.id }, data: input.data });

    return {
      result: after,
      audit: {
        action: 'patient.updated',
        entityType: 'Patient',
        entityId: after.id,
        ...diff(before, after),
      },
    };
  });
```

An action cannot run without the permission check, and cannot return without the
audit entry.

## Two guarantees, both tested

**Nothing runs before authorisation.** `assertCan()` executes before the handler
is called — not just before the write. An unauthorised caller triggers no reads
either.

**Audit and mutation share one transaction.** If the audit write fails, the
mutation rolls back. An unlogged change is worse than no change at all.

## Reads

`query()` checks scope but writes no audit event — reads happen constantly and
would drown the log.

**Exception:** opening a patient record writes an explicit `patient.viewed`
event. That one matters for GDPR, and for answering "who looked at this record?"

## Gotchas

- Always pass **both** `companyId` and `branchId` in `scopedTo`. A
  company-scoped assignment cannot match a branch target without the company.
- An action with no `scopedTo` is checked organisation-wide. Correct only for
  genuinely global operations.
- Call `configureActions()` at startup. Tests wire fakes through the same hook.
