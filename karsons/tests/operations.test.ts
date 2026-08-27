import { describe, expect, it } from 'vitest';
import {
  assessRecallImpact,
  calculateUsageRate,
  detectDrift,
  forecastExpiry,
  projectStockLevel,
  selectBatch,
} from '@/lib/inventory/stock';
import {
  buildQueue,
  generateSlots,
  longWaits,
  nextAvailableSlot,
  overlaps,
} from '@/lib/scheduling/slots';
import {
  buildDailySummary,
  buildGpBatches,
  detectDeliveryProblems,
  findSequenceGaps,
  formatPrescriptionNumber,
  parsePrescriptionNumber,
  type NotifiableConsultation,
} from '@/lib/communications/batching';

const NOW = new Date('2026-08-27T10:00:00Z');

// ─────────────────────────────────────────────────────────────
describe('stock ledger', () => {
  const movements = [
    { type: 'RECEIPT' as const, quantity: 120, createdAt: new Date('2026-08-01') },
    { type: 'ADMINISTRATION' as const, quantity: 3, createdAt: new Date('2026-08-20') },
    { type: 'ADMINISTRATION' as const, quantity: 2, createdAt: new Date('2026-08-25') },
    { type: 'WASTAGE' as const, quantity: 1, createdAt: new Date('2026-08-26') },
  ];

  it('projects a level from its movements', () => {
    expect(projectStockLevel(movements)).toBe(114);
  });

  it('treats transfers in and out with the right sign', () => {
    expect(projectStockLevel([
      { type: 'TRANSFER_IN', quantity: 10, createdAt: NOW },
      { type: 'TRANSFER_OUT', quantity: 4, createdAt: NOW },
    ])).toBe(6);
  });

  it('detects drift between the cached level and the ledger', () => {
    const report = detectDrift(120, movements);
    expect(report.hasDrift).toBe(true);
    expect(report.difference).toBe(-6);
  });

  it('reports no drift when they agree', () => {
    expect(detectDrift(114, movements).hasDrift).toBe(false);
  });

  it('calculates a daily usage rate', () => {
    // 5 doses administered in the last 30 days.
    expect(calculateUsageRate(movements, 30, NOW)).toBeCloseTo(5 / 30, 3);
  });

  it('returns zero rather than dividing by zero', () => {
    expect(calculateUsageRate(movements, 0, NOW)).toBe(0);
  });
});

describe('batch selection', () => {
  const batches = [
    { batchId: 'b1', batchNumber: 'AAA', expiryDate: new Date('2027-06-30'), quantity: 50 },
    { batchId: 'b2', batchNumber: 'BBB', expiryDate: new Date('2026-11-30'), quantity: 20 },
    { batchId: 'b3', batchNumber: 'CCC', expiryDate: new Date('2026-09-30'), quantity: 0 },
  ];

  it('chooses the first-expiring batch with stock', () => {
    expect(selectBatch(batches, NOW)?.batchNumber).toBe('BBB');
  });

  it('skips batches with no stock', () => {
    expect(selectBatch(batches, NOW)?.batchId).not.toBe('b3');
  });

  it('skips recalled batches', () => {
    const recalled = batches.map((b) => (b.batchId === 'b2' ? { ...b, recalledAt: NOW } : b));
    expect(selectBatch(recalled, NOW)?.batchNumber).toBe('AAA');
  });

  it('skips expired batches', () => {
    const expired = [{ batchId: 'x', batchNumber: 'OLD', expiryDate: new Date('2026-01-01'), quantity: 99 }];
    expect(selectBatch(expired, NOW)).toBeNull();
  });

  it('returns null when nothing is usable, rather than falling back', () => {
    expect(selectBatch([], NOW)).toBeNull();
  });
});

describe('expiry forecasting', () => {
  it('projects waste from the usage rate', () => {
    const alerts = forecastExpiry([{
      batchId: 'b1', batchNumber: 'AAA',
      expiryDate: new Date('2026-10-06'), // 40 days out
      quantity: 100, productName: 'Cell Based TIV', branchName: 'Onchan',
      dailyUsageRate: 1,
    }], NOW);

    // Now is 10:00 on 27 Aug; expiry is midnight on 6 Oct, so 39 whole days
    // remain, not 40. At 1/day that uses 39, leaving 61 on the shelf.
    expect(alerts[0]?.projectedWaste).toBe(61);
  });

  it('returns null waste when no usage rate is known', () => {
    const alerts = forecastExpiry([{
      batchId: 'b1', batchNumber: 'AAA',
      expiryDate: new Date('2026-10-06'), quantity: 100,
      productName: 'X', branchName: 'Onchan',
    }], NOW);
    expect(alerts[0]?.projectedWaste).toBeNull();
  });

  it('marks batches within 30 days as urgent', () => {
    const alerts = forecastExpiry([{
      batchId: 'b1', batchNumber: 'AAA',
      expiryDate: new Date('2026-09-10'), quantity: 10,
      productName: 'X', branchName: 'Onchan',
    }], NOW);
    expect(alerts[0]?.severity).toBe('URGENT');
  });

  it('orders expired first, then by days remaining', () => {
    const alerts = forecastExpiry([
      { batchId: 'b1', batchNumber: 'SOON', expiryDate: new Date('2026-10-20'), quantity: 5, productName: 'X', branchName: 'B' },
      { batchId: 'b2', batchNumber: 'GONE', expiryDate: new Date('2026-08-01'), quantity: 5, productName: 'X', branchName: 'B' },
      { batchId: 'b3', batchNumber: 'URG', expiryDate: new Date('2026-09-05'), quantity: 5, productName: 'X', branchName: 'B' },
    ], NOW);
    expect(alerts.map((a) => a.batchNumber)).toEqual(['GONE', 'URG', 'SOON']);
  });

  it('ignores batches beyond the horizon', () => {
    const alerts = forecastExpiry([{
      batchId: 'b1', batchNumber: 'FAR', expiryDate: new Date('2028-01-01'),
      quantity: 100, productName: 'X', branchName: 'B',
    }], NOW);
    expect(alerts).toHaveLength(0);
  });
});

describe('recall impact', () => {
  const administrations = [
    { patientId: 'p1', patientName: 'Bridget Kelly', patientEmail: 'b@example.test', administeredAt: new Date('2026-08-20'), branchName: 'Onchan', batchId: 'b1' },
    { patientId: 'p2', patientName: 'Callum Quayle', patientPhone: '07624 100200', administeredAt: new Date('2026-08-22'), branchName: 'Onchan', batchId: 'b1' },
    { patientId: 'p3', patientName: 'Deborah Kermode', administeredAt: new Date('2026-08-25'), branchName: 'Kirk Michael', batchId: 'b1' },
  ];

  it('lists every affected patient, most recent first', () => {
    const impact = assessRecallImpact('AAA', administrations, []);
    expect(impact.totalAdministered).toBe(3);
    expect(impact.affectedPatients[0]?.patientName).toBe('Deborah Kermode');
  });

  it('separates contactable from uncontactable patients', () => {
    const impact = assessRecallImpact('AAA', administrations, []);
    expect(impact.contactable).toBe(2);
    // The third needs a phone call, and that number must be visible.
    expect(impact.uncontactable).toBe(1);
  });

  it('totals remaining stock and excludes empty branches', () => {
    const impact = assessRecallImpact('AAA', administrations, [
      { branchName: 'Onchan', quantity: 40 },
      { branchName: 'Kirk Michael', quantity: 0 },
    ]);
    expect(impact.totalRemaining).toBe(40);
    expect(impact.remainingStock).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
describe('slot generation', () => {
  // 27 August 2026 is a Thursday (day 4).
  const thursday = new Date('2026-08-27T00:00:00Z');
  const availability = [{ dayOfWeek: 4, startTime: '09:00', endTime: '12:00', slotMinutes: 15 }];

  it('generates slots across the window', () => {
    const slots = generateSlots({ date: thursday, availability, bookings: [] });
    expect(slots).toHaveLength(12); // 3 hours / 15 min
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-08-27T09:00:00.000Z');
  });

  it('generates nothing on a day with no availability', () => {
    const friday = new Date('2026-08-28T00:00:00Z');
    expect(generateSlots({ date: friday, availability, bookings: [] })).toHaveLength(0);
  });

  it('excludes slots taken by an active booking', () => {
    const slots = generateSlots({
      date: thursday, availability,
      bookings: [{ startsAt: new Date('2026-08-27T09:00:00Z'), endsAt: new Date('2026-08-27T09:15:00Z'), status: 'BOOKED' }],
    });
    expect(slots).toHaveLength(11);
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-08-27T09:15:00.000Z');
  });

  it('releases a cancelled booking back to the pool', () => {
    const slots = generateSlots({
      date: thursday, availability,
      bookings: [{ startsAt: new Date('2026-08-27T09:00:00Z'), endsAt: new Date('2026-08-27T09:15:00Z'), status: 'CANCELLED' }],
    });
    expect(slots).toHaveLength(12);
  });

  it('releases a no-show slot too', () => {
    const slots = generateSlots({
      date: thursday, availability,
      bookings: [{ startsAt: new Date('2026-08-27T09:00:00Z'), endsAt: new Date('2026-08-27T09:15:00Z'), status: 'NO_SHOW' }],
    });
    expect(slots).toHaveLength(12);
  });

  it('does not offer slots in the past', () => {
    const slots = generateSlots({
      date: thursday, availability, bookings: [],
      notBefore: new Date('2026-08-27T10:30:00Z'),
    });
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-08-27T10:30:00.000Z');
  });

  it('never lets a slot run past the end of its window', () => {
    const slots = generateSlots({
      date: thursday,
      availability: [{ dayOfWeek: 4, startTime: '09:00', endTime: '10:00', slotMinutes: 15 }],
      bookings: [],
      durationMinutes: 30,
    });
    // Starts at 09:00, 09:15, 09:30 — 09:45 would end at 10:15, past the window.
    expect(slots).toHaveLength(3);
    expect(slots.at(-1)?.endsAt.toISOString()).toBe('2026-08-27T10:00:00.000Z');
  });

  it('filters availability by service', () => {
    const slots = generateSlots({
      date: thursday,
      availability: [{ dayOfWeek: 4, startTime: '09:00', endTime: '10:00', slotMinutes: 30, serviceId: 'flu' }],
      bookings: [],
      serviceId: 'glp1',
    });
    expect(slots).toHaveLength(0);
  });

  it('rejects a malformed availability window rather than crashing', () => {
    const slots = generateSlots({
      date: thursday,
      availability: [{ dayOfWeek: 4, startTime: 'not-a-time', endTime: '10:00', slotMinutes: 15 }],
      bookings: [],
    });
    expect(slots).toHaveLength(0);
  });

  it('ignores a window that ends before it starts', () => {
    const slots = generateSlots({
      date: thursday,
      availability: [{ dayOfWeek: 4, startTime: '14:00', endTime: '09:00', slotMinutes: 15 }],
      bookings: [],
    });
    expect(slots).toHaveLength(0);
  });
});

describe('overlaps', () => {
  it('treats touching intervals as not overlapping', () => {
    expect(overlaps(
      { startsAt: new Date('2026-08-27T09:00:00Z'), endsAt: new Date('2026-08-27T09:15:00Z') },
      { startsAt: new Date('2026-08-27T09:15:00Z'), endsAt: new Date('2026-08-27T09:30:00Z') },
    )).toBe(false);
  });

  it('detects a genuine overlap', () => {
    expect(overlaps(
      { startsAt: new Date('2026-08-27T09:00:00Z'), endsAt: new Date('2026-08-27T09:30:00Z') },
      { startsAt: new Date('2026-08-27T09:15:00Z'), endsAt: new Date('2026-08-27T09:45:00Z') },
    )).toBe(true);
  });
});

describe('nextAvailableSlot', () => {
  it('finds the first slot across a range', () => {
    const slot = nextAvailableSlot({
      from: new Date('2026-08-27T00:00:00Z'),
      days: 7,
      availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', slotMinutes: 30 }],
      bookings: [],
    });
    // The next Monday.
    expect(slot?.startsAt.toISOString()).toBe('2026-08-31T09:00:00.000Z');
  });

  it('returns null when nothing is available', () => {
    expect(nextAvailableSlot({
      from: new Date('2026-08-27T00:00:00Z'), days: 3, availability: [], bookings: [],
    })).toBeNull();
  });
});

describe('walk-in queue', () => {
  const entries = [
    { id: '1', patientName: 'A', serviceName: 'Flu', arrivedAt: new Date('2026-08-27T09:30:00Z') },
    { id: '2', patientName: 'B', serviceName: 'Flu', arrivedAt: new Date('2026-08-27T09:45:00Z') },
    { id: '3', patientName: 'C', serviceName: 'Flu', arrivedAt: new Date('2026-08-27T09:55:00Z'), priority: true },
  ];

  it('puts priority entries first, then arrival order', () => {
    const queue = buildQueue(entries, { now: NOW });
    expect(queue.map((q) => q.id)).toEqual(['3', '1', '2']);
  });

  it('reports how long each person has waited', () => {
    const queue = buildQueue(entries, { now: NOW });
    expect(queue.find((q) => q.id === '1')?.waitingMinutes).toBe(30);
  });

  it('estimates shorter waits with more clinicians on', () => {
    const one = buildQueue(entries, { now: NOW, activeClinicians: 1 });
    const two = buildQueue(entries, { now: NOW, activeClinicians: 2 });
    expect(two.at(-1)!.estimatedWaitMinutes).toBeLessThan(one.at(-1)!.estimatedWaitMinutes);
  });

  it('flags people waiting past the threshold', () => {
    // At 10:00 the arrivals have waited 30, 15 and 5 minutes.
    expect(longWaits(buildQueue(entries, { now: NOW }), 20)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
function consultation(overrides: Partial<NotifiableConsultation> = {}): NotifiableConsultation {
  return {
    consultationId: 'c1', patientId: 'p1', patientName: 'Bridget Kelly',
    patientDateOfBirth: new Date('1974-03-05'),
    gpSurgeryId: 'gp1', gpSurgeryName: 'Onchan Health Centre', gpSurgeryEmail: 'onchan.hc@gov.im',
    serviceName: 'Flu Vaccination', clinicianName: 'Sarah Corlett', clinicianGphc: '2061234',
    branchName: 'Onchan', completedAt: new Date('2026-08-27T11:00:00Z'),
    ...overrides,
  };
}

describe('GP batching', () => {
  it('groups consultations into one batch per surgery', () => {
    const result = buildGpBatches({
      consultations: [
        consultation({ consultationId: 'c1' }),
        consultation({ consultationId: 'c2' }),
        consultation({ consultationId: 'c3', gpSurgeryId: 'gp2', gpSurgeryName: 'Ramsey Group Practice', gpSurgeryEmail: 'ramsey.gp@gov.im' }),
      ],
      alreadySentConsultationIds: new Set(),
      batchDate: NOW,
    });

    expect(result.batches).toHaveLength(2);
    expect(result.totalConsultations).toBe(3);
  });

  it('never sends the same consultation twice', () => {
    const result = buildGpBatches({
      consultations: [consultation({ consultationId: 'c1' }), consultation({ consultationId: 'c2' })],
      alreadySentConsultationIds: new Set(['c1']),
      batchDate: NOW,
    });

    expect(result.totalConsultations).toBe(1);
    expect(result.skipped.alreadySent).toEqual(['c1']);
  });

  it('separates patients with no GP address rather than dropping them silently', () => {
    const result = buildGpBatches({
      consultations: [consultation({ consultationId: 'c1', gpSurgeryEmail: '' })],
      alreadySentConsultationIds: new Set(),
      batchDate: NOW,
    });

    expect(result.batches).toHaveLength(0);
    expect(result.skipped.noGpAddress).toHaveLength(1);
  });

  it('rejects a malformed address', () => {
    const result = buildGpBatches({
      consultations: [consultation({ gpSurgeryEmail: 'not-an-address' })],
      alreadySentConsultationIds: new Set(),
      batchDate: NOW,
    });
    expect(result.skipped.noGpAddress).toHaveLength(1);
  });

  it('sorts patients by surname within a batch', () => {
    const result = buildGpBatches({
      consultations: [
        consultation({ consultationId: 'c1', patientName: 'Zoe Quayle' }),
        consultation({ consultationId: 'c2', patientName: 'Adam Corlett' }),
      ],
      alreadySentConsultationIds: new Set(),
      batchDate: NOW,
    });
    expect(result.batches[0]?.consultations.map((c) => c.patientName)).toEqual(['Adam Corlett', 'Zoe Quayle']);
  });

  it('gives each batch a traceable reference', () => {
    const result = buildGpBatches({
      consultations: [consultation()],
      alreadySentConsultationIds: new Set(),
      batchDate: NOW,
    });
    expect(result.batches[0]?.batchRef).toBe('gpbatch-2026-08-27-gp1');
  });
});

describe('delivery monitoring', () => {
  it('raises a high alert on a bounce', () => {
    const alerts = detectDeliveryProblems([
      { messageId: 'm1', recipient: 'wrong.address@gov.im', status: 'BOUNCED' },
    ], { now: NOW });

    expect(alerts[0]?.severity).toBe('HIGH');
    expect(alerts[0]?.message).toMatch(/address is likely wrong/i);
  });

  it('flags messages stuck in the queue', () => {
    const alerts = detectDeliveryProblems([
      { messageId: 'm1', recipient: 'a@gov.im', status: 'QUEUED', sentAt: new Date('2026-08-27T08:00:00Z') },
    ], { now: NOW, stuckAfterMinutes: 60 });

    expect(alerts.some((a) => a.code === 'DELIVERY_STUCK')).toBe(true);
  });

  it('stays quiet when everything delivered', () => {
    expect(detectDeliveryProblems([
      { messageId: 'm1', recipient: 'a@gov.im', status: 'DELIVERED' },
    ], { now: NOW })).toHaveLength(0);
  });
});

describe('daily summary', () => {
  it('breaks totals down by branch and service', () => {
    const summary = buildDailySummary({
      date: NOW,
      consultations: [
        { branchName: 'Onchan', serviceName: 'Flu Vaccination', fundingType: 'NHS' },
        { branchName: 'Onchan', serviceName: 'Flu Vaccination', fundingType: 'PAID' },
        { branchName: 'Kirk Michael', serviceName: 'Flu Vaccination', fundingType: 'NHS' },
      ],
      gpNotificationsSent: 2,
      outstandingReviews: 1,
    });

    expect(summary.totals).toEqual({ consultations: 3, nhs: 2, paid: 1 });
    expect(summary.byBranch[0]?.branchName).toBe('Kirk Michael');
    expect(summary.byBranch.find((b) => b.branchName === 'Onchan')?.total).toBe(2);
  });

  it('treats missing funding as private rather than losing it', () => {
    const summary = buildDailySummary({
      date: NOW,
      consultations: [{ branchName: 'Onchan', serviceName: 'Flu' }],
      gpNotificationsSent: 0, outstandingReviews: 0,
    });
    expect(summary.totals.paid).toBe(1);
  });
});

describe('prescription numbering', () => {
  it('formats a padded, human-readable number', () => {
    expect(formatPrescriptionNumber('KP', 2026, 412)).toBe('KP-2026-000412');
  });

  it('round-trips', () => {
    expect(parsePrescriptionNumber('KP-2026-000412')).toEqual({ prefix: 'KP', year: 2026, sequence: 412 });
  });

  it('rejects a malformed number', () => {
    expect(parsePrescriptionNumber('KP-26-412')).toBeNull();
  });

  it('finds gaps in the issued sequence', () => {
    // A missing number is a question an inspector will ask.
    expect(findSequenceGaps([
      'KP-2026-000001', 'KP-2026-000002', 'KP-2026-000005',
    ])).toEqual([3, 4]);
  });

  it('reports no gaps in a contiguous sequence', () => {
    expect(findSequenceGaps(['KP-2026-000001', 'KP-2026-000002'])).toEqual([]);
  });
});
