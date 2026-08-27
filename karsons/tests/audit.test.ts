import { describe, expect, it } from 'vitest';
import { canonicalise, diff, sealAuditEntry, verifyChain } from '@/lib/audit';
import type { AuditEntry } from '@/lib/audit';

function buildChain(count: number): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let previousHash: string | null = null;

  for (let i = 0; i < count; i += 1) {
    const entry = sealAuditEntry(
      {
        organisationId: 'org_1',
        userId: 'user_1',
        action: 'patient.updated',
        entityType: 'Patient',
        entityId: `pat_${i}`,
        after: { note: `change ${i}` },
      },
      {
        id: `aud_${i}`,
        occurredAt: new Date(Date.UTC(2026, 7, 27, 9, i)),
        previousHash,
      },
    );
    entries.push(entry);
    previousHash = entry.hash;
  }
  return entries;
}

describe('canonicalise', () => {
  it('produces identical output regardless of key order', () => {
    expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
  });

  it('handles nested structures and arrays', () => {
    expect(canonicalise({ x: [{ b: 1, a: 2 }] })).toBe(canonicalise({ x: [{ a: 2, b: 1 }] }));
  });

  it('ignores undefined values', () => {
    expect(canonicalise({ a: 1, b: undefined })).toBe(canonicalise({ a: 1 }));
  });
});

describe('audit chain', () => {
  it('verifies an intact chain', () => {
    expect(verifyChain(buildChain(5)).valid).toBe(true);
  });

  it('verifies an empty chain', () => {
    expect(verifyChain([]).valid).toBe(true);
  });

  it('detects an altered entry', () => {
    const chain = buildChain(5);
    // Someone edits a clinical note directly in the database.
    chain[2] = { ...chain[2]!, after: { note: 'tampered' } };

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toMatch(/altered/i);
  });

  it('detects a deleted entry', () => {
    const chain = buildChain(5);
    chain.splice(2, 1);

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/removed/i);
  });

  it('detects a reordered chain', () => {
    const chain = buildChain(5);
    [chain[1], chain[3]] = [chain[3]!, chain[1]!];
    expect(verifyChain(chain).valid).toBe(false);
  });

  it('links each entry to its predecessor', () => {
    const chain = buildChain(3);
    expect(chain[0]!.previousHash).toBeNull();
    expect(chain[1]!.previousHash).toBe(chain[0]!.hash);
    expect(chain[2]!.previousHash).toBe(chain[1]!.hash);
  });

  it('gives different hashes to otherwise identical entries at different positions', () => {
    const chain = buildChain(2);
    expect(chain[0]!.hash).not.toBe(chain[1]!.hash);
  });
});

describe('diff', () => {
  it('returns only changed fields', () => {
    const result = diff(
      { name: 'Jane Kelly', phone: '07624 100200', town: 'Onchan' },
      { name: 'Jane Kelly', phone: '07624 999888', town: 'Onchan' },
    );
    expect(result.before).toEqual({ phone: '07624 100200' });
    expect(result.after).toEqual({ phone: '07624 999888' });
  });

  it('captures added and removed fields', () => {
    const result = diff({ a: 1 }, { b: 2 });
    expect(result.before).toEqual({ a: 1, b: undefined });
    expect(result.after).toEqual({ a: undefined, b: 2 });
  });

  it('returns empty when nothing changed', () => {
    const result = diff({ a: 1 }, { a: 1 });
    expect(result.before).toEqual({});
  });
});
