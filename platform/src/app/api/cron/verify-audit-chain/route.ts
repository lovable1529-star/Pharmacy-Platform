/**
 * Nightly audit chain verification.
 *
 * A broken chain means the database was modified outside the application. Being
 * able to detect that — and to say exactly which entry broke — is the thing an
 * auditor actually wants to see.
 */

import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { auditEvent, organisation } from '@/lib/db/schema';
import { verifyChain, type AuditEntry } from '@/lib/audit';
import { isAuthorisedCron } from '@/lib/cron/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const orgs = await db.select({ id: organisation.id, name: organisation.name }).from(organisation);
  const results = [];

  for (const org of orgs) {
    const rows = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.organisationId, org.id))
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
    results.push({ organisation: org.name, ...verification });

    if (!verification.valid) {
      console.error(
        `[audit] Chain broken for ${org.name} at entry ${verification.brokenAt}: ${verification.reason}`,
      );
    }
  }

  const allValid = results.every((r) => r.valid);
  return NextResponse.json({ ok: allValid, results }, { status: allValid ? 200 : 500 });
}
