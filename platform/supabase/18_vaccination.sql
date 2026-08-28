-- ============================================================
-- 18 — Vaccination record
--
-- §27 and §29.5. Built as a general vaccination engine rather than a flu one,
-- because §28.2 is explicit that COVID, hepatitis, shingles, varicella and the
-- rest run through the same machinery. Nothing here names a disease.
--
-- THE SNAPSHOT RULE is the reason most of these columns exist. Vaccine name,
-- batch number, expiry, pharmacist name and registration number are copied into
-- the completed record. A batch renumbered in 2027 must not retroactively
-- change what went into someone's arm in 2026, and a pharmacist who later
-- re-registers must not rewrite the number that was current on the day.
--
-- Safe to run more than once.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'injection_type') then
    create type public.injection_type as enum
      ('INTRAMUSCULAR', 'SUBCUTANEOUS', 'SUBDERMAL');
  end if;

  if not exists (select 1 from pg_type where typname = 'administration_site') then
    create type public.administration_site as enum (
      'RIGHT_DELTOID', 'LEFT_DELTOID', 'RIGHT_THIGH', 'LEFT_THIGH',
      'ORAL', 'NASAL', 'TOPICAL', 'SELF_INJECTION'
    );
  end if;
end
$$;

create table if not exists public.vaccine_administration (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisation(id),
  submission_id                 uuid references public.submission(id),
  consultation_id               uuid references public.consultation(id),
  patient_id                    uuid not null references public.patient(id),
  branch_id                     uuid not null references public.branch(id),
  clinician_id                  uuid not null references public.clinician(id),
  product_id                    uuid not null references public.product(id),
  batch_id                      uuid not null references public.batch(id),

  -- Snapshots — §29.5
  clinician_name_snapshot       text not null,
  registration_number_snapshot  text not null,
  vaccine_name_snapshot         text not null,
  batch_number_snapshot         text not null,
  expiry_date_snapshot          date not null,

  administered_on               date not null,
  -- Null for oral, nasal and topical: §27.4 forbids demanding an injection
  -- type where nothing is injected.
  injection_type                public.injection_type,
  site                          public.administration_site not null,
  payment_type                  text,
  adverse_reaction              text,
  notes                         text,
  completed_at                  timestamptz not null default now(),
  created_at                    timestamptz not null default now(),

  -- The route rule, enforced by the database as well as the application, so a
  -- future screen cannot write a nasal spray as intramuscular.
  constraint vaccine_admin_route_check check (
    (site in ('ORAL', 'NASAL', 'TOPICAL') and injection_type is null)
    or (site not in ('ORAL', 'NASAL', 'TOPICAL') and injection_type is not null)
  )
);

create index if not exists vaccine_admin_patient_idx
  on public.vaccine_administration (patient_id, administered_on);
create index if not exists vaccine_admin_branch_idx
  on public.vaccine_administration (branch_id, administered_on);
create index if not exists vaccine_admin_batch_idx
  on public.vaccine_administration (batch_id);

-- One vaccination per questionnaire. A double-submitted form must not produce
-- two records of the same dose, which would also deduct stock twice.
create unique index if not exists vaccine_admin_submission_idx
  on public.vaccine_administration (submission_id)
  where submission_id is not null;

alter table public.vaccine_administration enable row level security;

-- ── Pharmacist declarations — §26.4 ─────────────────────────
--
-- A row per statement rather than one boolean. "The pharmacist confirmed four
-- things" and "the pharmacist ticked a box" are different claims, and only the
-- first survives being asked about later.

create table if not exists public.clinician_declaration (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisation(id),
  submission_id              uuid references public.submission(id),
  administration_id          uuid references public.vaccine_administration(id),
  clinician_id               uuid references public.clinician(id),
  -- Stable key, so reporting survives a rewording.
  declaration_key            text not null,
  declaration_text_snapshot  text not null,
  confirmed                  boolean not null default true,
  confirmed_at               timestamptz not null default now()
);

create index if not exists clinician_declaration_admin_idx
  on public.clinician_declaration (administration_id);
create index if not exists clinician_declaration_submission_idx
  on public.clinician_declaration (submission_id);

alter table public.clinician_declaration enable row level security;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_name = 'vaccine_administration')                  as administration_table,
  (select count(*) from information_schema.tables
    where table_name = 'clinician_declaration')                   as declaration_table,
  (select count(*) from pg_constraint
    where conname = 'vaccine_admin_route_check')                  as route_rule,
  (select count(*) from pg_indexes
    where indexname = 'vaccine_admin_submission_idx')             as one_per_questionnaire,
  (select count(*) from pg_type where typname = 'administration_site') as site_enum;
