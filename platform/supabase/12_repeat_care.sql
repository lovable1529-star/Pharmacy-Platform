-- ============================================================
-- 12 — Repeat Care enrolment
--
-- His GLP-1 workflow starts here and the system had no step for it:
--
--   "1. Onboarding: Pharmacist authorises patient into Repeat Care
--    (baseline record created).
--    2. Access: Patient starts repeat request with Pharmadoctor ID + email."
--
-- Without a baseline there is nothing for the repeat rules to compare against.
-- Half his decision logic is relative — "weight loss >= 2% of previous weight",
-- "at least 3 weeks on current dose", "no skipping strengths" — and all of it
-- needs a known starting point and a known current strength.
--
-- Enrolment is also the safety gate. His first rule is that a patient not in
-- the Repeat Care database is redirected to booking rather than served, which
-- is what stops somebody who has never been assessed requesting a GLP-1 online.
--
-- Safe to run more than once.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'repeat_enrolment_status') then
    create type public.repeat_enrolment_status as enum ('ACTIVE', 'PAUSED', 'STOPPED');
  end if;
end$$;

create table if not exists public.repeat_enrolment (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisation(id),
  patient_id         uuid not null references public.patient(id),
  service_id         uuid not null references public.service(id),

  status             public.repeat_enrolment_status not null default 'ACTIVE',

  /** Their id in Pharmadoctor, which is how he identifies these patients. */
  external_ref       text,

  -- ── Baseline ────────────────────────────────────────────
  -- Captured once at onboarding. Height rarely changes and is pre-filled into
  -- the repeat form; starting weight is what progress is measured against.
  height_cm          numeric(5,1),
  starting_weight_kg numeric(5,1),
  starting_waist_cm  numeric(5,1),

  -- ── Current treatment ───────────────────────────────────
  -- Updated on each approved supply. The repeat form pre-fills from here and
  -- the dose rules are enforced against it: same or one step, never a jump.
  medicine           text,
  strength           text,
  /** When they started the CURRENT strength — the 3-week and 6-week rules. */
  strength_since     date,
  last_supplied_at   timestamptz,
  last_weight_kg     numeric(5,1),

  notes              text,
  enrolled_by        uuid references public.app_user(id),
  enrolled_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One live enrolment per patient per service. A patient enrolled twice would
-- have two baselines, and the rules would silently pick whichever came back
-- first.
create unique index if not exists repeat_enrolment_unique_idx
  on public.repeat_enrolment (patient_id, service_id);

create index if not exists repeat_enrolment_org_idx
  on public.repeat_enrolment (organisation_id, status);

alter table public.repeat_enrolment enable row level security;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_name = 'repeat_enrolment')                       as table_created,
  (select count(*) from pg_indexes
    where indexname = 'repeat_enrolment_unique_idx')             as one_per_patient;
