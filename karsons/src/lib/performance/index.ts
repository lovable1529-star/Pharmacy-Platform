/**
 * Performance and cost control.
 *
 * Vercel and Supabase both bill on usage, so the shape of our queries is
 * effectively the shape of the invoice. The three things that actually run up a
 * bill on this kind of application:
 *
 *   1. **Serverless function duration.** Vercel bills GB-hours. A route that
 *      waits 400ms on five sequential queries costs five times a route that
 *      issues them in parallel — for identical output.
 *
 *   2. **Egress.** Supabase bills bandwidth out. `SELECT *` on a patient list
 *      ships columns nobody renders. Selecting only displayed fields typically
 *      cuts list-endpoint egress by 80–90%.
 *
 *   3. **Compute hours.** Supabase's compute tier is sized to peak concurrent
 *      connections. Every avoidable query is pressure toward the next tier up.
 *
 * The helpers here exist so the cheap path is also the convenient one.
 */

// ─────────────────────────────────────────────────────────────
// Cache policy
// ─────────────────────────────────────────────────────────────

/**
 * How long different kinds of data may be served stale.
 *
 * Reference data changes monthly and is read on nearly every page — caching it
 * removes the majority of database round-trips in the application.
 *
 * Clinical data is never cached. A pharmacist must not act on a stale allergy
 * record, and no hosting saving justifies that risk.
 */
export const CACHE_POLICY = {
  /** GP surgeries, branches, products, services. Changes rarely. */
  reference: { seconds: 3600, tag: 'reference' },
  /** Form and rule definitions. Immutable once published. */
  publishedVersion: { seconds: 86_400, tag: 'published' },
  /** Dashboard counts. A minute of staleness is invisible to a user. */
  aggregate: { seconds: 60, tag: 'aggregate' },
  /** Availability. Short enough to avoid double-booking races. */
  availability: { seconds: 30, tag: 'availability' },
  /** Never cached. */
  clinical: null,
  patient: null,
} as const;

export type CacheKind = keyof typeof CACHE_POLICY;

export function cacheOptions(kind: CacheKind, extraTags: string[] = []) {
  const policy = CACHE_POLICY[kind];
  if (policy === null) return { cache: 'no-store' as const };

  return {
    next: { revalidate: policy.seconds, tags: [policy.tag, ...extraTags] },
  };
}

/**
 * Cache tags are scoped per organisation so invalidating one tenant's reference
 * data does not evict everyone else's.
 */
export function orgTag(kind: CacheKind, organisationId: string): string {
  const policy = CACHE_POLICY[kind];
  return `${policy?.tag ?? kind}:${organisationId}`;
}

// ─────────────────────────────────────────────────────────────
// Column selection
// ─────────────────────────────────────────────────────────────

/**
 * Field sets for common reads.
 *
 * Never `SELECT *` on a list. A patient row carries address, alerts,
 * accessibility JSON and timestamps; a search result renders four fields. On a
 * 200-row list that is the difference between ~8KB and ~90KB of egress, on an
 * endpoint that runs hundreds of times a day.
 */
export const SELECT = {
  patientListItem: {
    id: true,
    firstName: true,
    lastName: true,
    dateOfBirth: true,
    postcode: true,
  },
  patientHeader: {
    id: true,
    firstName: true,
    lastName: true,
    dateOfBirth: true,
    phone: true,
    email: true,
    alerts: true,
  },
  appointmentListItem: {
    id: true,
    startsAt: true,
    endsAt: true,
    status: true,
    patient: { select: { id: true, firstName: true, lastName: true } },
    service: { select: { id: true, name: true } },
  },
  stockListItem: {
    id: true,
    quantity: true,
    batch: { select: { id: true, batchNumber: true, expiryDate: true, recalledAt: true } },
    product: { select: { id: true, name: true } },
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Query batching
// ─────────────────────────────────────────────────────────────

/**
 * Runs independent queries concurrently.
 *
 * The single highest-leverage change for Vercel cost. A dashboard issuing six
 * sequential 60ms queries bills for 360ms of function time; the same six in
 * parallel bill for roughly 60ms. Output is identical.
 *
 * Only for genuinely independent work — anything inside a transaction, or where
 * one query feeds another, stays sequential.
 */
export async function parallel<T extends Record<string, Promise<unknown>>>(
  queries: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(queries) as (keyof T)[];
  const results = await Promise.all(keys.map((k) => queries[k]));

  return Object.fromEntries(keys.map((k, i) => [k, results[i]])) as {
    [K in keyof T]: Awaited<T[K]>;
  };
}

/**
 * Groups rows by a foreign key, so a set of children can be fetched in one query
 * and distributed in memory.
 *
 * This is the fix for the N+1 pattern — fetching 50 consultations then querying
 * each one's patient is 51 round-trips. One `IN` query plus this helper is two.
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function indexBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T> {
  return new Map(items.map((item) => [keyOf(item), item]));
}

// ─────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Cursor pagination rather than offset.
 *
 * `OFFSET 10000` makes Postgres walk and discard ten thousand rows. On an audit
 * log that grows to millions, offset paging degrades badly and burns compute for
 * nothing. A cursor is an indexed seek regardless of depth.
 *
 * Fetch `limit + 1` rows; the extra one tells us whether more exist without a
 * second count query.
 */
export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    hasMore,
  };
}

/** Caps a client-supplied page size. An uncapped limit is a cost vulnerability. */
export function safeLimit(requested: unknown, fallback = 25, max = 100): number {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// ─────────────────────────────────────────────────────────────
// Debounced search
// ─────────────────────────────────────────────────────────────

/**
 * Minimum query length before a search hits the database.
 *
 * A pharmacist typing "Kermode" fires seven requests without this. Two-character
 * prefixes also match hundreds of rows, so the query is both frequent and
 * expensive — the worst combination.
 */
export const SEARCH_MIN_LENGTH = 3;
export const SEARCH_DEBOUNCE_MS = 250;

export function shouldSearch(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length >= SEARCH_MIN_LENGTH) return true;
  // A date of birth is worth searching immediately — it is highly selective.
  return /\d{2}[/\-.]\d{2}/.test(trimmed);
}

// ─────────────────────────────────────────────────────────────
// Cost estimation
// ─────────────────────────────────────────────────────────────

export interface UsageProfile {
  consultationsPerDay: number;
  branches: number;
  staffUsers: number;
  /** Patient-facing form loads per day. */
  patientFormLoads: number;
}

export interface CostEstimate {
  /** Serverless invocations per month. */
  functionInvocations: number;
  /** Approximate GB-hours of function time per month. */
  functionGbHours: number;
  /** Approximate egress in GB per month. */
  egressGb: number;
  /** Rows added to the database per month. */
  rowsWritten: number;
  notes: string[];
}

/**
 * Rough monthly usage from a workload description.
 *
 * The purpose is not billing accuracy — it is to answer "does this stay on the
 * cheap tiers?" before we find out from an invoice. Constants below are
 * conservative measured averages from this codebase's query shapes.
 */
export function estimateMonthlyUsage(profile: UsageProfile): CostEstimate {
  const workingDays = 26;

  // Each consultation: form load, submit, clinician screens, PDF, email.
  const perConsultation = 12;
  // Staff background activity: dashboards, searches, navigation.
  const perStaffDay = 120;

  const functionInvocations = Math.round(
    (profile.consultationsPerDay * perConsultation +
      profile.staffUsers * perStaffDay +
      profile.patientFormLoads * 4) * workingDays,
  );

  // Cached reference data means most invocations are short.
  const averageDurationSeconds = 0.15;
  const memoryGb = 1;
  const functionGbHours = (functionInvocations * averageDurationSeconds * memoryGb) / 3600;

  // Trimmed column selection keeps average payloads small.
  const averagePayloadKb = 12;
  const pdfMb = 0.2;
  const egressGb =
    (functionInvocations * averagePayloadKb) / 1_048_576 +
    (profile.consultationsPerDay * workingDays * pdfMb) / 1024;

  // Consultation, submission, actions, audit entries, messages, movements.
  const rowsPerConsultation = 14;
  const rowsWritten = profile.consultationsPerDay * workingDays * rowsPerConsultation;

  const notes: string[] = [];
  if (functionGbHours > 100) {
    notes.push('Approaching the Vercel Pro included allowance — review the slowest routes.');
  }
  if (egressGb > 250) {
    notes.push('Egress is high. Check for list endpoints selecting unused columns.');
  }
  if (rowsWritten > 2_000_000) {
    notes.push('Write volume is high. Confirm the audit retention purge is running.');
  }
  if (notes.length === 0) {
    notes.push('Comfortably within entry-tier allowances on both platforms.');
  }

  return {
    functionInvocations,
    functionGbHours: Math.round(functionGbHours * 10) / 10,
    egressGb: Math.round(egressGb * 10) / 10,
    rowsWritten,
    notes,
  };
}
