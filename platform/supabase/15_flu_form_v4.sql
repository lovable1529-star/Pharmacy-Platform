-- ============================================================
-- 15 — Flu questionnaire, corrected to the partner's specification
--
-- Publishes a NEW version. Nothing already answered changes: submissions stay
-- bound to the version they were completed against, which is why editing a live
-- form is safe here.
--
-- What changes from v3:
--
--   REMOVED  the "Feedback" step and its required question
--            "Was it difficult to fill the form ?" — a leftover from trying
--            out the designer, which every patient had to answer.
--
--   ADDED    breastfeeding                (§25.4 Q2, hidden for male patients)
--            bleedingDisorder             (§25.4 Q6)
--            currentMedication + detail   (§25.4 Q7 / Q7A)
--
--   CHANGED  fluVaccineLast6Months retired in favour of fluVaccineThisSeason.
--            The season is the clinically relevant window, and a rolling six
--            months answers a different question either side of a season
--            boundary. Retired rather than relabelled: an id must keep meaning
--            what it meant, and v3 submissions still render against v3.
--
--            pregnant moved from Yes/No/NA to Yes/No, since the gender rule
--            already hides it where it does not apply.
--
--   ORDER    now follows §25.4, with fever first — the specification numbers
--            it Q1 and requires it high in the pharmacist's view. It remains
--            clinician-only: it asks about the day of the appointment.
--
-- Safe to run more than once? NO. Each run publishes another version. Run once.
-- ============================================================

begin;

with next as (
  select coalesce(max(version), 0) + 1 as v
    from public.form_version
   where service_id = '030ab8e4-468c-552d-976a-25509ba74362'::uuid
),
inserted as (
  insert into public.form_version (organisation_id, service_id, version, schema, published_at)
  select 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53'::uuid,
         '030ab8e4-468c-552d-976a-25509ba74362'::uuid,
         next.v,
         $json${"schemaVersion":1,"title":"Flu Vaccination","description":"Please complete this before your appointment. It takes about three minutes.","numberQuestions":true,"estimatedMinutes":3,"consentClauses":[{"id":"accurate","text":"The medical information I have provided is true and accurate to the best of my knowledge."},{"id":"injection","text":"I understand that this vaccination treatment may involve an injection, and I may experience side effects."},{"id":"questions","text":"I understand that I have the opportunity to ask questions about the risks and benefits of the medicine, by speaking with the pharmacy before, during or after the consultation, and by submitting this form, I consent to the medicine being administered during the consultation."},{"id":"efficacy","text":"I understand that not all vaccines are effective for everyone, and that I may still contract the illness despite being vaccinated."},{"id":"wait","text":"I understand I may be asked to remain in the pharmacy for 10–15 minutes after vaccination if advised, for my safety."},{"id":"storage","text":"I understand that my personal information, including name, contact details, date of birth, address and GP details, will be securely uploaded to Karsons Pharmacy's database for electronic storage and kept in line with data protection regulations, along with the details of the consultation and medicines provided."},{"id":"gp","text":"I acknowledge that after the consultation, the details of my vaccination and consultation will be shared with my Isle of Man GP practice. If I do not have an Isle of Man GP, I may request a copy of my administration record to share with my GP."},{"id":"transmission","text":"I authorise the collection, storage, and secure transmission of my information for the purposes mentioned above."},{"id":"rights","text":"I understand that I can speak to a member of staff about any queries regarding the consultation or the processing of my personal data, including exercising my rights under data protection legislation."},{"id":"privacy","text":"I confirm I have been made aware of Karsons Pharmacy's Privacy Policy."}],"clinicianDeclarations":[{"id":"verified","text":"I confirm that I have verified the accuracy of the information provided by the patient in the pre-consultation form (medical conditions and allergies), and have determined that it is clinically appropriate for them, and they meet the criteria to receive the vaccine, as per the PGDs in use (private or Manx Care)."},{"id":"leaflet","text":"I confirm I have offered the patient a patient information leaflet and discussed as required."},{"id":"side-effects","text":"I confirm I have advised the patient on possible side effects and their management."},{"id":"monitoring","text":"I confirm I have advised the patient to remain in the pharmacy for 10–15 minutes after their vaccine, for monitoring."}],"steps":[{"id":"about-you","title":"About you","description":"So we can find your record and let your GP know.","fields":[{"id":"firstName","type":"shortText","label":"First name","required":true,"halfWidth":true},{"id":"lastName","type":"shortText","label":"Last name","required":true,"halfWidth":true},{"id":"dateOfBirth","type":"dateOfBirth","label":"Date of birth","required":true},{"id":"gender","type":"select","label":"Gender","required":true,"presentation":"segmented","helpText":"We ask only so we know which health questions apply to you.","options":[{"value":"female","label":"Female"},{"value":"male","label":"Male"},{"value":"other","label":"Other"}],"reveals":[{"whenValue":"other","fields":[{"id":"genderSelfDescribed","type":"shortText","label":"How would you describe your gender?","required":true}]}]},{"id":"phone","type":"phone","label":"Phone number","required":true,"halfWidth":true},{"id":"email","type":"email","label":"Email address","required":true,"halfWidth":true},{"id":"address","type":"address","label":"Home address","required":true},{"id":"gpSurgery","type":"select","label":"Which GP surgery are you registered with?","required":true,"presentation":"dropdown","storeMetadataAs":"gpSurgeryContact","options":[{"value":"41c08df0-09c5-541f-aa13-9b78831745c5","label":"Ballasalla Medical centre","metadata":{"email":"Ballasallamedicalcentre@gov.im","name":"Ballasalla Medical centre"}},{"value":"1d808e41-32fd-585f-8201-6f3c54b73bb7","label":"Castletown Medical centre","metadata":{"email":"cmc@gov.im","name":"Castletown Medical centre"}},{"value":"7cfd41d4-d601-5399-8437-6789fd23e8c5","label":"Finch Hill Health centre","metadata":{"email":"finchhill.gp@gov.im","name":"Finch Hill Health centre"}},{"value":"e06bcca7-63cb-57fd-9876-80c152d9d4ab","label":"Hailwood Medical centre","metadata":{"email":"Hailwoodmeds@gov.im","name":"Hailwood Medical centre"}},{"value":"42849886-627e-5d5b-b510-26aad5f976de","label":"Kensington Group Practice","metadata":{"email":"DHSCKensingtonPrescription@gov.im","name":"Kensington Group Practice"}},{"value":"3ff70869-a568-572a-957f-7b93a189c3d9","label":"Palatine Health centre","metadata":{"email":"palatineprescriptions@gov.im","name":"Palatine Health centre"}},{"value":"1692fb0a-e2f0-5e5e-a89c-b7af91c35c27","label":"Peel Group Practice","metadata":{"email":"peeldoctors@gov.im","name":"Peel Group Practice"}},{"value":"c6b21694-af8d-5bd5-9d5f-3d3b902838b3","label":"Ramsey and Jurby Group Practice","metadata":{"email":"RGP.General@gov.im","name":"Ramsey and Jurby Group Practice"}},{"value":"db9128d6-c8b2-5935-9df4-2dde1e0124d2","label":"Snaefell Surgery","metadata":{"email":"medicine.snaefell@gov.im","name":"Snaefell Surgery"}},{"value":"f876b27f-26fd-5c7e-873e-15705a36881c","label":"Southern Group Practice","metadata":{"email":"sgp@gov.im","name":"Southern Group Practice"}},{"value":"40e7247e-59ca-5ff5-9258-781ce374024e","label":"Village Walk and Laxey Health centre","metadata":{"email":"laxey&villagewalk@gov.im","name":"Village Walk and Laxey Health centre"}}]}]},{"id":"health","title":"Health questions","description":"A pharmacist will go through these with you before your vaccination.","fields":[{"id":"feverLast24Hours","type":"yesNo","label":"Have you had a high fever or temperature in the last 24 hours?","required":true,"presentation":"pills","clinicianOnly":true,"warnWhen":[{"value":"yes","severity":"stop","message":"Do not vaccinate today. Postpone until the patient has recovered."}]},{"id":"breastfeeding","type":"yesNo","label":"Are you breast-feeding?","required":true,"presentation":"pills","visibleWhen":[{"field":"gender","operator":"neq","value":"male"}]},{"id":"pregnant","type":"yesNo","label":"Are you pregnant, or is there any possibility that you could be pregnant?","required":true,"presentation":"pills","visibleWhen":[{"field":"gender","operator":"neq","value":"male"}]},{"id":"vaccineReaction","type":"yesNo","label":"Have you ever had an allergic or anaphylactic reaction to a vaccine before?","required":true,"presentation":"pills","reveals":[{"whenValue":"yes","fields":[{"id":"vaccineReactionDetail","type":"longText","label":"Please provide details of which vaccines you have had an allergic reaction to, and the reaction","required":true}]}]},{"id":"otherAllergies","type":"yesNo","label":"Do you have any other allergies?","required":true,"presentation":"pills","reveals":[{"whenValue":"yes","fields":[{"id":"otherAllergiesDetail","type":"longText","label":"Please provide details of what other allergies you have, and the reaction","required":true}]}]},{"id":"bleedingDisorder","type":"yesNo","label":"Do you have a bleeding disorder, including taking any medication that thins your blood (anticoagulants)?","required":true,"presentation":"pills","helpText":"This affects how and where the vaccine is given, not whether you can have it."},{"id":"currentMedication","type":"yesNo","label":"Are you currently taking any medication, over the counter or prescription?","required":true,"presentation":"pills","reveals":[{"whenValue":"yes","fields":[{"id":"currentMedicationDetail","type":"longText","label":"Please provide medication details","required":true}]}]},{"id":"fluVaccineThisSeason","type":"yesNo","label":"Have you already had a flu vaccine for this flu season?","required":true,"presentation":"pills"},{"id":"covidThisSeason","type":"yesNo","label":"Have you already had a COVID vaccine this season?","required":true,"presentation":"pills","warnWhen":[{"value":"no","severity":"info","message":"Ask our team about getting a COVID vaccine at the pharmacy."}]},{"id":"hadFluVaccineBefore","type":"yesNo","label":"Have you had a flu vaccine before?","required":true,"presentation":"pills"},{"id":"currentlyUnwell","type":"yesNo","label":"Are you currently unwell?","required":true,"presentation":"pills"},{"id":"otherConditions","type":"longText","label":"Do you have any other health conditions we should know about?","placeholder":"Leave blank if none."}]},{"id":"consent","title":"Consent","description":"Please read these carefully before signing.","fields":[{"id":"consent","type":"consentList","label":"Consent to receive the vaccine","required":true},{"id":"signature","type":"signature","label":"Please sign below","required":true,"helpText":"Sign with your finger or mouse."}]}]}$json$::jsonb,
         now()
    from next
  returning id, version
)
update public.service
   set published_form_version_id = inserted.id
  from inserted
 where public.service.id = '030ab8e4-468c-552d-976a-25509ba74362'::uuid;

commit;

-- ── Verify ──────────────────────────────────────────────────
select s.slug,
       fv.version,
       jsonb_array_length(fv.schema->'steps')                       as steps,
       (fv.schema::text like '%Was it difficult%')                  as still_has_feedback_question,
       (fv.schema::text like '%breastfeeding%')                     as has_breastfeeding,
       (fv.schema::text like '%bleedingDisorder%')                  as has_bleeding_disorder,
       (fv.schema::text like '%currentMedication%')                 as has_current_medication
  from public.service s
  join public.form_version fv on fv.id = s.published_form_version_id
 where s.slug = 'flu-vaccination';
