-- ============================================================
-- 09 — Connecting the clinical chain
--
-- Booking, questionnaire, arrival and consultation already existed as four
-- separate islands. The link columns were in the schema from the start
-- (appointment.submission_id, appointment.consultation_id) but nothing ever
-- wrote to them, so an appointment could never find its form and a completed
-- form could never become a consultation.
--
-- This migration adds the one genuinely missing piece: a resume token, so a
-- patient who half-fills a questionnaire on the bus can finish it at home, or
-- at the counter when they arrive.
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── 1. Resume tokens ────────────────────────────────────────
--
-- A patient completing a health questionnaire has no account and no password —
-- requiring registration for a flu jab form is how you lose the patient. The
-- token in their confirmation email IS the credential, so it must be
-- unguessable: it is generated as 32 random bytes, never sequential.
--
-- It grants access to exactly one submission and nothing else. Someone holding
-- it can read and finish that one form; they cannot enumerate patients, reach
-- another submission, or see anything clinical.

alter table public.submission
  add column if not exists resume_token text;

-- Partial unique index: many historical submissions have no token, and NULLs
-- must not collide with each other.
create unique index if not exists submission_resume_token_idx
  on public.submission (resume_token)
  where resume_token is not null;

-- Tokens are single-purpose and expire, so a forwarded email does not stay
-- live forever. Null means "no expiry set" for rows created before this ran.
alter table public.submission
  add column if not exists resume_expires_at timestamptz;

-- ── 2. Reverse lookup: submission -> appointment ─────────────
--
-- appointment.submission_id gave us appointment -> submission. Going the other
-- way (the consultation screen asking "which appointment is this?") was a
-- sequential scan.

create index if not exists appointment_submission_idx
  on public.appointment (submission_id)
  where submission_id is not null;

create index if not exists appointment_consultation_idx
  on public.appointment (consultation_id)
  where consultation_id is not null;

-- ── 3. One consultation per submission ──────────────────────
--
-- Two pharmacists opening the same arrived patient must not each be able to
-- complete a consultation. Without this, a double-click on "Complete" produces
-- two vaccination records for one patient — which is a clinical incident and a
-- double claim, not a cosmetic bug.

create unique index if not exists consultation_submission_idx
  on public.consultation (submission_id)
  where submission_id is not null;

-- ── 4. Draft submissions need a branch ──────────────────────
--
-- A draft created at booking time knows its branch. Existing rows do not, and
-- backfilling from the appointment is the only place that information exists.

update public.submission s
   set branch_id = a.branch_id
  from public.appointment a
 where a.submission_id = s.id
   and s.branch_id is null;

-- ── 5. Audit vocabulary ─────────────────────────────────────
--
-- These action strings are written by the new workflow paths. Listed here so
-- the compliance screen's filter has a complete vocabulary to work from;
-- audit_event.action is free text, so this is documentation, not a constraint.
--
--   submission.draft_started     a patient opened their form for the first time
--   submission.draft_saved       autosave — not written to audit, too noisy
--   submission.created           the patient submitted
--   submission.amended           staff corrected an answer after submission
--   appointment.arrived          patient checked in at the counter
--   appointment.rescheduled      moved to a different slot
--   appointment.cancelled        called off
--   appointment.no_show          did not attend
--   consultation.completed       clinician signed it off
--   patient.updated              demographics corrected

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name = 'submission' and column_name = 'resume_token')     as resume_token_added,
  (select count(*) from pg_indexes
    where indexname = 'consultation_submission_idx')                      as consultation_guard,
  (select count(*) from public.submission where branch_id is not null)    as submissions_with_branch;
