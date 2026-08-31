-- ============================================================
-- 24 — Prescription numbers for supplies that have no consultation
--
-- `allocate_prescription_number` reads the organisation and branch from the
-- CONSULTATION table. That was sound while every supply followed a face-to-face
-- appointment. It is not sound now: a remote Weight Management supply never has
-- a consultation, so the function raises "Consultation % does not exist", the
-- caller swallows the error, and the prescription is issued with NO NUMBER.
--
-- That is the pharmacy's external reference to a real supply. Verified on the
-- live database: the first remote prescription issued came out with a null
-- number.
--
-- This adds a sibling that reads the same two facts from the SUBMISSION and
-- allocates from the same sequence, so a remote supply and a face-to-face one
-- draw from one series per branch per year. Two series would let the same
-- number describe two different supplies.
--
-- Run AFTER 22_service_experience_resources.sql.
-- Safe to run more than once.
-- ============================================================

begin;

create or replace function public.allocate_prescription_number_for_submission(
  p_submission_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_branch   uuid;
  v_code     text;
  v_year     integer;
  v_seq      integer;
  v_existing text;
  v_number   text;
begin
  select s.organisation_id, s.branch_id, b.code,
         extract(year from coalesce(s.submitted_at, now()))::int
    into v_org, v_branch, v_code, v_year
    from public.submission s
    join public.branch b on b.id = s.branch_id
   where s.id = p_submission_id;

  if v_org is null then
    raise exception 'Submission % does not exist, or has no branch', p_submission_id;
  end if;

  /*
   * Idempotent, for the same reason the consultation version is: a reissue or
   * a retried webhook must not burn a second number, or one supply ends up
   * with two references. The prescription itself is the record of what was
   * already allocated.
   */
  select p.number into v_existing
    from public.prescription p
   where p.submission_id = p_submission_id
     and p.number is not null
   limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  -- The same sequence the consultation path uses. One series per branch per
  -- year, whatever route the supply took.
  insert into public.prescription_sequence (organisation_id, branch_id, year, next_value)
       values (v_org, v_branch, v_year, 2)
  on conflict (branch_id, year)
    do update set next_value = public.prescription_sequence.next_value + 1
    returning next_value - 1 into v_seq;

  v_number := upper(v_code) || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  update public.prescription
     set number = v_number
   where submission_id = p_submission_id
     and number is null;

  return v_number;
end
$$;

revoke all on function public.allocate_prescription_number_for_submission(uuid) from public;

-- ─────────────────────────────────────────────────────────────
-- Repeat Care IDs for enrolments that have none
-- ─────────────────────────────────────────────────────────────
-- The gate at /repeat/[slug] matches on this reference plus the email on
-- record. An enrolment without one is unreachable: the patient has nothing to
-- type and the gate refuses everybody. New enrolments now generate one; this
-- backfills any that already exist.
--
-- Same alphabet the application uses: no O/0, I/1/L, S/5, U/V, because it is
-- read down a telephone and typed off a printed label.
do $backfill$
declare
  r         record;
  alphabet  text := 'ABCDEFGHJKMNPQRTWXY2346789';
  ref       text;
  i         int;
begin
  for r in
    select id from public.repeat_enrolment
     where external_ref is null or btrim(external_ref) = ''
  loop
    -- RC-XXXX-XXXX. Grouped in fours because a run of eight characters is
    -- hard to read back accurately.
    ref := 'RC-';
    for i in 1..8 loop
      if i = 5 then
        ref := ref || '-';
      end if;
      ref := ref || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    update public.repeat_enrolment set external_ref = ref where id = r.id;
  end loop;
end
$backfill$;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'allocate_prescription_number_for_submission') as fn_exists,
  (select count(*)::int from public.prescription where number is null) as unnumbered_prescriptions,
  (select count(*)::int from public.repeat_enrolment
    where external_ref is null or btrim(external_ref) = '') as enrolments_without_a_reference;
