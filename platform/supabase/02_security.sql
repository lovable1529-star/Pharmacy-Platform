-- ═══════════════════════════════════════════════════════════
-- 02 · Row-level security, audit protection and clinical guards
-- Karsons Pharmacy platform
-- ═══════════════════════════════════════════════════════════
-- Tenant isolation on every table, an append-only audit log that not even an
-- owner can rewrite, triggers refusing to delete clinical records, and
-- triggers refusing to edit a published form version.
-- 
-- Run this second, immediately after 01.
-- Row-level security.
--
-- Tenancy is enforced twice, deliberately.
--
--   PRIMARY   application code — `assertCan` in src/lib/tenancy/scope.ts, which
--             every server action runs before it reads or writes anything.
--   BACKSTOP  these policies — so that one forgotten WHERE clause cannot expose
--             another pharmacy group's patients.
--
-- Defence in depth matters more here than in most products: the data is special
-- category health data, and the client is adding sites.
--
-- Run this AFTER the generated schema migration.

-- ─────────────────────────────────────────────────────────────
-- Helper: the organisation of the currently authenticated user.
-- SECURITY DEFINER so it can read app_user without recursing through RLS.
-- ─────────────────────────────────────────────────────────────

create or replace function public.current_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id
  from public.app_user
  where id = auth.uid()
    and archived_at is null
  limit 1
$$;

comment on function public.current_organisation_id() is
  'Organisation of the signed-in staff user. Returns null for anonymous requests, which denies every tenant policy below.';

-- ─────────────────────────────────────────────────────────────
-- Enable RLS everywhere that carries tenant data
-- ─────────────────────────────────────────────────────────────

alter table public.organisation      enable row level security;
alter table public.company           enable row level security;
alter table public.branch            enable row level security;
alter table public.app_user          enable row level security;
alter table public.role_assignment   enable row level security;
alter table public.gp_surgery        enable row level security;
alter table public.clinician         enable row level security;
alter table public.product           enable row level security;
alter table public.batch             enable row level security;
alter table public.stock_level       enable row level security;
alter table public.stock_movement    enable row level security;
alter table public.patient           enable row level security;
alter table public.allergy           enable row level security;
alter table public.service           enable row level security;
alter table public.form_version      enable row level security;
alter table public.ruleset_version   enable row level security;
alter table public.submission        enable row level security;
alter table public.rule_evaluation   enable row level security;
alter table public.consultation      enable row level security;
alter table public.review_event      enable row level security;
alter table public.audit_event       enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Organisation-scoped tables
-- ─────────────────────────────────────────────────────────────

do $$
declare
  t text;
  tenant_tables text[] := array[
    'company', 'branch', 'app_user', 'role_assignment', 'gp_surgery', 'clinician',
    'product', 'batch', 'stock_level', 'stock_movement', 'patient', 'allergy',
    'service', 'form_version', 'ruleset_version', 'submission', 'rule_evaluation',
    'consultation', 'review_event'
  ];
begin
  foreach t in array tenant_tables loop
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_tenant_isolation', t
    );
    execute format(
      'create policy %I on public.%I
         for all
         to authenticated
         using (organisation_id = public.current_organisation_id())
         with check (organisation_id = public.current_organisation_id())',
      t || '_tenant_isolation', t
    );
  end loop;
end $$;

-- The organisation row itself
drop policy if exists organisation_tenant_isolation on public.organisation;
create policy organisation_tenant_isolation on public.organisation
  for all
  to authenticated
  using (id = public.current_organisation_id())
  with check (id = public.current_organisation_id());

-- ─────────────────────────────────────────────────────────────
-- The audit log is APPEND ONLY.
--
-- Readable within the organisation, insertable within the organisation, and
-- never updatable or deletable by anybody — including an owner. A log that a
-- privileged user can rewrite is not evidence of anything.
-- ─────────────────────────────────────────────────────────────

drop policy if exists audit_event_read on public.audit_event;
create policy audit_event_read on public.audit_event
  for select
  to authenticated
  using (organisation_id = public.current_organisation_id());

drop policy if exists audit_event_append on public.audit_event;
create policy audit_event_append on public.audit_event
  for insert
  to authenticated
  with check (organisation_id = public.current_organisation_id());

-- No update or delete policy exists, so both are denied for every non-superuser.

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_event is append-only: entries cannot be % once written.', lower(tg_op);
end $$;

drop trigger if exists audit_event_no_update on public.audit_event;
create trigger audit_event_no_update
  before update or delete on public.audit_event
  for each row execute function public.reject_audit_mutation();

-- ─────────────────────────────────────────────────────────────
-- Clinical data is never hard-deleted. Archive it, or create a new version.
-- Enforced here so it holds even for someone at a psql prompt.
-- ─────────────────────────────────────────────────────────────

create or replace function public.reject_clinical_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Clinical records cannot be deleted. Set archived_at, or create a new version.';
end $$;

do $$
declare
  t text;
  protected_tables text[] := array[
    'patient', 'submission', 'consultation', 'rule_evaluation', 'review_event',
    'form_version', 'ruleset_version'
  ];
begin
  foreach t in array protected_tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format(
      'create trigger %I before delete on public.%I
         for each row execute function public.reject_clinical_delete()',
      t || '_no_delete', t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Published form and ruleset versions are immutable.
--
-- This is what makes "every field stays editable" safe to promise: the record
-- can be corrected, but the version a patient answered against can never be
-- rewritten underneath them.
-- ─────────────────────────────────────────────────────────────

create or replace function public.reject_published_version_edit()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null then
    raise exception
      'Version % is published and cannot be edited. Create a new version instead.',
      old.version;
  end if;
  return new;
end $$;

drop trigger if exists form_version_immutable on public.form_version;
create trigger form_version_immutable
  before update on public.form_version
  for each row execute function public.reject_published_version_edit();

drop trigger if exists ruleset_version_immutable on public.ruleset_version;
create trigger ruleset_version_immutable
  before update on public.ruleset_version
  for each row execute function public.reject_published_version_edit();
