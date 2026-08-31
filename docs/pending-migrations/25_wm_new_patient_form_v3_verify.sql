-- ── Verify ──────────────────────────────────────────────────
-- Expect: the next version, 10 steps, and 1 / 3 / 1 / 1 across the flags.
select s.slug,
       fv.version,
       jsonb_array_length(fv.schema->'steps')                          as steps,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st
         where st->>'id' = 'pathway')                                  as has_pathway_gate,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st,
                             jsonb_array_elements(st->'fields') f
         where f->>'id' in ('firstName','lastName','dateOfBirth'))     as identity_fields,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st
         where st->>'id' = 'transfer')                                 as has_transfer_branch,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st
         where st->>'id' = 'supply')                                   as has_supply_step,
       (fv.schema::text like '%before your appointment%')              as still_says_appointment
  from public.service s
  join public.form_version fv on fv.id = s.published_form_version_id
 where s.slug = 'weight-management-first';
