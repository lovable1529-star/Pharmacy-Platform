-- ═══════════════════════════════════════════════════════════
-- 06 · Your staff account
-- Karsons Pharmacy platform
-- ═══════════════════════════════════════════════════════════
-- Run this LAST, and edit the two values first.
-- 
-- Before running it:
--   1. Supabase → Authentication → Users → Add user → Create new user
--   2. Enter your email and tick "Auto Confirm User"
--   3. Open the new user and copy their UID
-- 
-- Then replace the placeholders below.
-- 
-- Without this, signing in succeeds but every query returns nothing — the
-- row-level security policies key off app_user, so a session with no matching
-- row can see nothing at all. That is the intended behaviour, but it looks
-- like a bug the first time you meet it.
-- ─────────────────────────────────────────────────────────
-- EDIT THESE TWO LINES
-- ─────────────────────────────────────────────────────────

do $$
declare
  v_auth_id  uuid := 'PASTE-THE-SUPABASE-AUTH-UID-HERE';
  v_email    text := 'you@example.com';
  v_name     text := 'Mukunda Measuria';
  v_org      uuid := 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53';
begin
  insert into app_user (id, organisation_id, full_name, email)
  values (v_auth_id, v_org, v_name, v_email)
  on conflict (id) do update set full_name = excluded.full_name;

  -- OWNER across the whole organisation: null company and null branch means
  -- organisation-wide. A locum would get a specific branch and a valid_to date.
  insert into role_assignment (id, organisation_id, user_id, role, company_id, branch_id)
  values (gen_random_uuid(), v_org, v_auth_id, 'OWNER', null, null)
  on conflict do nothing;
end $$;

-- Check it worked — this should return one row with your name.
select u.full_name, u.email, r.role, r.company_id, r.branch_id
from app_user u
join role_assignment r on r.user_id = u.id;
