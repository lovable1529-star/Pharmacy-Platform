-- ═══════════════════════════════════════════════════════════
-- Database-backed roles, permissions and invite-only access
-- ═══════════════════════════════════════════════════════════
--
-- Replaces the six hardcoded roles with an editable grid of MODULE × ACTION
-- permissions, and closes the public sign-up door.
--
-- Two layers, and a request must satisfy both:
--
--   WHAT   the role's permission grid — editable by an administrator.
--   WHERE  the assignment — which branch, and between which dates.
--
-- Most RBAC models have only the first. A locum holding Pharmacist at Kirk
-- Michael for a fortnight needs the second, and needs it to lapse on its own.
--
-- The browser uses permissions to show and hide controls, but the browser is
-- not the security boundary. Everything below is enforced in Postgres, so a
-- request that skips the application entirely still gets nothing.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1 · Accounts are disabled, never deleted
-- ─────────────────────────────────────────────────────────────

alter table public.app_user
  add column if not exists disabled_at      timestamptz,
  add column if not exists disabled_by      uuid,
  add column if not exists disabled_reason  text;

comment on column public.app_user.disabled_at is
  'Set to withdraw access. Never delete a staff account — consultations, audit entries and prescriptions all reference their author, and those references must stay valid.';

-- ─────────────────────────────────────────────────────────────
-- 2 · Retire the old role ENUM before creating the role TABLE
-- ─────────────────────────────────────────────────────────────
--
-- Script 01 created `create type public.role as enum (...)`. A table creates a
-- type of the same name, so Postgres refuses `create table role` while that
-- enum exists:
--
--   ERROR: type "role" already exists
--
-- The enum's values are still needed to map existing people onto the new roles,
-- so they are copied to a plain text column first, the enum column and type are
-- dropped, and the text is used for the backfill further down.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'role_assignment'
      and column_name = 'role'
  ) then
    alter table public.role_assignment add column if not exists legacy_role text;
    execute 'update public.role_assignment set legacy_role = role::text where legacy_role is null';
    alter table public.role_assignment drop column role;
  end if;
end $$;

-- Nothing references the type now, so it can go. Without this the next
-- statement fails on a database that ran script 01.
drop type if exists public.role;

-- ─────────────────────────────────────────────────────────────
-- 3 · Roles and their permission grids
-- ─────────────────────────────────────────────────────────────

create table if not exists public.role (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  name             text not null,
  description      text,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now()
);

create unique index if not exists role_name_idx
  on public.role (organisation_id, name);

-- The module and action lists mirror src/lib/tenancy/permissions.ts. A typo
-- becomes a failed insert rather than a permission that silently never matches.
create table if not exists public.role_permission (
  role_id  uuid not null references public.role(id) on delete cascade,
  module   text not null check (module in (
             'patients','consultations','appointments','repeat_care','inventory',
             'services','communications','reports','compliance','settings','users')),
  action   text not null check (action in (
             'view','add','edit','delete','disable','export')),
  primary key (role_id, module, action)
);

create index if not exists role_permission_role_idx on public.role_permission (role_id);

-- ─────────────────────────────────────────────────────────────
-- 4 · Seed roles, then move assignments onto them
-- ─────────────────────────────────────────────────────────────

do $$
declare
  v_org  uuid;
  v_role uuid;
  m text;
  a text;
begin
  select id into v_org from public.organisation order by created_at limit 1;
  if v_org is null then
    raise exception 'No organisation exists. Run the reference data script first.';
  end if;

  -- Admin: every cell. A system role.
  insert into public.role (organisation_id, name, description, is_system)
  values (v_org, 'Admin', 'Full access to every module, including users and roles.', true)
  on conflict (organisation_id, name) do nothing;

  select id into v_role from public.role where organisation_id = v_org and name = 'Admin';
  foreach m in array array['patients','consultations','appointments','repeat_care','inventory',
                           'services','communications','reports','compliance','settings','users'] loop
    foreach a in array array['view','add','edit','delete','disable','export'] loop
      insert into public.role_permission (role_id, module, action)
      values (v_role, m, a) on conflict do nothing;
    end loop;
  end loop;

  -- Viewer: read-only everywhere. The safe default for a new account.
  insert into public.role (organisation_id, name, description, is_system)
  values (v_org, 'Viewer', 'Read-only across every screen. The safe default for a new account.', true)
  on conflict (organisation_id, name) do nothing;

  select id into v_role from public.role where organisation_id = v_org and name = 'Viewer';
  foreach m in array array['patients','consultations','appointments','repeat_care','inventory',
                           'services','communications','reports','compliance','settings','users'] loop
    insert into public.role_permission (role_id, module, action)
    values (v_role, m, 'view') on conflict do nothing;
  end loop;

  -- Pharmacist. Editable and deletable — a sensible default, not a constraint.
  -- Note what is deliberately absent: services:edit. Authoring clinical rules is
  -- an administrative act with its own audit trail, separate from using them.
  insert into public.role (organisation_id, name, description, is_system)
  values (v_org, 'Pharmacist', 'Full clinical access — consultations, repeat care, inventory.', false)
  on conflict (organisation_id, name) do nothing;

  select id into v_role from public.role where organisation_id = v_org and name = 'Pharmacist';
  insert into public.role_permission (role_id, module, action)
  select v_role, x.module, x.action from (values
    ('patients','view'),('patients','add'),('patients','edit'),
    ('consultations','view'),('consultations','add'),('consultations','edit'),('consultations','export'),
    ('appointments','view'),('appointments','add'),('appointments','edit'),
    ('repeat_care','view'),('repeat_care','edit'),
    ('inventory','view'),('inventory','add'),('inventory','edit'),('inventory','disable'),
    ('services','view'),
    ('communications','view'),
    ('reports','view'),('reports','export'),
    ('compliance','view')
  ) as x(module, action)
  on conflict do nothing;

  -- Technician.
  insert into public.role (organisation_id, name, description, is_system)
  values (v_org, 'Technician', 'Supports the clinical team. Cannot review repeat requests.', false)
  on conflict (organisation_id, name) do nothing;

  select id into v_role from public.role where organisation_id = v_org and name = 'Technician';
  insert into public.role_permission (role_id, module, action)
  select v_role, x.module, x.action from (values
    ('patients','view'),('patients','add'),('patients','edit'),
    ('consultations','view'),
    ('appointments','view'),('appointments','add'),('appointments','edit'),
    ('inventory','view'),('inventory','add'),('inventory','edit'),
    ('services','view'),
    ('reports','view')
  ) as x(module, action)
  on conflict do nothing;

  -- Reception.
  insert into public.role (organisation_id, name, description, is_system)
  values (v_org, 'Reception', 'Front of house — booking and patient records only.', false)
  on conflict (organisation_id, name) do nothing;

  select id into v_role from public.role where organisation_id = v_org and name = 'Reception';
  insert into public.role_permission (role_id, module, action)
  select v_role, x.module, x.action from (values
    ('patients','view'),('patients','add'),('patients','edit'),
    ('appointments','view'),('appointments','add'),('appointments','edit'),
    ('services','view')
  ) as x(module, action)
  on conflict do nothing;
end $$;

-- Move existing assignments onto the new roles, preserving their branch and
-- date scoping. `legacy_role` holds the old enum value, captured in section 2
-- before the enum was dropped.
alter table public.role_assignment add column if not exists role_id uuid;

update public.role_assignment ra
set role_id = r.id
from public.role r
where ra.role_id is null
  and r.organisation_id = ra.organisation_id
  and r.name = case coalesce(ra.legacy_role, 'READ_ONLY')
                 when 'OWNER'       then 'Admin'
                 when 'ADMIN'       then 'Admin'
                 when 'PHARMACIST'  then 'Pharmacist'
                 when 'TECHNICIAN'  then 'Technician'
                 when 'RECEPTION'   then 'Reception'
                 else 'Viewer'
               end;

-- Anything still unmapped becomes Viewer rather than blocking the migration —
-- read-only is the safe landing place for an assignment we cannot interpret.
update public.role_assignment ra
set role_id = r.id
from public.role r
where ra.role_id is null
  and r.organisation_id = ra.organisation_id
  and r.name = 'Viewer';

-- Any assignment with no role at all cannot be made NOT NULL, and an
-- assignment row that grants nothing is meaningless.
delete from public.role_assignment where role_id is null;

alter table public.role_assignment
  alter column role_id set not null;

alter table public.role_assignment
  drop constraint if exists role_assignment_role_id_role_id_fk;

alter table public.role_assignment
  add constraint role_assignment_role_id_role_id_fk
  foreign key (role_id) references public.role(id);

alter table public.role_assignment drop column if exists legacy_role;

create index if not exists role_assignment_role_idx on public.role_assignment (role_id);

commit;

-- ─────────────────────────────────────────────────────────────
-- 5 · Authorization functions
-- ─────────────────────────────────────────────────────────────

/**
 * The central authorization predicate, used by RLS and by the application.
 *
 * Three properties matter and all three are deliberate:
 *
 *   · A DISABLED user has no permissions, whatever their role says and however
 *     valid their session token still is. Disabling cuts access at the database,
 *     not just in the interface.
 *   · A non-view action independently requires view. You cannot edit what you
 *     cannot see, and that is enforced here rather than trusted to the editor.
 *   · An assignment only counts where and when it applies — branch scope and
 *     validity dates are part of the check, not decoration.
 */
create or replace function public.has_perm(
  _module text,
  _action text,
  _branch_id uuid default null
) returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with me as (
    select id, organisation_id, disabled_at
    from public.app_user
    where id = auth.uid() and archived_at is null
  ),
  grants as (
    select rp.module, rp.action
    from public.role_assignment ra
    join public.role_permission rp on rp.role_id = ra.role_id
    join me on me.id = ra.user_id
    where ra.valid_from <= now()
      and (ra.valid_to is null or ra.valid_to >= now())
      and (
        -- organisation-wide
        (ra.company_id is null and ra.branch_id is null)
        -- branch-scoped
        or (_branch_id is not null and ra.branch_id = _branch_id)
        -- company-scoped: covers every branch in that company
        or (_branch_id is not null and ra.company_id is not null and ra.company_id = (
              select b.company_id from public.branch b where b.id = _branch_id))
      )
  )
  select
    exists (select 1 from me where disabled_at is null)
    and exists (select 1 from grants where module = _module and action = _action)
    and (
      _action = 'view'
      or exists (select 1 from grants where module = _module and action = 'view')
    );
$$;

comment on function public.has_perm(text, text, uuid) is
  'Central authorization predicate. Disabled users get nothing; non-view actions require view; assignments only count within their branch scope and validity dates.';

/** The signed-in user's grid, for mirroring into the interface. */
create or replace function public.my_permissions()
returns table (module text, action text, branch_id uuid, company_id uuid, valid_to timestamptz)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select rp.module, rp.action, ra.branch_id, ra.company_id, ra.valid_to
  from public.role_assignment ra
  join public.role_permission rp on rp.role_id = ra.role_id
  join public.app_user u on u.id = ra.user_id
  where ra.user_id = auth.uid()
    and u.disabled_at is null
    and u.archived_at is null
    and ra.valid_from <= now()
    and (ra.valid_to is null or ra.valid_to >= now());
$$;

/**
 * Replaces one role's grid atomically.
 *
 * Deleting then inserting inside a single transaction means an administrator
 * saving a grid can never leave a role half-updated, which with the
 * last-administrator guard could otherwise lock everybody out mid-save.
 */
create or replace function public.replace_role_permissions(
  _role_id uuid,
  _permissions text[]
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p text;
  v_module text;
  v_action text;
begin
  if not public.has_perm('users', 'edit') then
    raise exception 'NOT_AUTHORISED: editing roles requires users:edit'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.role where id = _role_id) then
    raise exception 'That role no longer exists.' using errcode = '23503';
  end if;

  delete from public.role_permission where role_id = _role_id;

  foreach p in array coalesce(_permissions, array[]::text[]) loop
    v_module := split_part(p, ':', 1);
    v_action := split_part(p, ':', 2);
    if v_module = '' or v_action = '' then continue; end if;

    insert into public.role_permission (role_id, module, action)
    values (_role_id, v_module, v_action)
    on conflict do nothing;

    -- Any non-view action implies view, applied on write as well as on read.
    if v_action <> 'view' then
      insert into public.role_permission (role_id, module, action)
      values (_role_id, v_module, 'view')
      on conflict do nothing;
    end if;
  end loop;
end $$;

/**
 * Enable or disable an account.
 *
 * Refuses self-disable outright: an administrator locking themselves out is the
 * most common way a system becomes unadministrable, and it always looks like an
 * accident afterwards.
 */
create or replace function public.set_user_disabled(
  _user_id uuid,
  _disabled boolean,
  _reason text default null
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.has_perm('users', 'disable') then
    raise exception 'NOT_AUTHORISED: disabling a user requires users:disable'
      using errcode = '42501';
  end if;

  if _user_id = auth.uid() and _disabled then
    raise exception 'You cannot disable your own account.' using errcode = '23514';
  end if;

  update public.app_user
  set disabled_at = case when _disabled then now() else null end,
      disabled_by = case when _disabled then auth.uid() else null end,
      disabled_reason = case when _disabled then _reason else null end
  where id = _user_id;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6 · Safety triggers
-- ─────────────────────────────────────────────────────────────

/** System roles cannot be deleted, renamed, or have is_system cleared. */
create or replace function public.protect_system_roles()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Cannot delete the built-in role "%".', old.name
        using errcode = '23514';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.is_system and (new.is_system is distinct from old.is_system
                          or new.name is distinct from old.name) then
      raise exception 'Cannot rename or unprotect the built-in role "%".', old.name
        using errcode = '23514';
    end if;
    return new;
  end if;
  return new;
end $$;

drop trigger if exists role_protect_system on public.role;
create trigger role_protect_system
  before update or delete on public.role
  for each row execute function public.protect_system_roles();

/**
 * At least one active administrator must remain.
 *
 * Administration is a CAPABILITY here, not a role name: anybody holding
 * users:edit counts. A custom role granted that permission is genuinely an
 * administrator, which is the behaviour people expect and the one that avoids
 * a system nobody can administer.
 *
 * Deferred so it evaluates the FINAL state of a transaction — an administrator
 * moving their own rights between two roles in one save is legitimate and must
 * not trip it. The advisory lock serialises concurrent admin changes so two
 * simultaneous demotions cannot both believe the other still holds access.
 */
create or replace function public.guard_last_administrator()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform pg_advisory_xact_lock(823042);

  if not exists (
    select 1
    from public.role_assignment ra
    join public.role_permission rp on rp.role_id = ra.role_id
    join public.app_user u on u.id = ra.user_id
    where rp.module = 'users' and rp.action = 'edit'
      and u.disabled_at is null
      and u.archived_at is null
      and ra.valid_from <= now()
      and (ra.valid_to is null or ra.valid_to >= now())
  ) then
    raise exception 'At least one active administrator must remain.'
      using errcode = '23514';
  end if;

  return null;
end $$;

drop trigger if exists role_assignment_guard_admin on public.role_assignment;
create constraint trigger role_assignment_guard_admin
  after insert or update or delete on public.role_assignment
  deferrable initially deferred
  for each row execute function public.guard_last_administrator();

drop trigger if exists role_permission_guard_admin on public.role_permission;
create constraint trigger role_permission_guard_admin
  after insert or update or delete on public.role_permission
  deferrable initially deferred
  for each row execute function public.guard_last_administrator();

drop trigger if exists app_user_guard_admin on public.app_user;
create constraint trigger app_user_guard_admin
  after update on public.app_user
  deferrable initially deferred
  for each row execute function public.guard_last_administrator();

/** Staff accounts are disabled, never deleted. */
drop trigger if exists app_user_no_delete on public.app_user;
create trigger app_user_no_delete
  before delete on public.app_user
  for each row execute function public.reject_clinical_delete();

-- ─────────────────────────────────────────────────────────────
-- 7 · Invite-only: block public sign-up at the database
-- ─────────────────────────────────────────────────────────────

/**
 * Rejects anybody creating themselves an account.
 *
 * A Supabase dashboard setting can be flipped back by accident; this cannot.
 * Only two paths through:
 *
 *   · a marked invitation, created by an administrator through the server-only
 *     invite endpoint
 *   · the first-ever account, when no administrator exists yet — a documented
 *     one-time bootstrap with no personal identity hardcoded into it
 *
 * Critically, an invited user is provisioned as VIEWER regardless of the role
 * the invitation asked for. Client-supplied metadata is never trusted for
 * privilege; the administrator's chosen role is applied afterwards by trusted
 * server code. That closes the signup-metadata escalation path.
 */
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org         uuid;
  v_viewer      uuid;
  v_admin       uuid;
  v_has_admin   boolean;
  v_role        uuid;
  v_invited     boolean;
begin
  select id into v_org from public.organisation order by created_at limit 1;
  if v_org is null then
    raise exception 'SIGNUP_DISABLED: the pharmacy has not been set up yet.'
      using errcode = '42501';
  end if;

  select id into v_admin  from public.role where organisation_id = v_org and name = 'Admin';
  select id into v_viewer from public.role where organisation_id = v_org and name = 'Viewer';

  select exists (
    select 1
    from public.role_assignment ra
    join public.role_permission rp on rp.role_id = ra.role_id
    join public.app_user u on u.id = ra.user_id
    where rp.module = 'users' and rp.action = 'edit' and u.disabled_at is null
  ) into v_has_admin;

  v_invited := coalesce(new.raw_user_meta_data->>'karsons_invited', 'false') = 'true';

  if not v_has_admin then
    -- One-time bootstrap: the very first account becomes the administrator.
    -- Reachable only while NO administrator exists, and never again.
    v_role := v_admin;
  elsif v_invited then
    -- Always Viewer. The requested role is applied by the trusted server
    -- endpoint after this trigger has run.
    v_role := v_viewer;
  else
    raise exception 'SIGNUP_DISABLED: ask an administrator to invite you.'
      using errcode = '42501';
  end if;

  insert into public.app_user (id, organisation_id, full_name, email)
  values (
    new.id,
    v_org,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name;

  insert into public.role_assignment (organisation_id, user_id, role_id, company_id, branch_id)
  values (v_org, new.id, v_role, null, null);

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ─────────────────────────────────────────────────────────────
-- 8 · Row-level security
-- ─────────────────────────────────────────────────────────────

alter table public.role            enable row level security;
alter table public.role_permission enable row level security;

drop policy if exists role_read on public.role;
create policy role_read on public.role
  for select to authenticated
  using (organisation_id = public.current_organisation_id());

drop policy if exists role_write on public.role;
create policy role_write on public.role
  for all to authenticated
  using (organisation_id = public.current_organisation_id() and public.has_perm('users','edit'))
  with check (organisation_id = public.current_organisation_id() and public.has_perm('users','edit'));

drop policy if exists role_permission_read on public.role_permission;
create policy role_permission_read on public.role_permission
  for select to authenticated
  using (exists (
    select 1 from public.role r
    where r.id = role_permission.role_id
      and r.organisation_id = public.current_organisation_id()
  ));

drop policy if exists role_permission_write on public.role_permission;
create policy role_permission_write on public.role_permission
  for all to authenticated
  using (public.has_perm('users','edit'))
  with check (public.has_perm('users','edit'));

grant execute on function public.has_perm(text, text, uuid) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.replace_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.set_user_disabled(uuid, boolean, text) to authenticated;
