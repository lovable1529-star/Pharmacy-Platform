-- ============================================================
-- 11 — Running the day
--
-- Four things the system could not express:
--
--   · when a patient actually arrived, so waiting time is measurable
--   · whether a reminder has gone out, so it goes out once
--   · a correction to a consultation that is already complete
--   · a queue for messages that leave by a channel other than email
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── 1. Arrival time ─────────────────────────────────────────
--
-- The status told us someone HAD arrived, never WHEN. His GLP-1 document names
-- the problem directly: patients "needing to wait for 20 mins, if the
-- pharmacist is already in another consultation". Nothing could measure that,
-- so nothing could improve it.

alter table public.appointment
  add column if not exists arrived_at timestamptz;

-- Backfill what we can. For appointments already marked arrived, updated_at is
-- the closest thing to a check-in time we have. Approximate and better than
-- null, which would read as "never arrived".
update public.appointment
   set arrived_at = updated_at
 where status in ('ARRIVED', 'COMPLETED')
   and arrived_at is null;

-- ── 2. Reminders ────────────────────────────────────────────
--
-- Recorded on the appointment rather than inferred from the mail log, so a
-- reminder is sent exactly once even if the job runs twice.

alter table public.appointment
  add column if not exists reminder_sent_at timestamptz;

create index if not exists appointment_reminder_idx
  on public.appointment (starts_at)
  where reminder_sent_at is null and status = 'BOOKED';

-- ── 3. Consultation addenda ─────────────────────────────────
--
-- A completed consultation is immutable: the answers behind an administered
-- vaccine are the justification for having administered it, and editing them
-- afterwards rewrites history.
--
-- But "we recorded the wrong batch and noticed an hour later" is a real event
-- that must be correctable, and a recall list built from a wrong batch number
-- is dangerous. So a correction is APPENDED, never applied in place — the
-- original record and the correction both stand, which is how clinical
-- amendment works on paper.

create table if not exists public.consultation_addendum (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisation(id),
  consultation_id uuid not null references public.consultation(id),
  user_id         uuid references public.app_user(id),
  /** Free text: what was wrong and what it should have said. */
  reason          text not null,
  /** Structured corrections, where the correction maps to known fields. */
  corrections     jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

create index if not exists consultation_addendum_idx
  on public.consultation_addendum (consultation_id, occurred_at desc);

alter table public.consultation_addendum enable row level security;

-- ── 4. Notification outbox ──────────────────────────────────
--
-- Email goes out through Resend today. His briefs also ask for WhatsApp alerts
-- to the pharmacist and SMS reminders to patients, and both need credentials
-- that do not exist yet.
--
-- Rather than build those later and change how sending works, everything is
-- queued here first and a channel adapter drains it. Adding Twilio then means
-- writing one adapter, not rewiring every call site — and until it exists, the
-- messages still queue rather than vanish, so nothing is silently lost.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type public.notification_channel as enum ('EMAIL', 'SMS', 'WHATSAPP');
  end if;
  if not exists (select 1 from pg_type where typname = 'notification_status') then
    create type public.notification_status as enum
      ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNAVAILABLE');
  end if;
end$$;

create table if not exists public.notification (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisation(id),
  channel         public.notification_channel not null,
  /** Email address or E.164 number, depending on channel. */
  recipient       text not null,
  /** Which message this is — appointment_reminder, repeat_request, etc. */
  template        text not null,
  subject         text,
  body            text not null,
  /** What it concerns, so a failure can be traced back to a patient. */
  entity_type     text,
  entity_id       uuid,
  status          public.notification_status not null default 'QUEUED',
  attempts        integer not null default 0,
  last_error      text,
  scheduled_for   timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists notification_due_idx
  on public.notification (scheduled_for)
  where status = 'QUEUED';

create index if not exists notification_entity_idx
  on public.notification (entity_type, entity_id);

alter table public.notification enable row level security;

-- ── 5. GP send tracking ─────────────────────────────────────
--
-- He asked to "exclude previously sent records" when batching to a practice,
-- and to resend a single record historically after a correction. Both need the
-- send to be recorded against the consultation rather than inferred.

alter table public.consultation
  add column if not exists gp_notified_at timestamptz;

alter table public.consultation
  add column if not exists gp_notify_count integer not null default 0;

create index if not exists consultation_gp_pending_idx
  on public.consultation (organisation_id, completed_at)
  where gp_notified_at is null;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name = 'appointment' and column_name = 'arrived_at')        as arrived_at,
  (select count(*) from information_schema.columns
    where table_name = 'appointment' and column_name = 'reminder_sent_at')  as reminder_col,
  (select count(*) from information_schema.tables
    where table_name = 'consultation_addendum')                             as addendum_table,
  (select count(*) from information_schema.tables
    where table_name = 'notification')                                      as outbox_table,
  (select count(*) from information_schema.columns
    where table_name = 'consultation' and column_name = 'gp_notified_at')   as gp_tracking;
