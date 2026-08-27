import { getUsersAndRoles } from './actions';
import { UsersAndRoles } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  try {
    const data = await getUsersAndRoles();
    return <UsersAndRoles {...data} />;
  } catch {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">
          Managing users and roles needs administrator access. Speak to whoever set up your
          account if you think that is wrong.
        </p>
      </div>
    );
  }
}
