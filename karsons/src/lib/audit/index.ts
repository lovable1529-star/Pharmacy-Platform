/**
 * Audit log.
 *
 * Every mutation in the system writes here. The log is append-only and
 * hash-chained: each entry embeds the hash of the previous entry for the same
 * organisation, so removing or altering a historical entry breaks the chain
 * and is detectable.
 *
 * This is what reconciles the client's requirement that "all fields must be
 * editable post-submission" with a regulator's requirement for an immutable
 * record. Data can be corrected; the history of corrections cannot be erased.
 */

import { createHash } from 'node:crypto';

export interface AuditInput {
  organisationId: string;
  userId?: string | null;
  /** Verb-noun, e.g. `consultation.completed`, `patient.updated`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry extends AuditInput {
  id: string;
  occurredAt: Date;
  previousHash: string | null;
  hash: string;
}

/**
 * Canonical JSON: keys sorted recursively so that two logically identical
 * objects always serialise identically. Without this, a hash could change
 * purely because of key ordering, and verification would produce false alarms.
 */
export function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);

  return `{${entries.join(',')}}`;
}

export function computeAuditHash(
  entry: Omit<AuditEntry, 'hash'>,
): string {
  const payload = canonicalise({
    organisationId: entry.organisationId,
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    occurredAt: entry.occurredAt.toISOString(),
    previousHash: entry.previousHash,
  });

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Builds a sealed audit entry. Persisting it is the caller's job — this
 * function is pure so it can be tested and so the hash calculation is
 * independent of the database.
 */
export function sealAuditEntry(
  input: AuditInput,
  context: { id: string; occurredAt: Date; previousHash: string | null },
): AuditEntry {
  const unsealed = { ...input, ...context };
  return { ...unsealed, hash: computeAuditHash(unsealed) };
}

export interface ChainVerification {
  valid: boolean;
  /** Index of the first entry that fails verification. */
  brokenAt: number | null;
  reason?: string;
}

/**
 * Verifies an ordered chain of audit entries.
 *
 * Run this as a scheduled job and surface the result in the compliance centre.
 * A broken chain means the database has been modified outside the application,
 * which is exactly the thing an auditor wants evidence you can detect.
 */
export function verifyChain(entries: AuditEntry[]): ChainVerification {
  let previousHash: string | null = null;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;

    if (entry.previousHash !== previousHash) {
      return {
        valid: false,
        brokenAt: i,
        reason: 'Chain link does not match the preceding entry — an entry may have been removed.',
      };
    }

    if (computeAuditHash(entry) !== entry.hash) {
      return {
        valid: false,
        brokenAt: i,
        reason: 'Entry content does not match its hash — the record has been altered.',
      };
    }

    previousHash = entry.hash;
  }

  return { valid: true, brokenAt: null };
}

/**
 * Reduces an update to only the fields that actually changed, so the audit log
 * records meaningful diffs rather than whole-object snapshots.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (canonicalise(before[key]) !== canonicalise(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }

  return { before: changedBefore, after: changedAfter };
}
