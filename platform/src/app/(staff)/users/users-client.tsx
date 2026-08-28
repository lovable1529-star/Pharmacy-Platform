'use client';

/**
 * Users & Roles.
 *
 * Three areas: the role list, the permission grid for whichever role is
 * selected, and the user table. The grid enforces rule 1 as you tick — ticking
 * any action ticks View, and clearing View clears the row — so what is on screen
 * is exactly what will be stored, with no silent normalisation at save time.
 *
 * The screen refuses obvious self-lockout. The database refuses the rest: a
 * deferred trigger guarantees an active administrator survives every
 * transaction, whatever the interface allowed.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Trash2, Save, Loader2, AlertTriangle, Check, ShieldCheck,
  UserPlus, Lock, CircleSlash,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import { formatDate } from '@/lib/units';
import {
  PERM_MODULES, PERM_ACTIONS, permKey, toggleCell, setModuleRow, effectivePermissions,
  type Permission, type PermModule, type PermAction,
} from '@/lib/tenancy/permissions';
import {
  createRole, deleteRole, saveRolePermissions, assignRole, setUserDisabled,
  type RoleRow, type UserRow,
} from './actions';

interface Props {
  roles: RoleRow[];
  users: UserRow[];
  branches: { id: string; name: string; companyId: string }[];
  currentUserId: string;
  canEdit: boolean;
  canDisable: boolean;
  inviteConfigured: boolean;
}

export function UsersAndRoles({
  roles, users, branches, currentUserId, canEdit, canDisable, inviteConfigured,
}: Props) {
  const router = useRouter();

  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];

  const [draft, setDraft] = useState<Set<Permission>>(
    () => effectivePermissions(roles[0]?.permissions ?? []),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  function selectRole(id: string) {
    const role = roles.find((r) => r.id === id);
    setSelectedId(id);
    setDraft(effectivePermissions(role?.permissions ?? []));
    setDirty(false);
    setMessage(null);
  }

  function toggle(module: PermModule, action: PermAction) {
    if (!canEdit) return;
    setDraft((current) => toggleCell(current, module, action));
    setDirty(true);
    setMessage(null);
  }

  function toggleRow(module: PermModule) {
    if (!canEdit) return;
    const full = PERM_ACTIONS.every((a) => draft.has(permKey(module, a.key)));
    setDraft((current) => setModuleRow(current, module, !full));
    setDirty(true);
    setMessage(null);
  }

  async function save() {
    if (!selected) return;
    setBusy('save');
    setMessage(null);
    const result = await saveRolePermissions(selected.id, [...draft]);
    setBusy(null);

    if (result.ok) {
      setDirty(false);
      setMessage({ ok: true, text: `Saved. ${selected.name} now has ${result.saved} permissions.` });
      router.refresh();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  async function add() {
    setBusy('create');
    setMessage(null);
    const result = await createRole(newName, newDescription);
    setBusy(null);

    if (result.ok) {
      setNewName('');
      setNewDescription('');
      setMessage({ ok: true, text: 'Role created. Tick its permissions and save.' });
      router.refresh();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  async function remove(roleId: string) {
    setBusy(`delete-${roleId}`);
    setMessage(null);
    const result = await deleteRole(roleId);
    setBusy(null);

    if (result.ok) {
      setMessage({ ok: true, text: 'Role deleted.' });
      router.refresh();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  const grid = useMemo(() => draft, [draft]);

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight text-ink">Users &amp; Roles</h1>
          <p className="mt-1 text-[14px] text-ink-faint">
            Define what each role can do, then give people a role — at a branch, and for as long as
            they need it.
          </p>
        </div>
        {canEdit ? (
          <Link
            href="/users/invite"
            className="flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <UserPlus size={15} strokeWidth={2.2} />
            Invite someone
          </Link>
        ) : null}
      </div>

      {!inviteConfigured && canEdit ? (
        <div className="mb-5 rounded-[9px] border border-review-200 bg-review-50 px-4 py-3 text-[13.5px] text-review-700">
          Inviting is unavailable until <code>SUPABASE_SERVICE_ROLE_KEY</code> is set. Roles and
          assignments below still work.
        </div>
      ) : null}

      {message ? (
        <div
          role="status"
          className={cn(
            'mb-5 flex items-start gap-2 rounded-[9px] border px-4 py-3 text-[13.5px]',
            message.ok
              ? 'border-safe-200 bg-safe-50 text-safe-700'
              : 'border-stop-200 bg-stop-50 text-stop-700',
          )}
        >
          {message.ok ? (
            <Check size={15} strokeWidth={2.2} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={15} strokeWidth={2.1} className="mt-0.5 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* ── Roles ─────────────────────────────────────── */}
        <aside className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-display text-[14.5px] font-semibold text-ink">Roles</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">
              Built-in roles cannot be deleted or renamed.
            </p>
          </div>

          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => selectRole(r.id)}
              className={cn(
                'flex w-full items-start gap-2.5 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-b-0',
                selectedId === r.id ? 'bg-brand-50' : 'hover:bg-sunk',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-ink">{r.name}</span>
                  {r.isSystem ? (
                    <span className="flex items-center gap-1 rounded-[4px] bg-sunk px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-ink-faint">
                      <Lock size={9} strokeWidth={2.4} /> system
                    </span>
                  ) : null}
                </span>
                {r.description ? (
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-faint">
                    {r.description}
                  </span>
                ) : null}
                <span className="tabular mt-1 block font-mono text-[11px] text-ink-faint">
                  {r.permissions.length} permissions · {r.assignedCount} user
                  {r.assignedCount === 1 ? '' : 's'}
                </span>
              </span>

              {canEdit && !r.isSystem ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); void remove(r.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void remove(r.id); } }}
                  className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:text-stop-700"
                >
                  {busy === `delete-${r.id}` ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} strokeWidth={2} />
                  )}
                </span>
              ) : null}
            </button>
          ))}

          {canEdit ? (
            <div className="border-t border-line px-4 py-4">
              <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                New role
              </h3>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Role name (e.g. Locum Pharmacist)"
                className="mb-2 w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
              />
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description (optional)"
                className="mb-2.5 w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={add}
                disabled={busy === 'create' || !newName.trim()}
                className={cn(
                  'flex w-full items-center justify-center gap-1.5 rounded-[7px] px-3 py-2 text-[13.5px] font-semibold text-white transition-colors',
                  busy === 'create' || !newName.trim()
                    ? 'cursor-not-allowed bg-ink-faint'
                    : 'bg-brand-600 hover:bg-brand-700',
                )}
              >
                {busy === 'create' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} strokeWidth={2.2} />
                )}
                Create role
              </button>
            </div>
          ) : null}
        </aside>

        {/* ── Permission grid ───────────────────────────── */}
        <section className="min-w-0 overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-display text-[14.5px] font-semibold text-ink">
                Permissions — {selected?.name ?? 'no role selected'}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">
                Ticking any action also ticks View. Unticking View clears the row.
              </p>
            </div>

            {canEdit ? (
              <button
                type="button"
                onClick={save}
                disabled={busy === 'save' || !dirty}
                className={cn(
                  'ml-auto flex items-center gap-1.5 rounded-[7px] px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors',
                  busy === 'save' || !dirty
                    ? 'cursor-not-allowed bg-ink-faint'
                    : 'bg-brand-600 hover:bg-brand-700',
                )}
              >
                {busy === 'save' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} strokeWidth={2.1} />
                )}
                {dirty ? 'Save permissions' : 'Saved'}
              </button>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  <th className="border-b border-line bg-sunk px-4 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-faint">
                    Module
                  </th>
                  {PERM_ACTIONS.map((a) => (
                    <th
                      key={a.key}
                      title={a.hint}
                      className="border-b border-line bg-sunk px-3 py-2.5 text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-faint"
                    >
                      {a.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERM_MODULES.map((m) => {
                  const full = PERM_ACTIONS.every((a) => grid.has(permKey(m.key, a.key)));
                  return (
                    <tr key={m.key} className="border-b border-line-soft last:border-b-0">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleRow(m.key)}
                          disabled={!canEdit}
                          className={cn(
                            'text-left font-medium text-ink transition-colors',
                            canEdit && 'hover:text-brand-700',
                          )}
                          title={canEdit ? 'Tick or clear the whole row' : undefined}
                        >
                          {m.label}
                        </button>
                      </td>
                      {PERM_ACTIONS.map((a) => {
                        const checked = grid.has(permKey(m.key, a.key));
                        return (
                          <td key={a.key} className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              aria-label={`${m.label} — ${a.label}`}
                              disabled={!canEdit}
                              onClick={() => toggle(m.key, a.key)}
                              className={cn(
                                'inline-flex h-[19px] w-[19px] items-center justify-center rounded-[5px] border-2 transition-colors',
                                checked
                                  ? 'border-brand-600 bg-brand-600 text-white'
                                  : 'border-line bg-surface',
                                canEdit && !checked && 'hover:border-brand-400',
                                !canEdit && 'cursor-not-allowed opacity-60',
                              )}
                            >
                              {checked ? <Check size={12} strokeWidth={3} /> : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected?.name === 'Admin' ? (
            <p className="flex items-start gap-1.5 border-t border-line px-4 py-3 text-[12.5px] text-ink-faint">
              <ShieldCheck size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
              Anybody holding <strong className="font-medium text-ink-soft">Users &amp; Roles → Edit</strong>{' '}
              is an administrator, whatever their role is called. The system will not let you remove
              the last one.
            </p>
          ) : null}
        </section>
      </div>

      {/* ── Users ───────────────────────────────────────── */}
      <section className="mt-6 overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-[14.5px] font-semibold text-ink">Users</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-faint">
            Each person holds one role. Disable people rather than deleting them, so historical
            records keep their author.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                {['User', 'Status', 'Role', 'Where', 'Until', ''].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line bg-sunk px-4 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRowView
                  key={u.id}
                  user={u}
                  roles={roles}
                  branches={branches}
                  isSelf={u.id === currentUserId}
                  canEdit={canEdit}
                  canDisable={canDisable}
                  onChanged={() => router.refresh()}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function UserRowView({
  user, roles, branches, isSelf, canEdit, canDisable, onChanged,
}: {
  user: UserRow;
  roles: RoleRow[];
  branches: { id: string; name: string; companyId: string }[];
  isSelf: boolean;
  canEdit: boolean;
  canDisable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = user.disabledAt !== null;

  async function change(next: { roleId?: string; branchId?: string | null }) {
    const roleId = next.roleId ?? user.roleId;
    if (!roleId) return;

    const branchId = next.branchId !== undefined ? next.branchId : user.branchId;
    const companyId = branchId ? branches.find((b) => b.id === branchId)?.companyId ?? null : null;

    setBusy(true);
    setError(null);
    const result = await assignRole({
      userId: user.id,
      roleId,
      branchId,
      companyId,
      validTo: user.validTo ? user.validTo.toISOString() : null,
    });
    setBusy(false);

    if (result.ok) onChanged();
    else setError(result.error);
  }

  async function toggleDisabled() {
    setBusy(true);
    setError(null);
    const result = await setUserDisabled(user.id, !disabled);
    setBusy(false);

    if (result.ok) onChanged();
    else setError(result.error);
  }

  const select =
    'rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-400 focus:outline-none disabled:opacity-55';

  return (
    <tr className={cn('border-b border-line-soft last:border-b-0', disabled && 'bg-sunk/60')}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn('font-medium', disabled ? 'text-ink-faint' : 'text-ink')}>
            {user.fullName}
          </span>
          {isSelf ? (
            <span className="rounded-[4px] bg-brand-100 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-brand-700">
              you
            </span>
          ) : null}
        </div>
        <div className="font-mono text-[11.5px] text-ink-faint">{user.email}</div>
        {error ? <div className="mt-1 text-[12px] text-stop-700">{error}</div> : null}
      </td>

      <td className="px-4 py-3">
        {disabled ? (
          <span className="flex w-fit items-center gap-1 rounded-[5px] bg-stop-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-stop-700">
            <CircleSlash size={10} strokeWidth={2.4} /> disabled
          </span>
        ) : (
          <span className="rounded-[5px] bg-safe-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-safe-700">
            active
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        <SearchSelect
          value={user.roleId ?? ''}
          disabled={!canEdit || disabled || busy}
          onChange={(next) => change({ roleId: next })}
          aria-label={`Role for ${user.fullName}`}
          {...(!user.roleId ? { emptyLabel: 'No role' } : {})}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
        />
      </td>

      <td className="px-4 py-3">
        <SearchSelect
          value={user.branchId ?? ''}
          disabled={!canEdit || disabled || busy}
          onChange={(next) => change({ branchId: next || null })}
          aria-label={`Branch for ${user.fullName}`}
          emptyLabel="All branches"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
        />
      </td>

      <td className="tabular px-4 py-3 font-mono text-[12px] text-ink-faint">
        {user.validTo ? formatDate(user.validTo) : '—'}
      </td>

      <td className="px-4 py-3 text-right">
        {canDisable ? (
          <button
            type="button"
            onClick={toggleDisabled}
            disabled={busy || (isSelf && !disabled)}
            title={isSelf && !disabled ? 'You cannot disable your own account' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              isSelf && !disabled
                ? 'cursor-not-allowed border-line text-ink-faint opacity-55'
                : disabled
                  ? 'border-line text-safe-700 hover:border-safe-200'
                  : 'border-line text-ink-soft hover:border-stop-200 hover:text-stop-700',
            )}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {disabled ? 'Enable' : 'Disable'}
          </button>
        ) : null}
      </td>
    </tr>
  );
}
