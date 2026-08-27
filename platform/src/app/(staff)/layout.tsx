/**
 * Staff layout.
 *
 * Every authenticated screen sits inside this. It resolves who is asking, which
 * branches they may act at, and which one they are currently working from —
 * once, here, rather than in each page.
 *
 * Navigation is filtered by the permissions the actor holds AT THE ACTIVE
 * BRANCH, so a locum with pharmacist rights at Kirk Michael only sees the same
 * menu wherever they are, but the pages themselves re-check before doing
 * anything.
 */

import { getStaffContext } from '@/lib/auth/context';
import { StaffShell } from '@/components/shell/staff-shell';
import { getReviewQueue } from '@/lib/queries/reviews';
import { can } from '@/lib/tenancy/scope';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { actor, branches, permissions, roleLabel } = await getStaffContext();

  // A badge on Repeat care is worth a query; skip it for users who cannot review.
  let outstanding = 0;
  if (can(actor, 'repeat_care:edit')) {
    try {
      outstanding = (await getReviewQueue(actor.organisationId)).length;
    } catch {
      outstanding = 0;
    }
  }

  return (
    <StaffShell
      user={{ fullName: actor.fullName, roleLabel, permissions }}
      organisationName="Karsons Pharmacy Group"
      branches={branches.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        companyId: b.companyId,
        companyName: b.companyName,
      }))}
      badges={{ '/repeat-care': outstanding }}
    >
      {children}
    </StaffShell>
  );
}
