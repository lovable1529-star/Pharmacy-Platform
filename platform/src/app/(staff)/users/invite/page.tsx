import { getUsersAndRoles } from '../actions';
import { InviteForm } from './invite-form';

export const dynamic = 'force-dynamic';

export default async function InvitePage() {
  try {
    const { roles, branches, canEdit, inviteConfigured } = await getUsersAndRoles();

    if (!canEdit) {
      return (
        <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
          <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
          <p className="text-[14px] text-ink-soft">Inviting users needs administrator access.</p>
        </div>
      );
    }

    return (
      <InviteForm
        roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description }))}
        branches={branches}
        configured={inviteConfigured}
      />
    );
  } catch {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">Inviting users needs administrator access.</p>
      </div>
    );
  }
}
