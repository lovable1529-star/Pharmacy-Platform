/**
 * Compliance centre.
 *
 * The screen an inspector, or a DPO, will actually want to see: the audit trail
 * with live chain verification, the consent register, subject access requests,
 * and retention policies.
 *
 * This is a **server component** on purpose. `sealAuditEntry` and `verifyChain`
 * use `node:crypto` and are server-only by design — hashing a clinical audit
 * chain in a browser would be both slower and wrong. Both the intact and the
 * tampered verification results are computed here and handed to the client
 * component, so the tampering demonstration is instant without shipping any
 * hashing to the browser.
 */

import { sealAuditEntry, verifyChain, type AuditEntry } from '@/lib/audit';
import { CONSULTATIONS, PATIENTS, branchName, patientName } from '@/lib/demo/data';
import {
  ComplianceTabs,
  type AuditRow,
  type ConsentRow,
  type VerificationResult,
} from '@/components/compliance/compliance-tabs';

/** Builds a hash-chained audit log from the demo activity. */
function buildAuditLog(): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let previousHash: string | null = null;

  const actions = CONSULTATIONS.slice(0, 25).flatMap((c, i) => [
    {
      action: 'patient.viewed',
      entityType: 'Patient',
      entityId: c.patientId,
      before: undefined as unknown,
      after: { branch: branchName(c.branchId) } as unknown,
      at: new Date(c.completedAt.getTime() - 240_000),
    },
    {
      action: 'consultation.completed',
      entityType: 'Consultation',
      entityId: c.id,
      before: undefined as unknown,
      after: { service: c.serviceName, batch: c.batchNumber, funding: c.fundingType } as unknown,
      at: c.completedAt,
    },
    {
      action: 'stock.decremented',
      entityType: 'StockLevel',
      entityId: `stk_${i}`,
      before: { quantity: 85 - i } as unknown,
      after: { quantity: 84 - i } as unknown,
      at: new Date(c.completedAt.getTime() + 1_000),
    },
  ]);

  actions
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .forEach((item, index) => {
      const entry = sealAuditEntry(
        {
          organisationId: 'org_karsons',
          userId: 'usr_1',
          action: item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          before: item.before,
          after: item.after,
          ipAddress: '10.0.0.14',
        },
        { id: `aud_${index}`, occurredAt: item.at, previousHash },
      );
      entries.push(entry);
      previousHash = entry.hash;
    });

  return entries;
}

function toResult(entries: AuditEntry[]): VerificationResult {
  const result = verifyChain(entries);
  return {
    valid: result.valid,
    brokenAt: result.brokenAt,
    ...(result.reason ? { reason: result.reason } : {}),
    entryCount: entries.length,
  };
}

export default function CompliancePage() {
  const chain = buildAuditLog();

  // Simulate someone editing a record directly in the database, so the client
  // can demonstrate detection without recomputing anything in the browser.
  const tamperedChain = chain.map((entry, i) =>
    i === 8 ? { ...entry, after: { quantity: 999 } } : entry,
  );

  const auditRows: AuditRow[] = [...chain]
    .reverse()
    .slice(0, 25)
    .map((entry) => ({
      id: entry.id,
      occurredAt: `${entry.occurredAt.toLocaleDateString('en-GB')} ${entry.occurredAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      hash: entry.hash,
    }));

  const consentRows: ConsentRow[] = CONSULTATIONS.slice(0, 12).map((c) => ({
    patientName: patientName(c.patientId),
    consent: 'Flu vaccination consent',
    version: 'v1',
    recordedAt: c.completedAt.toLocaleDateString('en-GB'),
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl">Compliance</h1>
      <p className="mb-5 text-sm text-ink-soft">
        Evidence for inspections, and the tools to answer a data request.
      </p>

      <ComplianceTabs
        auditRows={auditRows}
        consentRows={consentRows}
        intact={toResult(chain)}
        tamperedResult={toResult(tamperedChain)}
        patientNames={PATIENTS.slice(0, 20).map((p) => ({
          id: p.id,
          name: `${p.firstName} ${p.lastName}`,
        }))}
      />
    </div>
  );
}
