-- ============================================================
-- 14 — Prescription numbering
--
-- The number was built from a UUID:
--
--     parseInt(consultationId.replace(/\D/g,'').slice(0,6) || '1') % 1000000
--
-- Digits pulled out of an id, truncated to six, then modulo a million. Two
-- consultations whose ids happen to start with the same digits produce the
-- SAME prescription number, and a prescription number is how a pharmacy refers
-- to a supply afterwards — on a query, a recall, an audit.
--
-- Replaced with a real sequence: per branch, per year, allocated atomically by
-- the database and protected by a unique constraint. A number is allocated once
-- and then belongs to that consultation permanently.
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── The counter ─────────────────────────────────────────────
--
-- One row per branch per year. `next_value` is the number the NEXT allocation
-- will take.

create table if not exists public.prescription_sequence (
  organisation_id uuid not null references public.organisation(id),
  branch_id       uuid not null references public.branch(id),
  year            integer not null,
  next_value      integer not null default 1,
  primary key (branch_id, year)
);

alter table public.prescription_sequence enable row level security;

-- ── The allocated number, on the consultation ───────────────

alter table public.consultation
  add column if not exists prescription_number text;

-- Unique per organisation. The number is the pharmacy's external reference, so
-- two consultations sharing one is exactly the failure this migration exists to
-- prevent — the constraint makes it impossible rather than unlikely.
create unique index if not exists consultation_prescription_number_idx
  on public.consultation (organisation_id, prescription_number)
  where prescription_number is not null;

-- ── Allocation ──────────────────────────────────────────────
--
-- SECURITY DEFINER so the counter cannot be written directly by application
-- code — the only way to move it is to allocate a number.
--
-- The INSERT ... ON CONFLICT DO UPDATE is the atomic step: concurrent callers
-- serialise on the primary key, each gets a distinct value, and no caller can
-- read a number another has already taken. A read-then-write would hand two
-- pharmacists the same number on a busy afternoon.

create or replace function public.allocate_prescription_number(
  p_consultation_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid;
  v_branch     uuid;
  v_code       text;
  v_year       integer;
  v_seq        integer;
  v_existing   text;
  v_number     text;
begin
  select c.organisation_id, c.branch_id, c.prescription_number,
         b.code, extract(year from coalesce(c.completed_at, now()))::int
    into v_org, v_branch, v_existing, v_code, v_year
    from public.consultation c
    join public.branch b on b.id = c.branch_id
   where c.id = p_consultation_id;

  if v_org is null then
    raise exception 'Consultation % does not exist', p_consultation_id;
  end if;

  -- Already numbered. Allocation is idempotent: a reprint must not burn a new
  -- number, or the same supply ends up with two references.
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.prescription_sequence (organisation_id, branch_id, year, next_value)
       values (v_org, v_branch, v_year, 2)
  on conflict (branch_id, year)
    do update set next_value = public.prescription_sequence.next_value + 1
    returning next_value - 1 into v_seq;

  v_number := upper(v_code) || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  update public.consultation
     set prescription_number = v_number
   where id = p_consultation_id;

  return v_number;
end;
$$;

revoke all on function public.allocate_prescription_number(uuid) from public;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_name = 'prescription_sequence')                        as sequence_table,
  (select count(*) from information_schema.columns
    where table_name = 'consultation' and column_name = 'prescription_number') as number_column,
  (select count(*) from pg_indexes
    where indexname = 'consultation_prescription_number_idx')          as unique_guard,
  (select count(*) from pg_proc
    where proname = 'allocate_prescription_number')                    as allocator;
