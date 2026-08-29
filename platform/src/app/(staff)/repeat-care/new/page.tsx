/**
 * Internal repeat request — §6.5.
 *
 * A pharmacist starts one for a patient standing in front of them. It creates
 * the same submission the patient's own form would, so the repeat care history
 * gets its supply entry either way — which is the whole reason the
 * specification asks for this screen.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { Notice } from '@/components/ui/primitives';
import { getEnrolledPatients } from './actions';
import { InternalRequestForm } from './internal-request-form';

export const dynamic = 'force-dynamic';

export default async function NewInternalRequestPage() {
  const { actor, activeBranch } = await getStaffContext();

  if (!can(actor, 'repeat_care:edit')) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">
          Raising a repeat request needs pharmacist access.
        </p>
      </div>
    );
  }

  const patients = await getEnrolledPatients(actor.organisationId);

  return (
    <div className="page-shell mx-auto max-w-[calc(760px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/repeat-care"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        Repeat care
      </Link>

      {!activeBranch ? (
        <Notice tone="review" title="No branch selected">
          Choose the branch you are working from first — the request is recorded
          against it.
        </Notice>
      ) : (
        <InternalRequestForm
          patients={patients}
          branchId={activeBranch.id}
          companyId={activeBranch.companyId}
        />
      )}
    </div>
  );
}
