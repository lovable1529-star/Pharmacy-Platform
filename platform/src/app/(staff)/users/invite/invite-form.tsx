'use client';

/**
 * Invite a colleague.
 *
 * The access-rules panel on the right is not decoration. Somebody looking at
 * this screen is about to give another person access to patient records, and
 * they should be able to see what the system will and will not allow while they
 * do it.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Mail, AlertTriangle, ShieldCheck, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import { inviteUser } from '../actions';

const input =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[14.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none';
const label = 'mb-1.5 block text-[13px] font-medium text-ink';

export function InviteForm({
  roles, branches, configured,
}: {
  roles: { id: string; name: string; description: string | null }[];
  branches: { id: string; name: string; companyId: string }[];
  configured: boolean;
}) {
  // Viewer is the safe default when it exists — the least privilege that lets
  // somebody sign in and be useful.
  const viewer = roles.find((r) => r.name === 'Viewer');

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState(viewer?.id ?? roles[0]?.id ?? '');
  const [branchId, setBranchId] = useState('');
  const [validTo, setValidTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; roleName: string } | null>(null);

  const chosenRole = roles.find((r) => r.id === roleId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result = await inviteUser({
      email,
      fullName,
      roleId,
      branchId: branchId || null,
      companyId: branchId ? branches.find((b) => b.id === branchId)?.companyId ?? null : null,
      validTo: validTo || null,
    });

    setBusy(false);
    if (result.ok) {
      setSent({ email: result.email, roleName: result.roleName });
      setEmail('');
      setFullName('');
      setValidTo('');
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="page-shell mx-auto max-w-[calc(1000px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/users"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} /> Users &amp; Roles
      </Link>

      <h1 className="mb-1 text-[26px] leading-tight text-ink">Invite someone</h1>
      <p className="mb-6 text-[14px] text-ink-faint">
        They will receive an email, choose their own password, and arrive with the role you pick
        here.
      </p>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* ── Form ──────────────────────────────────────── */}
        <form onSubmit={submit} className="rounded-panel border border-line bg-surface shadow-panel px-5 py-5">
          {sent ? (
            <div className="mb-5 flex items-start gap-2.5 rounded-[9px] border border-safe-200 bg-safe-50 px-4 py-3">
              <Check size={15} strokeWidth={2.2} className="mt-0.5 shrink-0 text-safe-700" />
              <div className="text-[13.5px] text-safe-700">
                Invitation sent to <strong>{sent.email}</strong> as {sent.roleName}. They appear in
                the user list once they accept.
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@karsonspharmacy.co.uk"
                className={input}
              />
            </div>
            <div>
              <label className={label} htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Optional"
                className={input}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={label} htmlFor="role">Role</label>
              <SearchSelect
                id="role"
                value={roleId}
                onChange={setRoleId}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
              />
              {chosenRole?.description ? (
                <p className="mt-1.5 text-[12.5px] text-ink-faint">{chosenRole.description}</p>
              ) : null}
            </div>

            <div>
              <label className={label} htmlFor="branch">Branch</label>
              <SearchSelect
                id="branch"
                value={branchId}
                onChange={setBranchId}
                emptyLabel="All branches"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
              <p className="mt-1.5 text-[12.5px] text-ink-faint">
                Restrict a locum to the site they are covering.
              </p>
            </div>

            <div>
              <label className={label} htmlFor="validTo">Access until</label>
              <input
                id="validTo"
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                className={input}
              />
              <p className="mt-1.5 text-[12.5px] text-ink-faint">
                Leave blank for permanent. Access lapses on its own.
              </p>
            </div>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3 py-2.5 text-[13px] text-stop-700"
            >
              <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || !configured || !email.trim() || !roleId}
            className={cn(
              'mt-5 flex items-center gap-2 rounded-control px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
              busy || !configured || !email.trim() || !roleId
                ? 'cursor-not-allowed bg-ink-faint'
                : 'bg-brand-600 hover:bg-brand-700',
            )}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} strokeWidth={2.1} />}
            Send invitation
          </button>

          {!configured ? (
            <p className="mt-3 text-[12.5px] text-review-700">
              Inviting needs <code>SUPABASE_SERVICE_ROLE_KEY</code> in the environment.
            </p>
          ) : null}
        </form>

        {/* ── Access rules ──────────────────────────────── */}
        <aside className="rounded-panel border border-line bg-surface shadow-panel px-5 py-5">
          <h2 className="mb-3 flex items-center gap-1.5 font-display text-[14.5px] font-semibold text-ink">
            <ShieldCheck size={15} strokeWidth={2} className="text-brand-600" />
            Access rules
          </h2>
          <ul className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-soft">
            <li>
              There is no public sign-up. It is blocked in the application and refused by a
              database trigger, so it cannot be turned back on by accident.
            </li>
            <li>
              Every invited account is created read-only first, then given the role you chose. The
              invitation itself never carries privileges.
            </li>
            <li>
              Nobody sees a password, including you. They set their own from the emailed link.
            </li>
            <li>
              The system always keeps at least one active administrator, and refuses any change
              that would remove the last one.
            </li>
            <li>
              People are disabled, never deleted — consultations and audit entries keep their
              author.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
