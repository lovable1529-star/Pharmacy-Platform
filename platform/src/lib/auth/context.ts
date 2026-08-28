/**
 * Request context for staff pages.
 *
 * Resolves the actor, the branches they may act at, and which one they are
 * currently working from. Every staff page starts here, so the branch a page
 * reads is always one the caller genuinely holds access to — a tampered cookie
 * gets ignored rather than obeyed.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getActor, getBranchesForActor, type BranchContext } from './actor';
import {
  accessibleBranches, displayRole, permissionsFor,
  type Actor, type Permission,
} from '@/lib/tenancy/scope';

const COOKIE = 'karsons.branch';

export interface StaffContext {
  actor: Actor;
  branches: BranchContext[];
  activeBranch: BranchContext | null;
  permissions: Permission[];
  roleLabel: string;
}

/**
 * Memoised per request.
 *
 * The staff layout resolves context to render the navigation, then the page it
 * renders resolves it again. That was an auth round-trip plus three queries,
 * twice, before a page ran its own query — the largest part of the delay
 * between clicking a tab and seeing it.
 */
export const getStaffContext = cache(async function getStaffContext(): Promise<StaffContext> {
  let actor: Actor;
  try {
    actor = await getActor();
  } catch (error) {
    // Distinguish "not signed in" from "signed in but no staff record". The
    // second one otherwise looks identical — an endless bounce to sign-in with
    // nothing explaining why — and it is a setup mistake, not a login failure.
    if (error instanceof Error && error.name === 'NoAccountError') {
      redirect(
        `/sign-in?error=${encodeURIComponent(
          `${error.message} Run supabase/06_staff_account.sql with this account's auth UID.`,
        )}`,
      );
    }
    redirect('/sign-in');
  }

  const all = await getBranchesForActor(actor);
  const permittedIds = accessibleBranches(actor, all);
  const permitted = all.filter((b) => permittedIds.includes(b.id));

  const store = await cookies();
  const requested = store.get(COOKIE)?.value;

  // Only honour the cookie if the user actually holds access there.
  const activeBranch =
    permitted.find((b) => b.id === requested) ?? permitted[0] ?? null;

  const roleName = displayRole(actor);

  return {
    actor,
    branches: permitted,
    activeBranch,
    permissions: [
      ...permissionsFor(
        actor,
        activeBranch
          ? { branchId: activeBranch.id, companyId: activeBranch.companyId }
          : {},
      ),
    ],
    roleLabel: roleName ?? 'No role',
  };
});
