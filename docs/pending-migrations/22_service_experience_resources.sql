-- ============================================================
-- 22 — Service modality, standalone public branding and patient resources
--
-- Target requirement date: 30 August 2026
--
-- The client now has appointment-led Flu and non-F2F Weight Management. Booking
-- modality therefore cannot be inferred from service.kind. The public Weight
-- Management clinic also needs branding separate from Karsons fulfilment, and
-- patient resources must be client-configurable and provably acknowledged.
--
-- Run AFTER 21_remote_weight_management_workflow.sql.
-- Safe to run more than once.
-- ============================================================

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Booking modality is a service setting, not a service type
-- ─────────────────────────────────────────────────────────────
-- REQUIRED = normal appointment-led service
-- OPTIONAL = appointment supported but walk-ins are also valid (Flu)
-- NONE     = do not offer internal booking (both WM journeys)

alter table public.service
  add column if not exists booking_mode text not null default 'OPTIONAL';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_booking_mode_check'
  ) then
    alter table public.service
      add constraint service_booking_mode_check
      check (booking_mode in ('REQUIRED', 'OPTIONAL', 'NONE'));
  end if;
end
$$;

-- Apply the latest client direction to the current configured services.
update public.service
   set booking_mode = 'OPTIONAL'
 where slug = 'flu-vaccination';

update public.service
   set booking_mode = 'NONE',
       name = case
         when slug = 'weight-management-first' then 'Weight Management — New Patient'
         else name
       end,
       description = case
         when slug = 'weight-management-first'
           then 'Remote new-patient onboarding and prescribing request. No routine face-to-face appointment.'
         when slug = 'weight-management-repeat'
           then 'Remote repeat-prescription request for patients already onboarded with the clinic.'
         else description
       end
 where slug in ('weight-management-first', 'weight-management-repeat');

create index if not exists service_booking_mode_idx
  on public.service (organisation_id, booking_mode)
  where archived_at is null;

-- ─────────────────────────────────────────────────────────────
-- 2. Public service profile / standalone clinic branding
-- ─────────────────────────────────────────────────────────────

create table if not exists public.service_public_profile (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisation(id),
  service_id            uuid not null references public.service(id),

  public_brand_name     text,
  logo_storage_path     text,
  primary_colour        text,
  secondary_colour      text,
  support_email         text,
  support_phone         text,

  privacy_url           text,
  terms_url             text,
  f2f_referral_url      text,

  -- Allows the public clinic to be branded separately while the legal/physical
  -- fulfilment is still performed by Karsons.
  fulfilment_name       text,

  active                boolean not null default true,
  updated_by            uuid references public.app_user(id),
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create unique index if not exists service_public_profile_service_idx
  on public.service_public_profile (service_id);

alter table public.service_public_profile enable row level security;

drop policy if exists service_public_profile_tenant_isolation
  on public.service_public_profile;
create policy service_public_profile_tenant_isolation
  on public.service_public_profile
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

-- Seed only the fulfilment identity. The actual standalone clinic name/logo and
-- public URLs are still awaiting the client's final brand assets/content.
insert into public.service_public_profile
  (organisation_id, service_id, fulfilment_name)
select s.organisation_id, s.id, 'Karsons Pharmacy'
  from public.service s
 where s.slug in ('weight-management-first', 'weight-management-repeat')
on conflict (service_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3. Versioned/configurable patient resource library
-- ─────────────────────────────────────────────────────────────

create table if not exists public.patient_resource (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisation(id),
  service_id               uuid not null references public.service(id),
  medicine_id              uuid references public.medicine(id),

  resource_key             text not null,
  version                  integer not null default 1,
  title                    text not null,
  description              text,
  url                      text not null,

  display_stage            text not null default 'BOTH',
  requires_acknowledgement boolean not null default true,
  sort_order               integer not null default 0,
  active                   boolean not null default true,

  created_by               uuid references public.app_user(id),
  created_at               timestamptz not null default now(),
  archived_at              timestamptz,

  constraint patient_resource_stage_check
    check (display_stage in ('BEFORE_SUBMISSION', 'AFTER_RX', 'BOTH')),
  constraint patient_resource_version_check
    check (version > 0)
);

create unique index if not exists patient_resource_key_version_idx
  on public.patient_resource (service_id, resource_key, version);

create index if not exists patient_resource_active_idx
  on public.patient_resource (service_id, medicine_id, sort_order)
  where active = true and archived_at is null;

alter table public.patient_resource enable row level security;

drop policy if exists patient_resource_tenant_isolation
  on public.patient_resource;
create policy patient_resource_tenant_isolation
  on public.patient_resource
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

-- Snapshot the exact resource/version/link the patient acknowledged. This is
-- separate from consent_record because these are educational resources rather
-- than the legal consent text itself.
create table if not exists public.resource_acknowledgement (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisation(id),
  patient_id               uuid references public.patient(id),
  submission_id            uuid not null references public.submission(id),
  resource_id              uuid references public.patient_resource(id),

  resource_key_snapshot    text not null,
  resource_version_snapshot integer not null,
  title_snapshot           text not null,
  url_snapshot             text not null,

  acknowledged             boolean not null default true,
  acknowledged_at          timestamptz not null default now()
);

create unique index if not exists resource_ack_submission_key_idx
  on public.resource_acknowledgement
    (submission_id, resource_key_snapshot, resource_version_snapshot);

create index if not exists resource_ack_patient_idx
  on public.resource_acknowledgement (patient_id, acknowledged_at desc);

alter table public.resource_acknowledgement enable row level security;

drop policy if exists resource_acknowledgement_tenant_isolation
  on public.resource_acknowledgement;
create policy resource_acknowledgement_tenant_isolation
  on public.resource_acknowledgement
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

-- Acknowledgements are clinical evidence and are not hard-deleted.
drop trigger if exists resource_acknowledgement_no_delete
  on public.resource_acknowledgement;
create trigger resource_acknowledgement_no_delete
  before delete on public.resource_acknowledgement
  for each row execute function public.reject_clinical_delete();

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'service'
      and column_name = 'booking_mode')                         as booking_mode,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'service_public_profile')
                                                                 as public_profile,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_resource')
                                                                 as resources,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'resource_acknowledgement')
                                                                 as acknowledgements;
