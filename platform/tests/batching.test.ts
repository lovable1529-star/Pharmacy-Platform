import { describe, it, expect } from 'vitest';
import {
  buildGpBatches, buildBatchRef, detectDeliveryProblems, buildDailySummary,
  formatPrescriptionNumber, parsePrescriptionNumber,
  type NotifiableConsultation, type MessageStatusRecord,
} from '@/lib/communications/batching';

function consultation(over: Partial<NotifiableConsultation> = {}): NotifiableConsultation {
  return {
    consultationId: over.consultationId ?? crypto.randomUUID(),
    patientName: 'Bridget Kelly',
    patientDateOfBirth: '1974-03-05',
    gpSurgeryId: 'gp-hailwood',
    gpSurgeryName: 'Hailwood Medical centre',
    gpSurgeryEmail: 'Hailwoodmeds@gov.im',
    serviceName: 'Flu Vaccination',
    productName: 'Cell Based TIV',
    batchNumber: '3051270',
    administeredAt: new Date('2026-09-02T10:20:00Z'),
    branchName: 'Onchan',
    clinicianName: 'Mukunda Measuria',
    clinicianGphc: '2077837',
    siteOfAdministration: 'Left Deltoid',
    fundedBy: 'NHS',
    notifiedAt: null,
    ...over,
  };
}

describe('one email per surgery, not one per patient', () => {
  it('groups every patient of a surgery into a single batch', () => {
    const { batches } = buildGpBatches({
      consultations: [consultation(), consultation(), consultation()],
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.consultations).toHaveLength(3);
  });

  it('produces a separate batch per surgery', () => {
    const { batches } = buildGpBatches({
      consultations: [
        consultation(),
        consultation({ gpSurgeryId: 'gp-peel', gpSurgeryName: 'Peel Group Practice', gpSurgeryEmail: 'peeldoctors@gov.im' }),
      ],
    });
    expect(batches).toHaveLength(2);
  });

  it('orders batches by surgery name so the run is predictable', () => {
    const { batches } = buildGpBatches({
      consultations: [
        consultation({ gpSurgeryId: 'z', gpSurgeryName: 'Snaefell Surgery', gpSurgeryEmail: 'medicine.snaefell@gov.im' }),
        consultation({ gpSurgeryId: 'a', gpSurgeryName: 'Ballasalla Medical centre', gpSurgeryEmail: 'Ballasallamedicalcentre@gov.im' }),
      ],
    });
    expect(batches.map((b) => b.gpSurgeryName)).toEqual([
      'Ballasalla Medical centre', 'Snaefell Surgery',
    ]);
  });

  it('orders patients within a batch by when they were seen', () => {
    const { batches } = buildGpBatches({
      consultations: [
        consultation({ patientName: 'Later', administeredAt: new Date('2026-09-02T15:00:00Z') }),
        consultation({ patientName: 'Earlier', administeredAt: new Date('2026-09-02T09:00:00Z') }),
      ],
    });
    expect(batches[0]?.consultations.map((c) => c.patientName)).toEqual(['Earlier', 'Later']);
  });
});

describe('never double-sending', () => {
  it('excludes consultations already notified', () => {
    const { batches, totalConsultations } = buildGpBatches({
      consultations: [consultation(), consultation({ notifiedAt: new Date() })],
    });
    expect(totalConsultations).toBe(1);
    expect(batches[0]?.consultations).toHaveLength(1);
  });

  it('produces no batches at all when everything is already sent', () => {
    const { batches } = buildGpBatches({
      consultations: [consultation({ notifiedAt: new Date() })],
    });
    expect(batches).toHaveLength(0);
  });

  it('includes them when a resend is explicitly requested', () => {
    const { batches } = buildGpBatches({
      consultations: [consultation({ notifiedAt: new Date() })],
      includeAlreadySent: true,
    });
    expect(batches[0]?.consultations).toHaveLength(1);
  });
});

describe('consultations that cannot be routed', () => {
  it('separates a patient with no GP address rather than dropping them', () => {
    const { batches, unroutable } = buildGpBatches({
      consultations: [consultation(), consultation({ gpSurgeryEmail: '' })],
    });
    expect(batches).toHaveLength(1);
    expect(unroutable).toHaveLength(1);
  });

  it('treats a malformed address as unroutable', () => {
    const { unroutable } = buildGpBatches({
      consultations: [consultation({ gpSurgeryEmail: 'not-an-address' })],
    });
    expect(unroutable).toHaveLength(1);
  });
});

describe('batch references', () => {
  it('is readable, dated and surgery-specific', () => {
    expect(buildBatchRef(new Date('2026-08-27T12:00:00Z'), 'Hailwood Medical centre'))
      .toBe('KP-20260827-HAILWO');
  });

  it('pads a short surgery name so the format never varies', () => {
    expect(buildBatchRef(new Date('2026-08-27T12:00:00Z'), 'Peel')).toBe('KP-20260827-PEELXX');
  });
});

describe('delivery problems — the silent failure that matters most', () => {
  function record(over: Partial<MessageStatusRecord> = {}): MessageStatusRecord {
    return {
      messageId: 'm1',
      gpSurgeryName: 'Hailwood Medical centre',
      recipient: 'Hailwoodmeds@gov.im',
      status: 'delivered',
      sentAt: new Date('2026-09-02T18:00:00Z'),
      patientCount: 3,
      ...over,
    };
  }

  it('raises a stop-level alert on a bounce', () => {
    const alerts = detectDeliveryProblems([record({ status: 'bounced' })]);
    expect(alerts[0]?.severity).toBe('stop');
    expect(alerts[0]?.message).toContain('likely wrong');
  });

  it('raises an alert on an outright failure', () => {
    expect(detectDeliveryProblems([record({ status: 'failed' })])).toHaveLength(1);
  });

  it('warns about mail stuck in the queue — the SPF/DKIM/DMARC symptom', () => {
    const alerts = detectDeliveryProblems(
      [record({ status: 'queued' })],
      new Date('2026-09-02T20:00:00Z'),
    );
    expect(alerts[0]?.severity).toBe('warn');
    expect(alerts[0]?.message).toContain('DMARC');
  });

  it('does not warn about mail queued only briefly', () => {
    const alerts = detectDeliveryProblems(
      [record({ status: 'queued' })],
      new Date('2026-09-02T18:10:00Z'),
    );
    expect(alerts).toHaveLength(0);
  });

  it('stays silent when everything was delivered', () => {
    expect(detectDeliveryProblems([record()])).toHaveLength(0);
  });

  it('puts the alert affecting most patients first', () => {
    const alerts = detectDeliveryProblems([
      record({ status: 'bounced', gpSurgeryName: 'Small', patientCount: 1 }),
      record({ status: 'bounced', gpSurgeryName: 'Large', patientCount: 9 }),
    ]);
    expect(alerts[0]?.gpSurgeryName).toBe('Large');
  });
});

describe('daily summary', () => {
  it('splits NHS from private', () => {
    const summary = buildDailySummary({
      consultations: [
        consultation({ fundedBy: 'NHS' }),
        consultation({ fundedBy: 'NHS' }),
        consultation({ fundedBy: 'Private' }),
      ],
      gpBatchesSent: 1,
      deliveryAlerts: 0,
    });
    expect(summary.total).toBe(3);
    expect(summary.nhs).toBe(2);
    expect(summary.paid).toBe(1);
  });

  it('breaks the day down by branch', () => {
    const summary = buildDailySummary({
      consultations: [
        consultation({ branchName: 'Onchan' }),
        consultation({ branchName: 'Onchan' }),
        consultation({ branchName: 'Kirk Michael' }),
      ],
      gpBatchesSent: 1,
      deliveryAlerts: 0,
    });
    expect(summary.byBranch[0]).toEqual({ branchName: 'Onchan', count: 2 });
  });

  it('carries the delivery alert count so it can be surfaced', () => {
    const summary = buildDailySummary({
      consultations: [consultation()], gpBatchesSent: 1, deliveryAlerts: 2,
    });
    expect(summary.deliveryAlerts).toBe(2);
  });
});

describe('prescription numbering', () => {
  it('is branch-scoped, year-scoped and zero-padded', () => {
    expect(formatPrescriptionNumber('ONC', 2026, 147)).toBe('ONC-2026-000147');
  });

  it('round-trips', () => {
    expect(parsePrescriptionNumber('KMI-2026-000009')).toEqual({
      branchCode: 'KMI', year: 2026, sequence: 9,
    });
  });

  it('rejects anything malformed', () => {
    expect(parsePrescriptionNumber('nonsense')).toBeNull();
  });
});
