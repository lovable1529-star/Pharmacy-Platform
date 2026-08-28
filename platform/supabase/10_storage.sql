-- ============================================================
-- 10 — Patient file storage
--
-- The form has always had a photo/document field. Until now the file was
-- accepted, shown with a green tick, and thrown away on submit, because there
-- was nowhere to put it. That is the worst possible failure mode: the patient
-- believes their exemption letter has been sent and the pharmacy never learns
-- one was offered.
--
-- Creates the bucket the upload endpoint writes to.
--
-- Safe to run more than once.
-- ============================================================

begin;

-- ── 1. The bucket ───────────────────────────────────────────
--
-- PRIVATE. Not a judgement call: these objects are photographs of exemption
-- certificates, ID and prescriptions. A public bucket means a leaked or guessed
-- URL is a permanent, unauthenticated window onto a patient's documents.
--
-- Reads happen through short-lived signed URLs issued by the app only after it
-- has checked the caller is staff in the owning organisation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-uploads',
  'patient-uploads',
  false,
  10485760,                                        -- 10 MB, matched in code
  array['image/jpeg', 'image/png', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = false,                  -- never let this drift to true
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. No direct client access ──────────────────────────────
--
-- There is deliberately NO policy granting anon or authenticated roles access
-- to this bucket. Every read and write goes through the application, which
-- checks a resume token or a staff session first.
--
-- Patients have no account, so there is no JWT to write a meaningful policy
-- against — a policy permissive enough to let a patient upload would be
-- permissive enough to let anyone read. The service role bypasses RLS, and the
-- app is the gate.
--
-- These drops clean up any permissive policy left by an earlier attempt.

drop policy if exists "patient uploads are readable"   on storage.objects;
drop policy if exists "patient uploads are writable"   on storage.objects;
drop policy if exists "public read patient-uploads"    on storage.objects;

commit;

-- ── Verify ──────────────────────────────────────────────────
select
  id,
  public                                    as is_public_should_be_false,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'patient-uploads';
