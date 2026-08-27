# Architecture Overview

## The core idea

Every clinical service in this platform is the same object:

```
patient intake → clinician review → clinical action → notification → audit record
```

Flu vaccination, GLP-1 repeat care and any future service the client invents are
*configurations* of that pipeline, not separate applications. This is the decision
that separates this platform from the failed Zoho attempt.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│  UI            Next.js App Router, React, Tailwind      │
├─────────────────────────────────────────────────────────┤
│  Runtime       form-runtime · rule-builder · pdf        │
│                Renderers driven entirely by config      │
├─────────────────────────────────────────────────────────┤
│  Engines       forms/runtime.ts   rules/engine.ts       │
│                Pure functions. No I/O. Fully testable.  │
├─────────────────────────────────────────────────────────┤
│  Domain        Server Actions — scope → act → audit     │
├─────────────────────────────────────────────────────────┤
│  Data          Prisma · PostgreSQL (Supabase, London)   │
└─────────────────────────────────────────────────────────┘
```

## Why the engines are pure

`forms/runtime.ts` and `rules/engine.ts` contain no database calls, no network
requests and no clock reads. Everything they need arrives as arguments.

Three things follow:

1. **They are exhaustively testable.** The full suite runs in under two seconds.
2. **The rule simulator works.** Any historical submission can be replayed against
   any ruleset version, because evaluation depends only on its inputs.
3. **Decisions are reproducible.** Given a stored submission and a stored ruleset
   version we can reconstruct precisely why a patient got AMBER eighteen months
   ago. That is what an audit requires.

## Configuration, not code

Two JSONB structures carry the entire product:

| Structure | Emitted by | Consumed by | Defined in |
|---|---|---|---|
| Form schema | Service Designer | Form runtime | `src/types/form-schema.ts` |
| Rule tree | Rule builder | Decision engine | `src/types/rule-schema.ts` |

Both are versioned and immutable once published. A submission binds to the schema
version it was completed against, so editing a form next year cannot change what a
patient answered last year.

`src/lib/forms/services/flu-vaccine.ts` is the proof: the entire flu vaccination
service — every question, every conditional branch, the clinician form, the
declarations, the outputs — is one data structure. No flu-specific logic exists
anywhere else in the codebase.

## Tenancy

```
Organisation → Company → Branch → Resource
```

Patients sit at Organisation level so they are found instantly at any branch, and
so cross-branch supply checks are possible. Every other clinical record carries
`organisationId` and is filtered by the caller's scope.

## Audit

Append-only and hash-chained. Each entry embeds the hash of the previous entry for
that organisation. Removing, altering or reordering history breaks the chain and is
detectable by `verifyChain()`.

This is how "all fields editable post-submission" coexists with regulatory
immutability: data can be corrected, the history of corrections cannot be erased.
