/**
 * Repeat care review queue.
 *
 * Scope-checked before anything is read: a user without `repeat.review` never
 * reaches the query, and the query itself is filtered to their organisation.
 */

import { redirect } from 'next/navigation';
import { getActorOrNull } from '@/lib/auth/actor';
import { can } from '@/lib/tenancy/scope';
import { getReviewQueue, getUrgentTasks, getQueueSchemas } from '@/lib/queries/reviews';
import { ReviewQueue } from './queue-client';

export const dynamic = 'force-dynamic';

export default async function RepeatCarePage() {
  const actor = await getActorOrNull();
  if (!actor) redirect('/sign-in');

  if (!can(actor, 'repeat_care:edit')) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">
          Reviewing repeat requests needs pharmacist access. Speak to an administrator if you
          think that is wrong.
        </p>
      </div>
    );
  }

  // Independent reads — the urgent list is not a slice of the review queue.
  const [items, urgent] = await Promise.all([
    getReviewQueue(actor.organisationId),
    getUrgentTasks(actor.organisationId),
  ]);

  /*
   * The questionnaires behind the queue, so the drawer can label the answers.
   * One read for every distinct form version — usually one or two — rather than
   * a schema carried on every row.
   */
  const schemas = await getQueueSchemas(
    actor.organisationId,
    items.map((i) => i.formVersionId),
  );

  return <ReviewQueue items={items} urgent={urgent} schemas={schemas} />;
}
