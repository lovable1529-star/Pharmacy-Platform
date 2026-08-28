-- ============================================================
-- 17 — Masters and configuration
--
-- §12 of the specification, plus its standing instruction that anything not
-- confirmable from the recordings "should be configurable in the admin panel
-- rather than hard-coded".
--
-- The medicine master is the one that changes clinical behaviour. The dose
-- ladders were a constant in the source, so adding or correcting a strength
-- meant a code change and a deploy — and "only same or ±1 step" is a safety
-- rule evaluated against exactly that ladder.
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── Medicine master ─────────────────────────────────────────

create table if not exists public.medicine (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  brand            text not null,
  generic_name     text,
  form             text,
  service_id       uuid references public.service(id),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists medicine_org_idx on public.medicine (organisation_id);
create unique index if not exists medicine_brand_idx on public.medicine (organisation_id, brand);
alter table public.medicine enable row level security;

-- ORDER IS THE CLINICAL CONTENT. A step change is the distance between two
-- positions, so `position` is what makes "one step up" answerable at all. The
-- unique index on it stops two strengths claiming the same rung, which would
-- make the distance between them zero.
create table if not exists public.medicine_strength (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  medicine_id      uuid not null references public.medicine(id),
  label            text not null,
  position         integer not null,
  active           boolean not null default true
);

create index if not exists medicine_strength_medicine_idx
  on public.medicine_strength (medicine_id, position);
create unique index if not exists medicine_strength_label_idx
  on public.medicine_strength (medicine_id, label);
create unique index if not exists medicine_strength_position_idx
  on public.medicine_strength (medicine_id, position);
alter table public.medicine_strength enable row level security;

-- ── GP practice master ──────────────────────────────────────
-- A practice is a place, not just a mailbox.

alter table public.gp_surgery add column if not exists practice_code text;
alter table public.gp_surgery add column if not exists phone         text;
alter table public.gp_surgery add column if not exists address       text;

-- ── Slot configuration ──────────────────────────────────────
--
-- `availability` already holds working days, opening and closing times, slot
-- length and maximum per slot. These are the two §12 asks for that it cannot
-- express. They are separate tables because they are different shapes: a break
-- recurs every week, a closure is a date.

create table if not exists public.availability_break (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  branch_id        uuid not null references public.branch(id),
  service_id       uuid references public.service(id),
  weekday          integer not null check (weekday between 0 and 6),
  start_minute     integer not null check (start_minute between 0 and 1440),
  end_minute       integer not null check (end_minute between 0 and 1440),
  label            text,
  check (end_minute > start_minute)
);

create index if not exists availability_break_branch_idx
  on public.availability_break (branch_id, weekday);
alter table public.availability_break enable row level security;

create table if not exists public.schedule_closure (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  -- Null closes every branch: a public holiday.
  branch_id        uuid references public.branch(id),
  closed_on        date not null,
  -- Both null closes the whole day.
  start_minute     integer check (start_minute between 0 and 1440),
  end_minute       integer check (end_minute between 0 and 1440),
  reason           text,
  check (
    (start_minute is null and end_minute is null)
    or (start_minute is not null and end_minute is not null and end_minute > start_minute)
  )
);

create index if not exists schedule_closure_date_idx
  on public.schedule_closure (closed_on, branch_id);
alter table public.schedule_closure enable row level security;

commit;

-- ── Seed the ladders that were in the source ────────────────
--
-- These are the values the code has been using. Seeding rather than inventing:
-- the behaviour must not change on the day this runs, only become editable.
-- Until these rows exist the loader falls back to the built-in ladders, so
-- running this migration is what moves control into the database rather than
-- what makes the rules start working.

do $$
declare
  v_org       uuid;
  v_service   uuid;
  v_medicine  uuid;
  v_strength  text;
  v_position  integer;
  v_ladder    text[];
  v_brand     text;
begin
  select id into v_org from public.organisation order by created_at limit 1;
  if v_org is null then
    raise notice 'No organisation — skipping medicine seed.';
    return;
  end if;

  select id into v_service from public.service
   where slug like 'weight-management%' order by slug limit 1;

  foreach v_brand in array array['Mounjaro', 'Wegovy'] loop
    v_ladder := case v_brand
      when 'Mounjaro' then array['2.5mg','5mg','7.5mg','10mg','12.5mg','15mg']
      else                 array['0.25mg','0.5mg','1mg','1.7mg','2.4mg']
    end;

    insert into public.medicine (organisation_id, brand, generic_name, form, service_id)
    values (
      v_org,
      v_brand,
      case v_brand when 'Mounjaro' then 'tirzepatide' else 'semaglutide' end,
      'Injection',
      v_service
    )
    on conflict (organisation_id, brand) do update set updated_at = now()
    returning id into v_medicine;

    v_position := 0;
    foreach v_strength in array v_ladder loop
      insert into public.medicine_strength (organisation_id, medicine_id, label, position)
      values (v_org, v_medicine, v_strength, v_position)
      on conflict (medicine_id, label) do update set position = excluded.position;
      v_position := v_position + 1;
    end loop;
  end loop;
end
$$;

-- ── Verify ──────────────────────────────────────────────────
select m.brand,
       count(ms.id)                                as strengths,
       string_agg(ms.label, ' < ' order by ms.position) as ladder
  from public.medicine m
  left join public.medicine_strength ms on ms.medicine_id = m.id
 group by m.brand
 order by m.brand;
