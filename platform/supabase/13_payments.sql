-- ============================================================
-- 13 — Payments
--
-- His GLP-1 flow is payment-gated by design: "GREEN/approved AMBER → secure
-- payment link sent. Rx generated after payment." Without a payment step there
-- is no gate, and the demo skips the part of the workflow the pharmacy actually
-- charges for.
--
-- This models payments properly and ships with a DEMO provider that marks an
-- invoice paid on request. That is deliberately a stub, and deliberately an
-- HONEST one: it collects no card details, takes no money, and says on screen
-- that it is a demonstration. Swapping in Stripe later is a new provider
-- against the same table, not a new flow.
--
-- Safe to run more than once.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum
      ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    -- DEMO is a real provider as far as the code is concerned. Keeping it in
    -- the enum rather than as a flag means a demo payment can never be mistaken
    -- for a real one in a report or a reconciliation.
    create type public.payment_provider as enum ('DEMO', 'STRIPE', 'IN_PERSON');
  end if;
end$$;

create table if not exists public.payment (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  submission_id    uuid references public.submission(id),
  patient_id       uuid references public.patient(id),
  branch_id        uuid references public.branch(id),

  /** Integer pence. Never floats — 0.1 + 0.2 has no place near money. */
  amount_minor     integer not null,
  currency         text not null default 'GBP',
  description      text not null,

  status           public.payment_status not null default 'PENDING',
  provider         public.payment_provider not null default 'DEMO',
  /** The provider's own id, once there is one. */
  provider_ref     text,

  /**
   * The unguessable half of the payment link. Same reasoning as the resume
   * token: the patient has no account, so the link is the credential, and it
   * must not be derivable from an invoice number printed on a receipt.
   */
  access_token     text not null,
  expires_at       timestamptz,

  paid_at          timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists payment_token_idx
  on public.payment (access_token);

create index if not exists payment_submission_idx
  on public.payment (submission_id);

create index if not exists payment_org_status_idx
  on public.payment (organisation_id, status, created_at desc);

-- One live payment request per submission. Two would mean a patient could pay
-- twice for one supply, and the second charge is the pharmacy's problem to
-- refund rather than the patient's mistake.
create unique index if not exists payment_one_open_per_submission_idx
  on public.payment (submission_id)
  where status = 'PENDING' and submission_id is not null;

alter table public.payment enable row level security;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_name = 'payment')                            as payment_table,
  (select count(*) from pg_indexes
    where indexname = 'payment_one_open_per_submission_idx') as one_open_per_submission;
