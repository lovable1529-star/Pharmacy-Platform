'use server';

/**
 * Publishing a change to the clinical rules.
 *
 * Versioned, never mutated, for the same reason forms are: a request evaluated
 * in March as RED because BMI was under 23 must keep saying that after
 * somebody moves the threshold to 25 in June. Every rule_evaluation row points
 * at the ruleset version it ran against, and that row has to stay explicable.
 *
 * So this never updates a definition in place. It reads the published one,
 * applies the edits to a copy, writes a NEW version, and repoints the service
 * at it — the old version stays exactly as it was.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { action } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { rulesetVersion, service } from '@/lib/db/schema';
import { applyEdits, describeChanges, editProblems, hasChanges, type RuleEdit } from '@/lib/rules/edit';
import type { RulesetDefinition } from '@/lib/rules/engine';

export interface PublishRulesInput {
  serviceId: string;
  /**
   * The version the screen was showing.
   *
   * Rejected if it is no longer the published one. Two people tuning
   * thresholds from stale screens would otherwise each publish a version
   * containing only their own change, and the second would silently undo the
   * first.
   */
  baseVersion: number;
  edits: RuleEdit[];
}

const publish = action<PublishRulesInput>('services:edit').handler(
  async (input, { tx, actor }) => {
    const [row] = await tx
      .select({
        serviceId: service.id,
        serviceName: service.name,
        publishedId: service.publishedRulesetVersionId,
        definition: rulesetVersion.definition,
        version: rulesetVersion.version,
      })
      .from(service)
      .leftJoin(rulesetVersion, eq(service.publishedRulesetVersionId, rulesetVersion.id))
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
        isNull(service.archivedAt),
      ))
      .limit(1);

    if (!row) throw new Error('That service no longer exists.');
    if (!row.publishedId || row.version === null) {
      throw new Error('That service has no published ruleset to change.');
    }

    if (row.version !== input.baseVersion) {
      throw new Error(
        `Somebody else published rules v${row.version} while this screen was open. `
        + 'Reload and make the change again — publishing now would undo theirs.',
      );
    }

    const current = row.definition as unknown as RulesetDefinition;

    const problems = editProblems(current, input.edits);
    if (problems.length > 0) throw new Error(problems.join(' '));

    const next = applyEdits(current, input.edits);

    // Publishing an identical version is noise in a history somebody will read
    // to understand why a decision changed.
    if (!hasChanges(current, next)) {
      return {
        result: { version: row.version, changed: false, summary: [] as string[] },
      };
    }

    const summary = describeChanges(current, next);

    /*
     * Numbered from the highest that exists rather than from the published
     * one, so a version created and then rolled back does not have its number
     * reused — two different rulesets sharing a number would make an old
     * evaluation ambiguous.
     */
    const [highest] = await tx
      .select({ version: rulesetVersion.version })
      .from(rulesetVersion)
      .where(eq(rulesetVersion.serviceId, input.serviceId))
      .orderBy(desc(rulesetVersion.version))
      .limit(1);

    const version = (highest?.version ?? 0) + 1;

    const [created] = await tx
      .insert(rulesetVersion)
      .values({
        organisationId: actor.organisationId,
        serviceId: input.serviceId,
        version,
        definition: next as unknown as Record<string, unknown>,
        publishedAt: new Date(),
        publishedBy: actor.userId,
      })
      .returning({ id: rulesetVersion.id });

    await tx
      .update(service)
      .set({ publishedRulesetVersionId: created!.id })
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
        // Only if it still points where we read it from, so a concurrent
        // publish cannot be overwritten between the check above and here.
        eq(service.publishedRulesetVersionId, row.publishedId),
      ));

    return {
      result: { version, changed: true, summary },
      audit: {
        action: 'ruleset.published',
        entityType: 'ruleset_version',
        entityId: created!.id,
        before: { version: row.version },
        after: { version, changes: summary },
      },
    };
  },
);

export async function publishRuleChanges(input: PublishRulesInput) {
  try {
    const result = await publish(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('publishRuleChanges failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'Changing clinical rules needs services access.'
          : error instanceof Error
            ? error.message
            : 'Could not publish those changes.',
    };
  }
}
