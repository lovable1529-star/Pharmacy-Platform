/**
 * Server action wrapper.
 *
 * Every mutation in this system must (a) check authorisation against the
 * caller's scope and (b) write an audit event. `CLAUDE.md` states both as
 * rules, but a rule that relies on developers remembering it will eventually be
 * forgotten — and the one time it is forgotten is an unlogged change to a
 * clinical record.
 *
 * So this wrapper makes it structural. An action declares the permission it
 * needs and returns what should be audited. It cannot run without the check,
 * and it cannot return without the log.
 *
 * Usage:
 *
 *   export const updatePatient = action('patient.write')
 *     .scopedTo((input: { branchId: string }) => ({ branchId: input.branchId }))
 *     .handler(async (input, { actor, tx }) => {
 *       const before = await tx.patient.findUniqueOrThrow(...);
 *       const after  = await tx.patient.update(...);
 *       return {
 *         result: after,
 *         audit: { action: 'patient.updated', entityType: 'Patient',
 *                  entityId: after.id, ...diff(before, after) },
 *       };
 *     });
 */

import {
  assertCan,
  type Actor,
  type Permission,
  type ScopeTarget,
} from '@/lib/auth/scope';
import { sealAuditEntry, type AuditInput } from '@/lib/audit';

/** What an action returns: its result, plus what to record. */
export interface ActionOutcome<T> {
  result: T;
  /** Omit only for genuinely read-only actions. */
  audit?: Omit<AuditInput, 'organisationId' | 'userId' | 'ipAddress' | 'userAgent'>;
}

export interface ActionContext {
  actor: Actor;
  /** Transaction client. All work in an action shares one transaction. */
  tx: unknown;
  request: { ipAddress?: string | null; userAgent?: string | null };
}

export interface ActionDependencies {
  /** Resolves the signed-in user and their role assignments. */
  getActor: () => Promise<Actor>;
  /** Runs the handler and the audit write in a single transaction. */
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  /** Persists a sealed audit entry and returns the previous hash in the chain. */
  appendAudit: (
    tx: unknown,
    organisationId: string,
    build: (previousHash: string | null, id: string, occurredAt: Date) => unknown,
  ) => Promise<void>;
  getRequestMeta: () => { ipAddress?: string | null; userAgent?: string | null };
}

let dependencies: ActionDependencies | null = null;

/** Wired once at application startup, and replaced with fakes in tests. */
export function configureActions(deps: ActionDependencies): void {
  dependencies = deps;
}

function requireDependencies(): ActionDependencies {
  if (!dependencies) {
    throw new Error('configureActions() must be called before any action runs.');
  }
  return dependencies;
}

type ScopeResolver<TInput> = (input: TInput) => ScopeTarget;

class ActionBuilder<TInput> {
  constructor(
    private readonly permission: Permission,
    private readonly scopeResolver: ScopeResolver<TInput> = () => ({}),
  ) {}

  /**
   * Declares where the action takes place. Without this an action is checked
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
      const deps = requireDependencies();
      const actor = await deps.getActor();
      const target = scopeResolver(input);

      // Authorise first. Nothing is read or written before this line.
      assertCan(actor, permission, target);

      const request = deps.getRequestMeta();

      return deps.transaction(async (tx) => {
        const outcome = await fn(input, { actor, tx, request });

        if (outcome.audit) {
          const auditInput: AuditInput = {
            ...outcome.audit,
            organisationId: actor.organisationId,
            userId: actor.userId,
            ipAddress: request.ipAddress ?? null,
            userAgent: request.userAgent ?? null,
          };

          // The audit write shares the handler's transaction. If the audit
          // fails, the mutation rolls back — an unlogged change is worse than
          // no change at all.
          await deps.appendAudit(tx, actor.organisationId, (previousHash, id, occurredAt) =>
            sealAuditEntry(auditInput, { id, occurredAt, previousHash }),
          );
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
 * branch they do not work at — but no audit event is written, since reads
 * happen constantly and would drown the log.
 *
 * Note: access to a *patient record* is logged separately and deliberately, via
 * an explicit `patient.viewed` event. That one matters for GDPR.
 */
export function query<TInput = void>(permission: Permission) {
  return {
    scopedTo<TNarrowed extends TInput>(resolver: ScopeResolver<TNarrowed>) {
      return {
        handler<TResult>(
          fn: (input: TNarrowed, context: Omit<ActionContext, 'tx'> & { tx: unknown }) => Promise<TResult>,
        ) {
          return async (input: TNarrowed): Promise<TResult> => {
            const deps = requireDependencies();
            const actor = await deps.getActor();

            assertCan(actor, permission, resolver(input));

            return deps.transaction((tx) =>
              fn(input, { actor, tx, request: deps.getRequestMeta() }),
            );
          };
        },
      };
    },
  };
}
