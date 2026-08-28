-- ============================================================
-- 19 — Prescription lifecycle, documents, consent, GP notifications
--
-- §8, §10, §18, §8A, §8.6 and §6.3.
--
-- A prescription was a PDF generated on demand, with its number written onto
-- the consultation. The specification treats it as a record with a lifecycle —
-- raised, paid for, issued, routed to a branch, dispensed, collected — each
-- step with a person and a time against it. Payment status is deliberately
-- independent of prescription status, because §8.1 says so and because "paid"
-- and "issued" genuinely are different facts.
--
-- Safe to run more than once.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prescription_status') then
    create type public.prescription_status as enum
      ('PENDING_PAYMENT', 'ISSUED', 'DISPENSED', 'COLLECTED', 'CANCELLED');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_category') then
    create type public.document_category as enum (
      'CONSULTATION_RECORD', 'PRESCRIPTION', 'APPROVAL_RECORD',
      'REJECTION_RECORD', 'PATIENT_EVIDENCE', 'TREATMENT_REVIEW', 'VACCINATION_RECORD'
    );
  end if;
end
$$;

-- ── Prescription ────────────────────────────────────────────

create table if not exists public.prescription (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisation(id),
  submission_id                 uuid references public.submission(id),
  consultation_id               uuid references public.consultation(id),
  patient_id                    uuid not null references public.patient(id),
  branch_id                     uuid not null references public.branch(id),
  clinician_id                  uuid references public.clinician(id),
  medicine_id                   uuid references public.medicine(id),
  number                        text,
  status                        public.prescription_status not null default 'PENDING_PAYMENT',

  -- Snapshots. A price list or a medicine renamed next year must not change
  -- what a prescription issued today says it was for.
  medicine_name_snapshot        text not null,
  strength_snapshot             text,
  quantity                      text,
  directions                    text,
  price_minor_snapshot          integer,
  clinician_name_snapshot       text,
  registration_number_snapshot  text,
  signature_snapshot            text,

  paid_online                   boolean not null default false,
  issued_at                     timestamptz,
  document_url                  text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists prescription_patient_idx
  on public.prescription (patient_id, created_at);
create index if not exists prescription_branch_idx
  on public.prescription (branch_id, status);

-- The number is the pharmacy's external reference, so two prescriptions
-- sharing one is exactly the failure migration 14 exists to prevent.
create unique index if not exists prescription_number_idx
  on public.prescription (organisation_id, number)
  where number is not null;

alter table public.prescription enable row level security;

-- ── Sign-offs ───────────────────────────────────────────────
-- One each per prescription: a second dispensing signature on the same supply
-- would mean one of them is describing something that did not happen.

create table if not exists public.dispensing_signoff (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisation(id),
  prescription_id               uuid not null references public.prescription(id),
  clinician_id                  uuid not null references public.clinician(id),
  clinician_name_snapshot       text not null,
  registration_number_snapshot  text not null,
  patient_spoken_to             boolean not null default false,
  notes                         text,
  signed_at                     timestamptz not null default now()
);

create unique index if not exists dispensing_signoff_prescription_idx
  on public.dispensing_signoff (prescription_id);
alter table public.dispensing_signoff enable row level security;

create table if not exists public.collection_signoff (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisation(id),
  prescription_id    uuid not null references public.prescription(id),
  collected_by_name  text not null,
  -- Not always the patient: a relative may collect.
  is_patient         boolean not null default true,
  signature_url      text,
  collected_at       timestamptz not null default now()
);

create unique index if not exists collection_signoff_prescription_idx
  on public.collection_signoff (prescription_id);
alter table public.collection_signoff enable row level security;

-- ── Document register — §10 ─────────────────────────────────

create table if not exists public.document (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  category         public.document_category not null,
  patient_id       uuid references public.patient(id),
  submission_id    uuid references public.submission(id),
  consultation_id  uuid references public.consultation(id),
  prescription_id  uuid references public.prescription(id),
  appointment_id   uuid,
  title            text not null,
  -- An object key in the private bucket. §16.2: never a public URL.
  storage_path     text not null,
  mime_type        text,
  size_bytes       integer,
  created_by       uuid references public.app_user(id),
  created_at       timestamptz not null default now()
);

create index if not exists document_patient_idx on public.document (patient_id, created_at);
create index if not exists document_category_idx on public.document (organisation_id, category);
alter table public.document enable row level security;

-- ── Consent as a record — §8A, §25.6 ────────────────────────

create table if not exists public.consent_record (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisation(id),
  patient_id               uuid references public.patient(id),
  submission_id            uuid references public.submission(id),
  consent_version          text not null,
  -- The wording itself, so what was agreed to stays provable without
  -- reconstructing it from a form version.
  consent_text_snapshot    text not null,
  accepted                 boolean not null default true,
  privacy_policy_version   text,
  privacy_acknowledged     boolean not null default false,
  captured_by              text not null,
  accepted_at              timestamptz not null default now()
);

create index if not exists consent_record_patient_idx
  on public.consent_record (patient_id, accepted_at);
create index if not exists consent_record_submission_idx
  on public.consent_record (submission_id);
alter table public.consent_record enable row level security;

-- ── GP notification log — §8.6 ──────────────────────────────
--
-- The consultation carried one `gp_notified_at` column, which can record that
-- something was sent but not that it failed, nor that it was sent twice, nor
-- what happened the second time.

create table if not exists public.gp_notification (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisation(id),
  consultation_id      uuid references public.consultation(id),
  administration_id    uuid references public.vaccine_administration(id),
  gp_surgery_id        uuid references public.gp_surgery(id),
  recipient_snapshot   text not null,
  status               text not null,
  error_message        text,
  batch_ref            text,
  sent_at              timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists gp_notification_consultation_idx
  on public.gp_notification (consultation_id);
create index if not exists gp_notification_created_idx
  on public.gp_notification (organisation_id, created_at);
alter table public.gp_notification enable row level security;

-- ── Urgent queue — §6.3 ─────────────────────────────────────

create table if not exists public.urgent_task (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  submission_id    uuid references public.submission(id),
  patient_id       uuid references public.patient(id),
  branch_id        uuid references public.branch(id),
  reason           text not null,
  resolved_at      timestamptz,
  resolved_by      uuid references public.app_user(id),
  resolution_note  text,
  created_at       timestamptz not null default now()
);

-- Partial index: the queue is only ever read for what is still open.
create index if not exists urgent_task_open_idx
  on public.urgent_task (organisation_id, created_at)
  where resolved_at is null;

alter table public.urgent_task enable row level security;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables where table_name = 'prescription')        as prescription,
  (select count(*) from information_schema.tables where table_name = 'dispensing_signoff')  as dispensing,
  (select count(*) from information_schema.tables where table_name = 'collection_signoff')  as collection,
  (select count(*) from information_schema.tables where table_name = 'document')            as documents,
  (select count(*) from information_schema.tables where table_name = 'consent_record')      as consent,
  (select count(*) from information_schema.tables where table_name = 'gp_notification')     as gp_log,
  (select count(*) from information_schema.tables where table_name = 'urgent_task')         as urgent;
