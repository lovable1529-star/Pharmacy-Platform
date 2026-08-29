-- ============================================================
-- 20 — Inventory transaction types and notification templates
--
-- §9 and §15.
--
-- `stock_movement.kind` was free text with its intended values written in a
-- comment above the column, which is a convention rather than a rule — nothing
-- stopped a typo becoming a seventh kind that no report would ever count. The
-- list now lives in lib/inventory/movements.ts, which also owns the direction
-- of each kind and the rule that stock cannot go below zero, and the database
-- refuses anything not on it.
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── §9.2 — who and what it refers to ────────────────────────

alter table public.stock_movement add column if not exists user_id   uuid references public.app_user(id);
alter table public.stock_movement add column if not exists reference text;

create index if not exists stock_movement_kind_idx
  on public.stock_movement (organisation_id, kind, occurred_at);

-- Existing rows use the older vocabulary. Mapped before the constraint is
-- added, so the check below cannot fail on history.
update public.stock_movement set kind = 'RECEIPT'  where kind in ('STOCK_IN', 'IN');
update public.stock_movement set kind = 'WASTE'    where kind in ('STOCK_OUT', 'OUT');

-- The kinds, enforced. Not an enum: this list will grow, and adding a value to
-- an enum is a migration while adding one here is a deploy of the module that
-- already owns the list.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'stock_movement_kind_check'
  ) then
    alter table public.stock_movement drop constraint stock_movement_kind_check;
  end if;

  -- Anything unrecognised is left alone and reported by the verify query at the
  -- bottom rather than silently rewritten. A movement whose meaning we cannot
  -- establish must not be guessed at — it changes a stock count.
  if not exists (
    select 1 from public.stock_movement
     where kind not in (
       'RECEIPT','RETURN_IN','TRANSFER_IN','ADMINISTRATION','TRANSFER_OUT',
       'RETURN_OUT','EXPIRED','DAMAGED','WASTE','ADJUSTMENT'
     )
  ) then
    alter table public.stock_movement
      add constraint stock_movement_kind_check check (kind in (
        'RECEIPT','RETURN_IN','TRANSFER_IN','ADMINISTRATION','TRANSFER_OUT',
        'RETURN_OUT','EXPIRED','DAMAGED','WASTE','ADJUSTMENT'
      ));
  else
    raise notice 'Unrecognised movement kinds present — constraint NOT added. See the verify query.';
  end if;
end
$$;

-- ── §15 — message wording as records ────────────────────────
--
-- `clinical_detail_allowed` is a property of the message, not of the sender:
-- the specification asks that SMS carry no clinical detail and prompt a secure
-- login instead, and a rule held only in the sending code stops being true the
-- moment a second sender exists.

create table if not exists public.notification_template (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisation(id),
  template_key             text not null,
  channel                  text not null,
  subject                  text,
  body                     text not null,
  clinical_detail_allowed  boolean not null default false,
  active                   boolean not null default true,
  updated_at               timestamptz not null default now()
);

create unique index if not exists notification_template_key_idx
  on public.notification_template (organisation_id, template_key, channel);
alter table public.notification_template enable row level security;

commit;

-- ── Seed the six triggers §15 lists ─────────────────────────

do $$
declare
  v_org uuid;
begin
  select id into v_org from public.organisation order by created_at limit 1;
  if v_org is null then return; end if;

  insert into public.notification_template
    (organisation_id, template_key, channel, subject, body, clinical_detail_allowed)
  values
    (v_org, 'appointment.submitted', 'EMAIL', 'We have your form',
     'Thank you — we have received your form. We will be in touch if we need anything else.', true),
    (v_org, 'appointment.approved', 'EMAIL', 'Your request has been approved',
     'Your request has been approved. Please follow the link in this email to continue.', true),
    (v_org, 'appointment.rejected', 'EMAIL', 'About your recent request',
     'We are not able to proceed with your request on this occasion. Please book an appointment so we can talk it through.', true),
    (v_org, 'appointment.info_requested', 'EMAIL', 'We need a little more information',
     'We need one more answer before we can continue. Please follow the link to complete your form.', true),
    (v_org, 'appointment.reminder', 'EMAIL', 'Your appointment tomorrow',
     'This is a reminder about your appointment tomorrow.', true),
    (v_org, 'prescription.ready', 'EMAIL', 'Ready to collect',
     'Your prescription is ready to collect from the pharmacy.', true),
    -- SMS carries no clinical detail, per §15.
    (v_org, 'appointment.reminder', 'SMS', null,
     'Karsons Pharmacy: you have an appointment tomorrow. Reply or call us if you need to change it.', false),
    (v_org, 'appointment.status_changed', 'SMS', null,
     'Karsons Pharmacy: there is an update on your recent request. Please log in to view it securely.', false)
  on conflict (organisation_id, template_key, channel) do nothing;
end
$$;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name = 'stock_movement' and column_name = 'user_id')      as movement_user,
  (select count(*) from pg_constraint
    where conname = 'stock_movement_kind_check')                          as kind_constraint,
  (select count(*) from public.notification_template)                     as templates,
  (select coalesce(string_agg(distinct kind, ', '), 'none') from public.stock_movement
    where kind not in (
      'RECEIPT','RETURN_IN','TRANSFER_IN','ADMINISTRATION','TRANSFER_OUT',
      'RETURN_OUT','EXPIRED','DAMAGED','WASTE','ADJUSTMENT'
    ))                                                                    as unrecognised_kinds;
