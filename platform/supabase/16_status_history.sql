-- ============================================================
-- 16 — Status history and the two states the machine needed
--
-- The specification is emphatic that a status must never simply be overwritten.
-- §16.4 lists status, pharmacist decisions, signatures and rejection reasons
-- among the values that must not be silently replaced, and §7.5 asks for the
-- transitions themselves as a readable table.
--
-- Until now each status lived in one column and every write destroyed what was
-- there before. The audit log recorded that something changed; the clinical
-- question — what path did this case actually take — could only be inferred.
--
-- One table for every entity with a lifecycle rather than one per entity: the
-- questions asked of it are identical in each case, and a rejection on an
-- appointment reads exactly like a rejection on a submission.
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── Two states the pathway needs ────────────────────────────
--
-- RESUBMITTED so a rejected case can come back corrected (§7.4) WITHOUT the
-- approval overwriting the rejection — the record has to keep both.
--
-- CANCELLED so a request can be stopped outright without pretending it was
-- rejected on clinical grounds, which would put a decision in the record that
-- no pharmacist ever made.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PostgreSQL, and IF NOT EXISTS makes the whole statement a no-op on a second
-- run, so these sit outside the transaction below.

commit;

alter type public.submission_status add value if not exists 'RESUBMITTED';
alter type public.submission_status add value if not exists 'CANCELLED';

begin;

-- ── Which kinds of record have a lifecycle ──────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_entity') then
    create type public.status_entity as enum (
      'SUBMISSION', 'APPOINTMENT', 'CONSULTATION', 'PRESCRIPTION'
    );
  end if;
end
$$;

-- ── The history ─────────────────────────────────────────────

create table if not exists public.status_history (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisation(id),
  entity_type       public.status_entity not null,
  entity_id         uuid not null,
  -- Null on the first entry: nothing preceded the record existing.
  from_status       text,
  to_status         text not null,
  -- Null where the actor is the patient or the system. Both are real actors and
  -- neither is an app_user, which is why the label below is what is required.
  changed_by        uuid references public.app_user(id),
  changed_by_label  text not null,
  -- Required by §7.3 for a rejection; optional elsewhere.
  reason            text,
  branch_id         uuid references public.branch(id),
  created_at        timestamptz not null default now()
);

create index if not exists status_history_entity_idx
  on public.status_history (entity_type, entity_id, created_at);

create index if not exists status_history_org_idx
  on public.status_history (organisation_id, created_at);

alter table public.status_history enable row level security;

-- Append-only. A history that can be edited answers nothing, and the whole
-- point of the table is that it is the record of what happened rather than a
-- convenience cache of it.
do $$
begin
  if not exists (
    select 1 from pg_policy
     where polname = 'status_history_no_update'
       and polrelid = 'public.status_history'::regclass
  ) then
    create policy status_history_no_update on public.status_history
      for update using (false);
  end if;

  if not exists (
    select 1 from pg_policy
     where polname = 'status_history_no_delete'
       and polrelid = 'public.status_history'::regclass
  ) then
    create policy status_history_no_delete on public.status_history
      for delete using (false);
  end if;
end
$$;

commit;

-- ── Backfill ────────────────────────────────────────────────
--
-- Every existing submission gets one opening entry so nothing has an empty
-- timeline. It is deliberately honest about what it does not know: the current
-- status is recorded as the starting point, attributed to a migration rather
-- than to a person, because the path each record actually took was not being
-- captured and inventing one would be worse than admitting the gap.

insert into public.status_history
  (organisation_id, entity_type, entity_id, from_status, to_status,
   changed_by, changed_by_label, reason, branch_id, created_at)
select s.organisation_id,
       'SUBMISSION',
       s.id,
       null,
       s.status::text,
       null,
       'Migration',
       'State before status history was recorded',
       s.branch_id,
       coalesce(s.submitted_at, s.updated_at, s.created_at)
  from public.submission s
 where not exists (
   select 1 from public.status_history h
    where h.entity_type = 'SUBMISSION' and h.entity_id = s.id
 );

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_name = 'status_history')                         as history_table,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'submission_status'
      and e.enumlabel in ('RESUBMITTED', 'CANCELLED'))           as new_states,
  (select count(*) from public.status_history)                   as rows_backfilled,
  (select count(*) from public.submission s
    where not exists (select 1 from public.status_history h
                       where h.entity_type = 'SUBMISSION' and h.entity_id = s.id))
                                                                 as submissions_without_history;
