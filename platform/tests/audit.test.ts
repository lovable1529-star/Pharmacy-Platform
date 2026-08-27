import { describe, it, expect } from 'vitest';
import {
  canonicalise, computeAuditHash, sealAuditEntry, verifyChain, diff,
  type AuditEntry, type AuditInput,
} from '@/lib/audit';

const BASE: AuditInput = {
  organisationId: 'org-1',
  userId: 'user-1',
  branchId: 'branch-1',
  action: 'consultation.completed',
  entityType: 'consultation',
  entityId: 'c-1',
};

function chain(count: number): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let previousHash: string | null = null;

  for (let i = 0; i < count; i += 1) {
    const entry = sealAuditEntry(
      { ...BASE, entityId: `c-${i}` },
      { id: `a-${i}`, occurredAt: new Date(2026, 7, 27, 9, i), previousHash },
    );
    entries.push(entry);
    previousHash = entry.hash;
  }
  return entries;
}

describe('canonicalise — identical objects must hash identically', () => {
  it('sorts keys so ordering cannot change the hash', () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe(canonicalise({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalise({ x: { b: 1, a: 2 } })).toBe(canonicalise({ x: { a: 2, b: 1 } }));
  });

  it('drops undefined values rather than emitting them', () => {
    expect(canonicalise({ a: 1, b: undefined })).toBe(canonicalise({ a: 1 }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });

  it('serialises dates as ISO strings', () => {
    expect(canonicalise(new Date('2026-08-27T00:00:00.000Z'))).toBe('"2026-08-27T00:00:00.000Z"');
  });
});

describe('computeAuditHash', () => {
  it('is deterministic', () => {
    const context = { id: 'a-1', occurredAt: new Date('2026-08-27'), previousHash: null };
    expect(computeAuditHash({ ...BASE, ...context })).toBe(
      computeAuditHash({ ...BASE, ...context }),
    );
  });

  it('changes when any audited field changes', () => {
    const context = { id: 'a-1', occurredAt: new Date('2026-08-27'), previousHash: null };
    const original = computeAuditHash({ ...BASE, ...context });
    expect(computeAuditHash({ ...BASE, action: 'consultation.amended', ...context }))
      .not.toBe(original);
  });

  it('changes when the previous hash changes — this is what links the chain', () => {
    const a = computeAuditHash({ ...BASE, id: 'a', occurredAt: new Date(0), previousHash: null });
    const b = computeAuditHash({ ...BASE, id: 'a', occurredAt: new Date(0), previousHash: 'xyz' });
    expect(a).not.toBe(b);
  });
});

describe('verifyChain — detecting tampering', () => {
  it('accepts an intact chain', () => {
    const result = verifyChain(chain(10));
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(10);
  });

  it('accepts an empty chain', () => {
    expect(verifyChain([]).valid).toBe(true);
  });

  it('detects an altered entry and names where', () => {
    const entries = chain(5);
    entries[2] = { ...entries[2]!, action: 'consultation.deleted' };

    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toContain('altered');
  });

  it('detects a removed entry', () => {
    const entries = chain(5);
    entries.splice(2, 1);

    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toContain('removed');
  });

  it('detects a reordered chain', () => {
    const entries = chain(5);
    const [a, b] = [entries[1]!, entries[2]!];
    entries[1] = b;
    entries[2] = a;

    expect(verifyChain(entries).valid).toBe(false);
  });

  it('detects an entry appended without relinking', () => {
    const entries = chain(3);
    entries.push(
      sealAuditEntry(BASE, { id: 'rogue', occurredAt: new Date(), previousHash: null }),
    );
    expect(verifyChain(entries).valid).toBe(false);
  });
});

describe('diff — the log records what changed, not everything', () => {
  it('keeps only changed fields', () => {
    const result = diff(
      { name: 'Bridget', phone: '01624 615150', town: 'Onchan' },
      { name: 'Bridget', phone: '01624 878545', town: 'Onchan' },
    );
    expect(result.before).toEqual({ phone: '01624 615150' });
    expect(result.after).toEqual({ phone: '01624 878545' });
  });

  it('records an added field', () => {
    const result = diff({ name: 'Bridget' }, { name: 'Bridget', email: 'b@example.im' });
    expect(result.after).toEqual({ email: 'b@example.im' });
  });

  it('returns nothing when nothing changed', () => {
    const result = diff({ a: 1 }, { a: 1 });
    expect(result.before).toEqual({});
    expect(result.after).toEqual({});
  });
});
