/**
 * Repeat care review queue.
 *
 * Scope-checked before anything is read: a user without `repeat.review` never
 * reaches the query, and the query itself is filtered to their organisation.
 */

import { redirect } from 'next/navigation';
import { getActorOrNull } from '@/lib/auth/actor';
import { can } from '@/lib/tenancy/scope';
import { getReviewQueue } from '@/lib/queries/reviews';
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

  const items = await getReviewQueue(actor.organisationId);
  return <ReviewQueue items={items} />;
}
