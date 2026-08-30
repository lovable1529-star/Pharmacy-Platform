-- ============================================================
-- 21 — Remote Weight Management workflow + payment audit + fulfilment
--
-- Target requirement date: 30 August 2026
--
-- Adds only the structured records that the new remote workflow genuinely
-- needs. Existing submission answers, review_event, rule_evaluation,
-- prescription, document and urgent_task remain the source records for the
-- data they already model well.
--
-- Run AFTER 20_inventory_notifications.sql.
-- Safe to run more than once.
-- ============================================================

-- A manually verified payment is not necessarily "cash at the till". The
-- current product phase explicitly uses a staff confirmation instead of a live
-- payment-provider webhook, so give that settlement source an honest value.
alter type public.payment_provider add value if not exists 'MANUAL';

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Queue ownership / SLA on submissions
-- ─────────────────────────────────────────────────────────────
-- These are deliberately generic, not Weight-Management-specific. Flu or any
-- future service can use the same assignment and due-time model.

alter table public.submission
  add column if not exists assigned_to uuid references public.app_user(id);

alter table public.submission
  add column if not exists review_due_at timestamptz;

create index if not exists submission_assigned_queue_idx
  on public.submission (organisation_id, assigned_to, status, submitted_at);

create index if not exists submission_review_due_idx
  on public.submission (organisation_id, review_due_at)
  where review_due_at is not null
    and status in ('SUBMITTED', 'IN_REVIEW', 'RESUBMITTED', 'INFO_REQUESTED');

-- ─────────────────────────────────────────────────────────────
-- 2. Manual payment-confirmation audit
-- ─────────────────────────────────────────────────────────────
-- paid_at remains the financial event. confirmed_by says which logged-in staff
-- member asserted that the money had been received during the manual phase.
-- audit_event should ALSO be written by the server action.

alter table public.payment
  add column if not exists confirmed_by uuid references public.app_user(id);

alter table public.payment
  add column if not exists confirmation_note text;

create index if not exists payment_confirmed_by_idx
  on public.payment (confirmed_by, paid_at)
  where confirmed_by is not null;

-- A prescription can be directly tied to the settlement that released it.
-- History remains available through submission_id as well.
alter table public.prescription
  add column if not exists payment_id uuid references public.payment(id);

create unique index if not exists prescription_payment_unique_idx
  on public.prescription (payment_id)
  where payment_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 3. Structured clinical contact / verification call log
-- ─────────────────────────────────────────────────────────────
-- NEW Weight Management requires a pharmacist call before approval. This is a
-- generic contact-event table rather than a one-off "wm_call" table so later
-- pharmacist calls, repeat AMBER contacts and other services use one audit
-- model.

create table if not exists public.clinical_contact_event (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisation(id),
  submission_id         uuid references public.submission(id),
  patient_id            uuid references public.patient(id),
  clinician_id          uuid references public.clinician(id),
  created_by            uuid references public.app_user(id),

  channel               text not null default 'PHONE',
  direction             text not null default 'OUTBOUND',
  purpose               text not null,
  outcome               text not null,

  identity_verified     boolean not null default false,
  verification_data     jsonb not null default '{}'::jsonb,
  clinical_findings     text,
  advice_given          text,
  notes                 text,
  follow_up_required    boolean not null default false,

  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),

  constraint clinical_contact_channel_check
    check (channel in ('PHONE', 'EMAIL', 'SMS', 'WHATSAPP', 'IN_PERSON')),
  constraint clinical_contact_direction_check
    check (direction in ('OUTBOUND', 'INBOUND')),
  constraint clinical_contact_outcome_check
    check (outcome in (
      'COMPLETED', 'NO_ANSWER', 'VOICEMAIL', 'CALLBACK_REQUESTED',
      'FAILED', 'INFO_REQUIRED', 'ESCALATED'
    )),
  constraint clinical_contact_completion_check
    check (
      (outcome = 'COMPLETED' and completed_at is not null)
      or outcome <> 'COMPLETED'
    )
);

create index if not exists clinical_contact_submission_idx
  on public.clinical_contact_event (submission_id, created_at desc);

create index if not exists clinical_contact_patient_idx
  on public.clinical_contact_event (patient_id, created_at desc);

create index if not exists clinical_contact_purpose_idx
  on public.clinical_contact_event (organisation_id, purpose, created_at desc);

alter table public.clinical_contact_event enable row level security;

drop policy if exists clinical_contact_event_tenant_isolation
  on public.clinical_contact_event;
create policy clinical_contact_event_tenant_isolation
  on public.clinical_contact_event
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

-- Clinical contact history should be corrected with a later event/addendum,
-- not removed. The helper exists from 02_security.sql.
drop trigger if exists clinical_contact_event_no_delete
  on public.clinical_contact_event;
create trigger clinical_contact_event_no_delete
  before delete on public.clinical_contact_event
  for each row execute function public.reject_clinical_delete();

-- ─────────────────────────────────────────────────────────────
-- 4. Prescription fulfilment
-- ─────────────────────────────────────────────────────────────
-- Existing prescription.status stops at DISPENSED/COLLECTED and has no delivery
-- model or mandatory pack batch/expiry. Keep prescription focused on the legal
-- Rx and put physical fulfilment in a one-to-one record.

create table if not exists public.prescription_fulfilment (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisation(id),
  prescription_id            uuid not null references public.prescription(id),

  method                     text not null,
  status                     text not null default 'PENDING',

  -- Mandatory before READY / DISPATCHED / COLLECTED / SUPPLIED.
  batch_number               text,
  expiry_date                date,

  -- Snapshot the destination used for this supply. Do not rely on the current
  -- patient address, which may change after a historical dispatch.
  delivery_address_snapshot  text,
  carrier                    text,
  tracking_number            text,

  prepared_by                uuid references public.app_user(id),
  dispatched_by              uuid references public.app_user(id),
  supplied_by                uuid references public.app_user(id),

  ready_at                   timestamptz,
  dispatched_at              timestamptz,
  supplied_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint prescription_fulfilment_method_check
    check (method in ('COLLECTION', 'DELIVERY')),
  constraint prescription_fulfilment_status_check
    check (status in (
      'PENDING', 'ASSEMBLING', 'READY', 'DISPATCHED',
      'COLLECTED', 'SUPPLIED', 'CANCELLED'
    )),
  constraint prescription_fulfilment_batch_gate_check
    check (
      status not in ('READY', 'DISPATCHED', 'COLLECTED', 'SUPPLIED')
      or (
        batch_number is not null
        and btrim(batch_number) <> ''
        and expiry_date is not null
      )
    ),
  constraint prescription_fulfilment_delivery_gate_check
    check (
      method <> 'DELIVERY'
      or status not in ('DISPATCHED', 'SUPPLIED')
      or (
        delivery_address_snapshot is not null
        and btrim(delivery_address_snapshot) <> ''
      )
    )
);

create unique index if not exists prescription_fulfilment_prescription_idx
  on public.prescription_fulfilment (prescription_id);

create index if not exists prescription_fulfilment_queue_idx
  on public.prescription_fulfilment (organisation_id, status, updated_at);

create index if not exists prescription_fulfilment_tracking_idx
  on public.prescription_fulfilment (tracking_number)
  where tracking_number is not null;

alter table public.prescription_fulfilment enable row level security;

drop policy if exists prescription_fulfilment_tenant_isolation
  on public.prescription_fulfilment;
create policy prescription_fulfilment_tenant_isolation
  on public.prescription_fulfilment
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

-- Enforce the client's "expiry later than the supply date" requirement at the
-- database boundary as well as in the UI/server action.
create or replace function public.validate_prescription_fulfilment()
returns trigger
language plpgsql
as $$
declare
  effective_supply_date date;
begin
  effective_supply_date := coalesce(
    new.supplied_at::date,
    new.dispatched_at::date,
    new.ready_at::date,
    current_date
  );

  if new.status in ('READY', 'DISPATCHED', 'COLLECTED', 'SUPPLIED') then
    if new.expiry_date is null then
      raise exception 'Batch expiry is required before a prescription can be supplied.';
    end if;
    if new.expiry_date <= effective_supply_date then
      raise exception 'Pack expiry (%) must be later than the supply date (%).',
        new.expiry_date, effective_supply_date;
    end if;
  end if;

  if new.method = 'COLLECTION' and new.status = 'DISPATCHED' then
    raise exception 'A collection fulfilment cannot be dispatched.';
  end if;

  if new.method = 'DELIVERY' and new.status = 'COLLECTED' then
    raise exception 'A delivery fulfilment cannot be marked collected.';
  end if;

  return new;
end
$$;

drop trigger if exists prescription_fulfilment_validate
  on public.prescription_fulfilment;
create trigger prescription_fulfilment_validate
  before insert or update on public.prescription_fulfilment
  for each row execute function public.validate_prescription_fulfilment();

-- Clinical fulfilment/supply history is not hard-deleted.
drop trigger if exists prescription_fulfilment_no_delete
  on public.prescription_fulfilment;
create trigger prescription_fulfilment_no_delete
  before delete on public.prescription_fulfilment
  for each row execute function public.reject_clinical_delete();

-- ─────────────────────────────────────────────────────────────
-- 5. GP notification can now point directly at a prescription
-- ─────────────────────────────────────────────────────────────
-- Weight Management GP notification occurs when the paid/authorised Rx is
-- issued. It should not need a fake consultation row just to be traceable.

alter table public.gp_notification
  add column if not exists prescription_id uuid references public.prescription(id);

create index if not exists gp_notification_prescription_idx
  on public.gp_notification (prescription_id, created_at desc)
  where prescription_id is not null;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'submission'
      and column_name = 'assigned_to')                         as submission_assignment,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'payment'
      and column_name = 'confirmed_by')                        as payment_confirmation,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'clinical_contact_event')
                                                               as contact_log,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'prescription_fulfilment')
                                                               as fulfilment,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'gp_notification'
      and column_name = 'prescription_id')                     as gp_rx_link;
