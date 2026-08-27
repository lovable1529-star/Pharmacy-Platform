# Module — Performance & Hosting Cost

## Why this is a module and not an afterthought

Vercel and Supabase both bill on usage. The shape of our queries **is** the shape
of the invoice. Three things run up the bill on an application like this:

| Cost driver | What causes it | What we do |
|---|---|---|
| **Function duration** | Vercel bills GB-hours. Five sequential 60ms queries bill 300ms; the same five in parallel bill ~60ms | `parallel()` helper |
| **Egress** | Supabase bills bandwidth out. `SELECT *` ships columns nobody renders | `SELECT` field sets |
| **Compute tier** | Sized to peak concurrent connections. Every avoidable query pushes toward the next tier | Caching + debounce |

## Caching policy

`CACHE_POLICY` in `src/lib/performance/index.ts`:

| Kind | TTL | Rationale |
|---|---|---|
| `reference` | 1 hour | GP surgeries, branches, products. Changes monthly, read on nearly every page |
| `publishedVersion` | 24 hours | Form and rule versions are immutable once published |
| `aggregate` | 60 seconds | Dashboard counts. A minute stale is invisible |
| `availability` | 30 seconds | Short enough to avoid double-booking races |
| `clinical` | **never** | — |
| `patient` | **never** | — |

**Clinical and patient data are never cached.** A pharmacist must not act on a
stale allergy record. No hosting saving justifies that.

Caching reference data removes the majority of database round-trips in the
application, because it is read on nearly every page and changes almost never.

Tags are scoped per organisation (`reference:org_1`) so invalidating one tenant
cannot evict another's cache.

## Column selection

Never `SELECT *` on a list.

A patient row carries address, alerts, accessibility JSON and timestamps. A
search result renders four fields. On a 200-row list that is roughly 8KB versus
90KB — on an endpoint that runs hundreds of times a day.

Use the field sets in `SELECT`. Add new ones rather than widening existing ones.

## Parallel queries

The single highest-leverage change for Vercel cost:

```ts
const { patients, appointments, alerts } = await parallel({
  patients: db.patient.count({ where: scope }),
  appointments: db.appointment.findMany({ where: today, select: SELECT.appointmentListItem }),
  alerts: db.stockLevel.findMany({ where: lowStock, select: SELECT.stockListItem }),
});
```

Only for genuinely independent work. Anything inside a transaction, or where one
query feeds another, stays sequential.

## The N+1 fix

Fetching 50 consultations then querying each one's patient is 51 round-trips. One
`IN` query plus `indexBy()` is two:

```ts
const consultations = await db.consultation.findMany({ where: scope });
const patients = await db.patient.findMany({
  where: { id: { in: consultations.map((c) => c.patientId) } },
  select: SELECT.patientHeader,
});
const byId = indexBy(patients, (p) => p.id);
```

## Cursor pagination, not offset

`OFFSET 10000` makes Postgres walk and discard ten thousand rows. On an audit log
that grows to millions this degrades badly and burns compute for nothing.

Fetch `limit + 1` rows and pass to `toCursorPage()` — the extra row tells us
whether more exist without a second `COUNT` query.

`safeLimit()` caps client-supplied page sizes. An uncapped limit is a cost
vulnerability, not just a performance one.

## Search debouncing

A pharmacist typing "Kermode" fires seven requests without a debounce. Two-letter
prefixes also match hundreds of rows — frequent *and* expensive, the worst
combination.

`shouldSearch()` waits for three characters, but searches a date of birth
immediately because it is highly selective.

## Estimating the bill before it arrives

`estimateMonthlyUsage()` projects function invocations, GB-hours, egress and row
writes from a workload description.

A realistic Karsons workload — two branches, ~40 consultations a day, 8 staff —
sits comfortably inside entry-tier allowances on both platforms. There is a test
asserting exactly that, so a future change that makes the app dramatically more
expensive will fail CI rather than surface on an invoice.

## Database indexes

Already in `schema.prisma`:

- `patient(organisationId, lastName)` and `patient(organisationId, dateOfBirth)` — search
- `appointment(branchId, startsAt)` — calendar
- `auditEvent(organisationId, occurredAt)` — the largest table
- `message(organisationId, status)` and `message(batchId)` — GP batching

Add `pg_trgm` on `patient(lastName)` for fuzzy search at scale. Below a few
thousand patients the plain index is faster.

## Rules of thumb

- A page issuing more than 4 sequential queries needs `parallel()`
- A list endpoint without a `select` clause is a bug
- Anything read on every page and changed monthly should be cached
- Audit retention purge must run, or the largest table grows without bound
