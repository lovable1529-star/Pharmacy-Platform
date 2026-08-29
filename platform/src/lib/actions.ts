/**
 * Server action wrapper.
 *
 * Every mutation must (a) check authorisation against the caller's scope and
 * (b) write an audit event. Both are stated as rules, but a rule that depends
 * on developers remembering it will eventually be forgotten — and the one time
 * it is forgotten is an unlogged change to a clinical record.
 *
 * So this makes it structural. An action declares the permission it needs and
 * returns what should be audited. It cannot run without the check, and it
 * cannot return without the log. The audit write shares the handler's
 * transaction, so if the log fails the mutation rolls back: an unlogged change
 * is worse than no change.
 *
 * Usage:
 *
 *   export const updatePatient = action('patients:edit')
 *     .scopedTo((input: { branchId: string; companyId: string }) => input)
 *     .handler(async (input, { tx, actor }) => {
 *       const [before] = await tx.select()...;
 *       const [after]  = await tx.update(patient)...returning();
 *       return {
 *         result: after,
 *         audit: { action: 'patient.updated', entityType: 'patient',
 *                  entityId: after.id, ...diff(before, after) },
 *       };
 *     });
 */

import { sql, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { auditEvent } from '@/lib/db/schema';
import { getActor } from '@/lib/auth/actor';
import { sealAuditEntry, type AuditInput } from '@/lib/audit';
import {
  assertCan, type Actor, type Permission, type ScopeTarget,
} from '@/lib/tenancy/scope';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Anything you can read through.
 *
 * A query that does not mutate is equally correct on the pool or inside a
 * transaction, and forcing read helpers to take `Tx` meant a page that just
 * wanted to look something up had to open a transaction to do it.
 */
export type Reader = Tx | typeof db;

export interface ActionContext {
  actor: Actor;
  tx: Tx;
  target: ScopeTarget;
}

export interface ActionOutcome<T> {
  result: T;
  /** Omit only for genuinely read-only work. */
  audit?: Omit<AuditInput, 'organisationId' | 'userId' | 'branchId'>;
}

type ScopeResolver<TInput> = (input: TInput) => ScopeTarget;

/**
 * Appends one entry to the organisation's hash chain.
 *
 * The advisory lock serialises appends per organisation for the life of the
 * transaction. Without it, two concurrent writes can read the same previous
 * hash and fork the chain — which then reads as tampering during verification,
 * and is extremely confusing to diagnose after the fact.
 */
async function appendAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${input.organisationId}))`,
  );

  const previous = await tx
    .select({ hash: auditEvent.hash })
    .from(auditEvent)
    .where(eq(auditEvent.organisationId, input.organisationId))
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
    .limit(1);

  const previousHash = previous[0]?.hash ?? null;
  const id = crypto.randomUUID();
  const occurredAt = new Date();

  const sealed = sealAuditEntry(input, { id, occurredAt, previousHash });

  await tx.insert(auditEvent).values({
    id: sealed.id,
    organisationId: sealed.organisationId,
    userId: sealed.userId ?? null,
    branchId: sealed.branchId ?? null,
    action: sealed.action,
    entityType: sealed.entityType,
    entityId: sealed.entityId ?? null,
    before: sealed.before ?? null,
    after: sealed.after ?? null,
    ipAddress: sealed.ipAddress ?? null,
    userAgent: sealed.userAgent ?? null,
    previousHash: sealed.previousHash,
    hash: sealed.hash,
    occurredAt: sealed.occurredAt,
  });
}

class ActionBuilder<TInput> {
  constructor(
    private readonly permission: Permission,
    private readonly scopeResolver: ScopeResolver<TInput> = () => ({}),
  ) {}

  /**
   * Declares where the action takes place. Without this it is checked
   * organisation-wide, which is only correct for genuinely global operations.
   */
  scopedTo<TNarrowed extends TInput>(
    resolver: ScopeResolver<TNarrowed>,
  ): ActionBuilder<TNarrowed> {
    return new ActionBuilder<TNarrowed>(this.permission, resolver);
  }

  handler<TResult>(
    fn: (input: TInput, context: ActionContext) => Promise<ActionOutcome<TResult>>,
  ): (input: TInput) => Promise<TResult> {
    const { permission, scopeResolver } = this;

    return async (input: TInput): Promise<TResult> => {
      const actor = await getActor();
      const target = scopeResolver(input);

      // Authorise first. Nothing is read or written before this line.
      assertCan(actor, permission, target);

      return db.transaction(async (tx) => {
        const outcome = await fn(input, { actor, tx, target });

        if (outcome.audit) {
          await appendAudit(tx, {
            ...outcome.audit,
            organisationId: actor.organisationId,
            userId: actor.userId,
            branchId: target.branchId ?? null,
          });
        }

        return outcome.result;
      });
    };
  }
}

export function action<TInput = void>(permission: Permission): ActionBuilder<TInput> {
  return new ActionBuilder<TInput>(permission);
}

/**
 * Read-only queries. Still scope-checked — a locum must not read records at a
 * branch they do not work at — but no audit entry is written, since reads
 * happen constantly and would drown the log.
 *
 * Opening a PATIENT RECORD is logged separately and deliberately, via an
 * explicit `patient.viewed` action. That one matters for GDPR.
 */
export function query<TInput = void>(permission: Permission) {
  return {
    scopedTo<TNarrowed extends TInput>(resolver: ScopeResolver<TNarrowed>) {
      return {
        handler<TResult>(fn: (input: TNarrowed, context: { actor: Actor }) => Promise<TResult>) {
          return async (input: TNarrowed): Promise<TResult> => {
            const actor = await getActor();
            assertCan(actor, permission, resolver(input));
            return fn(input, { actor });
          };
        },
      };
    },
  };
}
