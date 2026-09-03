-- ── Verify ──────────────────────────────────────────────────
-- Run SEPARATELY, after the migration above has come back.
-- Expect: version 1, 6 rules, default AMBER.
select s.slug,
       rv.version,
       jsonb_array_length(rv.definition->'rules')      as rules,
       rv.definition->>'defaultOutcome'                as default_outcome
  from public.service s
  join public.ruleset_version rv on rv.id = s.published_ruleset_version_id
 where s.slug = 'weight-management-first';
