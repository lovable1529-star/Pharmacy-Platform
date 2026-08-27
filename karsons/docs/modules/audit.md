# Module — Audit Log

## Purpose

Records every mutation in a tamper-evident, append-only log.

## Why hash-chaining

The client's brief requires that *"all fields must be editable post-submission."*
A regulator requires an immutable record. Both are satisfiable:

- Data can be corrected — a new version is written
- The history of corrections cannot be erased — the chain would break

Each entry embeds the SHA-256 hash of the previous entry for that organisation.
Altering, removing or reordering any historical entry invalidates every hash after
it, and `verifyChain()` reports exactly where.

## Usage

Every Server Action follows the same shape:

```ts
const scope = await requireScope();          // authorise
const before = await getCurrent();
const after  = await performUpdate();
await writeAudit({                            // record
  organisationId: scope.organisationId,
  userId: scope.userId,
  action: 'patient.updated',
  entityType: 'Patient',
  entityId: patient.id,
  ...diff(before, after),
});
```

Use `diff()` so the log stores what changed rather than whole-object snapshots.

## Canonical serialisation

`canonicalise()` sorts object keys recursively before hashing. Without it, two
logically identical objects could hash differently purely because of key ordering,
producing false tamper alerts.

## Verification as a scheduled job

Run `verifyChain()` nightly and surface the result in the compliance centre. Being
able to demonstrate that you *detect* tampering is itself the evidence an auditor
wants.

## Rules

- Never delete an audit entry. There is no valid reason.
- Never backdate `occurredAt` — it is part of the hash.
- Audit writes belong in the same transaction as the mutation they describe.
