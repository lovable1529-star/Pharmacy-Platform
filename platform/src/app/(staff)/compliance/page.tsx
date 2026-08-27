/**
 * Compliance centre.
 *
 * The evidence surface for an inspection. It verifies the audit chain live and
 * reports where it breaks — being able to detect tampering, and to say exactly
 * which entry failed, is what an auditor actually wants to see.
 */

import { asc, eq } from 'drizzle-orm';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import { auditEvent } from '@/lib/db/schema';
import { verifyChain, type AuditEntry } from '@/lib/audit';
import { getAuditTrail } from '@/lib/queries/clinical';
import { AuditTable } from './audit-table';

export const dynamic = 'force-dynamic';

export default async function CompliancePage() {
  const { actor } = await getStaffContext();

  if (!can(actor, 'compliance:view')) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">The compliance centre needs audit access.</p>
      </div>
    );
  }

  const rows = await db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.organisationId, actor.organisationId))
    .orderBy(asc(auditEvent.occurredAt), asc(auditEvent.id));

  const entries: AuditEntry[] = rows.map((r) => ({
    id: r.id,
    organisationId: r.organisationId,
    userId: r.userId,
    branchId: r.branchId,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    before: r.before,
    after: r.after,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    occurredAt: r.occurredAt,
    previousHash: r.previousHash,
    hash: r.hash,
  }));

  const verification = verifyChain(entries);
  const trail = await getAuditTrail(actor.organisationId);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight text-ink">Compliance</h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          Every change to a clinical record, in an append-only log that nobody — including an
          owner — can rewrite.
        </p>
      </div>

      <div
        className={
          verification.valid
            ? 'mb-6 flex items-start gap-3.5 rounded-[10px] border border-safe-200 bg-safe-50 px-5 py-4'
            : 'mb-6 flex items-start gap-3.5 rounded-[10px] border border-stop-200 bg-stop-50 px-5 py-4'
        }
      >
        {verification.valid ? (
          <ShieldCheck size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-safe-700" />
        ) : (
          <ShieldAlert size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-stop-700" />
        )}
        <div>
          <p
            className={
              verification.valid
                ? 'text-[15px] font-semibold text-safe-700'
                : 'text-[15px] font-semibold text-stop-700'
            }
          >
            {verification.valid
              ? `Audit chain intact — ${verification.checked} entries verified`
              : `Audit chain broken at entry ${verification.brokenAt}`}
          </p>
          <p
            className={
              verification.valid
                ? 'mt-0.5 text-[13.5px] text-safe-700'
                : 'mt-0.5 text-[13.5px] text-stop-700'
            }
          >
            {verification.valid
              ? 'Each entry carries the hash of the one before it. Any alteration or deletion breaks the chain and shows here.'
              : verification.reason}
          </p>
        </div>
      </div>

      <AuditTable rows={trail} />
    </div>
  );
}
