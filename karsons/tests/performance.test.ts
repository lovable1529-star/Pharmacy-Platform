import { describe, expect, it, vi } from 'vitest';
import {
  cacheOptions,
  estimateMonthlyUsage,
  groupBy,
  indexBy,
  orgTag,
  parallel,
  safeLimit,
  shouldSearch,
  toCursorPage,
} from '@/lib/performance';

describe('cache policy', () => {
  it('never caches clinical or patient data', () => {
    expect(cacheOptions('clinical')).toEqual({ cache: 'no-store' });
    expect(cacheOptions('patient')).toEqual({ cache: 'no-store' });
  });

  it('caches reference data for an hour', () => {
    expect(cacheOptions('reference')).toMatchObject({ next: { revalidate: 3600 } });
  });

  it('caches published versions for a day — they are immutable', () => {
    expect(cacheOptions('publishedVersion')).toMatchObject({ next: { revalidate: 86_400 } });
  });

  it('scopes tags per organisation so one tenant cannot evict another', () => {
    expect(orgTag('reference', 'org_1')).toBe('reference:org_1');
    expect(orgTag('reference', 'org_2')).not.toBe(orgTag('reference', 'org_1'));
  });
});

describe('parallel', () => {
  it('returns results keyed by name', async () => {
    const result = await parallel({
      patients: Promise.resolve(3),
      appointments: Promise.resolve(['a']),
    });
    expect(result).toEqual({ patients: 3, appointments: ['a'] });
  });

  it('runs queries concurrently, not sequentially', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(() => r(ms), ms));
    const start = Date.now();

    await parallel({ a: delay(50), b: delay(50), c: delay(50) });

    // Sequential would be ~150ms. Allow generous headroom for slow CI.
    expect(Date.now() - start).toBeLessThan(120);
  });
});

describe('grouping helpers', () => {
  const rows = [
    { id: '1', patientId: 'p1' },
    { id: '2', patientId: 'p1' },
    { id: '3', patientId: 'p2' },
  ];

  it('groups rows by key — the N+1 fix', () => {
    const grouped = groupBy(rows, (r) => r.patientId);
    expect(grouped.get('p1')).toHaveLength(2);
    expect(grouped.get('p2')).toHaveLength(1);
  });

  it('indexes rows by unique key', () => {
    expect(indexBy(rows, (r) => r.id).get('2')).toEqual({ id: '2', patientId: 'p1' });
  });

  it('returns an empty map for no rows', () => {
    expect(groupBy([], (r: { id: string }) => r.id).size).toBe(0);
  });
});

describe('cursor pagination', () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: `r${i}` }));

  it('trims the sentinel row and reports more available', () => {
    const page = toCursorPage(rows, 25);
    expect(page.items).toHaveLength(25);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('r24');
  });

  it('reports the end of the list', () => {
    const page = toCursorPage(rows.slice(0, 10), 25);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result', () => {
    expect(toCursorPage([], 25)).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});

describe('safeLimit', () => {
  it('caps an oversized request — an uncapped limit is a cost vulnerability', () => {
    expect(safeLimit(100000)).toBe(100);
  });

  it('falls back on nonsense input', () => {
    expect(safeLimit('abc')).toBe(25);
    expect(safeLimit(-5)).toBe(25);
    expect(safeLimit(undefined)).toBe(25);
  });

  it('honours a valid request', () => {
    expect(safeLimit(10)).toBe(10);
  });
});

describe('shouldSearch', () => {
  it('waits for three characters', () => {
    expect(shouldSearch('Ke')).toBe(false);
    expect(shouldSearch('Ker')).toBe(true);
  });

  it('searches a date of birth immediately — it is highly selective', () => {
    expect(shouldSearch('05/03')).toBe(true);
  });

  it('ignores whitespace', () => {
    expect(shouldSearch('   ')).toBe(false);
  });
});

describe('cost estimation', () => {
  it('keeps a realistic Karsons workload on entry tiers', () => {
    // Two branches, ~40 consultations a day across both, 8 staff.
    const estimate = estimateMonthlyUsage({
      consultationsPerDay: 40,
      branches: 2,
      staffUsers: 8,
      patientFormLoads: 60,
    });

    expect(estimate.functionGbHours).toBeLessThan(100);
    expect(estimate.egressGb).toBeLessThan(250);
    expect(estimate.notes[0]).toMatch(/within entry-tier/i);
  });

  it('warns when write volume would outgrow the tier', () => {
    const estimate = estimateMonthlyUsage({
      consultationsPerDay: 8000,
      branches: 40,
      staffUsers: 300,
      patientFormLoads: 20000,
    });
    expect(estimate.notes.join(' ')).toMatch(/high/i);
  });

  it('scales function time with consultation volume', () => {
    const small = estimateMonthlyUsage({ consultationsPerDay: 10, branches: 1, staffUsers: 3, patientFormLoads: 10 });
    const large = estimateMonthlyUsage({ consultationsPerDay: 200, branches: 6, staffUsers: 30, patientFormLoads: 300 });
    expect(large.functionGbHours).toBeGreaterThan(small.functionGbHours);
  });
});
