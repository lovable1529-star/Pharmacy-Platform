/**
 * Audit log — append-only and hash-chained.
 *
 * Each entry embeds the hash of the previous entry for the same organisation,
 * so removing or altering a historical entry breaks the chain and is
 * detectable. That is what reconciles the client's requirement that "all fields
 * must be editable post-submission" with a regulator's requirement for an
 * immutable record: data can be corrected, the history of corrections cannot be
 * erased.
 *
 * The hashing here is pure so it can be tested without a database, and so the
 * verification job and the write path provably agree.
 */

import { createHash } from 'node:crypto';

export interface AuditInput {
  organisationId: string;
  userId?: string | null;
  /** Which branch the action was performed at. Required for GDPR access logs. */
  branchId?: string | null;
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
 * Canonical JSON: keys sorted recursively, so two logically identical objects
 * always serialise identically. Without this a hash could change purely because
 * of key ordering and verification would raise false alarms.
 */
export function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);

  return `{${entries.join(',')}}`;
}

export function computeAuditHash(entry: Omit<AuditEntry, 'hash'>): string {
  const payload = canonicalise({
    organisationId: entry.organisationId,
    userId: entry.userId ?? null,
    branchId: entry.branchId ?? null,
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
 * Seals an entry. Persisting it is the caller's job — keeping this pure means
 * the hash calculation is independent of the database and can be verified
 * offline by an auditor.
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
  checked: number;
}

/**
 * Verifies an ordered chain.
 *
 * Run nightly and surface the result in the compliance centre. A broken chain
 * means the database was modified outside the application — which is exactly
 * the thing an auditor wants evidence that you can detect.
 */
export function verifyChain(entries: AuditEntry[]): ChainVerification {
  let previousHash: string | null = null;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;

    if (entry.previousHash !== previousHash) {
      return {
        valid: false,
        brokenAt: i,
        checked: entries.length,
        reason: 'Chain link does not match the preceding entry — an entry may have been removed.',
      };
    }

    if (computeAuditHash(entry) !== entry.hash) {
      return {
        valid: false,
        brokenAt: i,
        checked: entries.length,
        reason: 'Entry content does not match its hash — the record has been altered.',
      };
    }

    previousHash = entry.hash;
  }

  return { valid: true, brokenAt: null, checked: entries.length };
}

/**
 * Reduces an update to only the fields that actually changed, so the log holds
 * meaningful diffs rather than whole-object snapshots.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonicalise(before[key]) !== canonicalise(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }

  return { before: changedBefore, after: changedAfter };
}
