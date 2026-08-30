/**
 * Weight management (GLP-1) — the seeded starting configuration.
 *
 * Two forms, because they are two different clinical events:
 *
 *   NEW PATIENT   full intake, routing and contraindication screening.
 *   REPEAT CARE   a short structured follow-up, triaged by the decision engine.
 *
 * BOTH are remote. On 30 August 2026 the client was explicit: "We need one
 * which is NEW patient service, then a REPEAT service. Both will be non-F2F."
 * That replaces the earlier model, in which a new patient was seen in person
 * twice before a pharmacist enrolled them into repeat care, and it is why the
 * new-patient form opens by offering face-to-face care and then leaves the
 * pathway entirely if it is chosen.
 *
 * Safety moves from the appointment to the questionnaire, the identity and
 * evidence checks, and a mandatory pharmacist phone call before approval.
 *
 * Sources, in priority order:
 *   1. "GLP1_Repeat_Care_Scope_of_Work" — the clinical intent and the answer
 *      bands the decision engine reads. Where this and the old system disagree,
 *      this wins.
 *   2. The field inventory recovered from the deployed legacy system, for
 *      question wording he had already signed off.
 *
 * Answer VALUES are machine-readable and stable; LABELS are his wording and are
 * his to rewrite. The decision engine reads values, never labels.
 */

import type { FormSchema, FieldOption } from '@/types/form-schema';

// ─────────────────────────────────────────────────────────────
// Shared option sets
// ─────────────────────────────────────────────────────────────

/** Dose ladders. A change of more than one step is blocked by the ruleset. */
export const MOUNJARO_STRENGTHS = ['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg'];
export const WEGOVY_STRENGTHS = ['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg'];

export const MEDICINE_STRENGTH_OPTIONS: FieldOption[] = [
  ...MOUNJARO_STRENGTHS.map((s, i) => ({
    value: `mounjaro_${s}`,
    label: `Mounjaro ${s}`,
    metadata: { medicine: 'Mounjaro', strength: s, ladderIndex: i },
  })),
  ...WEGOVY_STRENGTHS.map((s, i) => ({
    value: `wegovy_${s}`,
    label: `Wegovy ${s}`,
    metadata: { medicine: 'Wegovy', strength: s, ladderIndex: i },
  })),
];

/**
 * Contraindications. Note MEN2 — Multiple Endocrine Neoplasia type 2.
 *
 * The legacy system had this as "MED2", which is almost certainly a typo but
 * has been corrected here rather than reproduced. Worth confirming with him,
 * since it is a genuine GLP-1 contraindication and the wrong label on a safety
 * question is the wrong kind of mistake.
 */
export const CONTRAINDICATIONS: FieldOption[] = [
  { value: 'heart_failure', label: 'Severe heart failure' },
  { value: 'retinopathy', label: 'Diabetic retinopathy' },
  { value: 'pancreatitis', label: 'Pancreatitis (current or previous)' },
  { value: 'gastroparesis', label: 'Gastroparesis' },
  { value: 'ibd', label: "Ulcerative colitis or Crohn's disease" },
  { value: 'thyroid_cancer', label: 'History or family history of thyroid cancer' },
  { value: 'men2', label: 'History or family history of MEN2' },
  { value: 'cancer', label: 'Any cancer, chemotherapy or radiotherapy' },
  { value: 'none', label: 'None of the above' },
];

export const WEIGHT_RELATED_CONDITIONS: FieldOption[] = [
  { value: 'none', label: 'None of the above' },
  { value: 'depression', label: 'Depression linked to weight' },
  { value: 'reflux', label: 'Acid reflux / GORD' },
  { value: 'hypertension', label: 'High blood pressure' },
  { value: 'ed', label: 'Erectile dysfunction' },
  { value: 'cvd', label: 'Cardiovascular disease' },
  { value: 'osteoarthritis', label: 'Knee or hip osteoarthritis' },
  { value: 'asthma', label: 'Asthma' },
  { value: 'copd', label: 'COPD' },
  { value: 'sleep_apnoea', label: 'Obstructive sleep apnoea' },
  { value: 'cholesterol', label: 'High cholesterol' },
  { value: 'pcos', label: 'PCOS' },
  { value: 'other', label: 'Other' },
];

/** Consent, adapted from Pharmadoctor per his scope of work. */
export const GLP1_CONSENT_CLAUSES = [
  { id: 'risks', text: 'I have received information on the risks and benefits of the medicine, and I have had the opportunity to ask questions.' },
  { id: 'accurate', text: 'The medical information I have provided is true and accurate to the best of my knowledge, and I consent to the medicine being supplied.' },
  { id: 'reliance', text: 'I understand that the supply of this medicine is based on the information I have given, and that if it is inaccurate it could negatively affect my treatment.' },
  /*
   * Was: "I can make an appointment to see a pharmacist in person at any time."
   * That is no longer true of this service — it is a remote clinic, and being
   * seen in person means being referred to a separate, higher-cost programme.
   * A consent clause promising something the service does not offer is the
   * kind of sentence that surfaces in a complaint.
   */
  { id: 'contact', text: 'I understand this is a remote service, that I can contact the pharmacy team at any time to discuss my treatment, and that I will be told if I need to be seen in person.' },
  { id: 'storage', text: 'I understand that my personal information — name, surname, email, telephone, date of birth, address and GP details — will be securely stored and processed in line with data protection regulations.' },
  { id: 'transmission', text: 'I authorise the collection, storage, and secure transmission of my information for the purposes mentioned above.' },
  { id: 'gp', text: 'I acknowledge that my GP will be notified of any prescription issued.' },
  { id: 'rights', text: 'I understand I can speak to a member of staff about any queries regarding my consultation or the processing of my personal data, by contacting the pharmacy.' },
];

/** Ticked by the pharmacist before approving or supplying. */
export const GLP1_CLINICIAN_DECLARATIONS = [
  { id: 'accurate', text: 'I confirm the patient has provided accurate information and disclosed all medical conditions and allergies.' },
  { id: 'leaflet', text: 'I confirm I have provided a patient information leaflet and discussed as required.' },
  { id: 'side-effects', text: 'I confirm I have advised the patient on possible side effects and their management.' },
  { id: 'pregnancy-suspected', text: 'I have made the patient aware they should discontinue treatment and contact their supplier or GP if they suspect pregnancy.' },
  { id: 'pregnancy-planned', text: 'I have made the patient aware they should contact their supplier if planning pregnancy, as treatment must be discontinued.' },
  { id: 'contraception', text: 'I confirm the patient has been advised regarding contraception interactions and risks related to delayed gastric emptying.' },
  { id: 'insulin', text: 'I confirm the patient has received GP advice if also taking insulin or sulfonylureas, with monitoring in place.' },
];

function branchOptions(branches: { id: string; name: string }[]): FieldOption[] {
  return branches.map((b) => ({ value: b.id, label: b.name, metadata: { branchId: b.id } }));
}

// ─────────────────────────────────────────────────────────────
// FORM 1 — New patient, remote
// ─────────────────────────────────────────────────────────────

/**
 * Published as a NEW form version. The existing published version is not
 * edited: two patients answered it, and the record has to keep saying what
 * they were actually asked.
 *
 * The opening two steps are the client's, in his order — offer face-to-face
 * first, then find out whether they are coming from another clinic, because
 * that decides which questions apply and which evidence is needed.
 */
export function buildWeightManagementNewPatientForm(
  branches: { id: string; name: string }[],
): FormSchema {
  /*
   * Everything after the pathway choice is hidden once somebody asks to be
   * seen in person. Repeated on each step rather than expressed once, because
   * step visibility is per-step in the schema — and a missed step here would
   * mean a patient we have just told to book elsewhere carrying on and
   * submitting a request anyway.
   */
  const remoteOnly = [{ field: 'pathwayChoice', operator: 'eq' as const, value: 'remote' }];

  return {
    // The FORMAT version of FormSchema, not this form's published version —
    // that is form_version.version, allocated when it is published.
    schemaVersion: 1,
    title: 'Weight Management — New Patient',
    description:
      'A few questions about your health, so a pharmacist can decide whether this treatment '
      + 'is right for you. It takes about ten minutes and you can stop and come back.',
    numberQuestions: true,
    estimatedMinutes: 10,
    consentClauses: GLP1_CONSENT_CLAUSES,
    clinicianDeclarations: GLP1_CLINICIAN_DECLARATIONS,
    steps: [
      {
        id: 'pathway',
        title: 'How would you like to be seen?',
        fields: [
          {
            id: 'pathwayIntro',
            type: 'infoBlock',
            label:
              'This is an online service. You will not normally see anyone in person — a '
              + 'pharmacist reviews your answers, telephones you, and decides whether treatment '
              + 'is suitable. If at any point they think you should be seen, they will tell you.',
          },
          {
            id: 'pathwayChoice',
            type: 'select',
            label: 'Which would you prefer?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'remote', label: 'Continue online' },
              { value: 'in_person', label: 'I would rather see someone in person' },
            ],
            warnWhen: [{
              value: 'in_person',
              severity: 'stop',
              /*
               * A stop, not a redirect. The referral link is configured per
               * service in `service_public_profile.f2f_referral_url` — it is
               * a different programme at a different price, and hard-coding a
               * URL here would make it a code change every time it moves.
               */
              message:
                'This online service may not be the right fit. Karsons Pharmacy runs a '
                + 'face-to-face weight management programme — please book with them instead. '
                + 'You do not need to finish this form.',
            }],
          },
        ],
      },
      {
        id: 'about-you',
        title: 'About you',
        description: 'So we know whose record this is, and how to reach you.',
        visibleWhen: remoteOnly,
        fields: [
          /*
           * Identity. Version 1 asked forty-two questions and none of them was
           * the patient's name, so every submission arrived unattached to a
           * record: the review queue showed "Unmatched patient", and approving
           * one raised no prescription because there was nobody to raise it
           * for. These five fields are what `readIdentity` matches on.
           */
          { id: 'firstName', type: 'shortText', label: 'First name', required: true, halfWidth: true },
          { id: 'lastName', type: 'shortText', label: 'Last name', required: true, halfWidth: true },
          { id: 'dateOfBirth', type: 'dateOfBirth', label: 'Date of birth', required: true },
          {
            id: 'gender',
            type: 'select',
            label: 'Gender',
            helpText: 'We ask only so we know which health questions apply to you.',
            required: true,
            presentation: 'segmented',
            options: [
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' },
            ],
          },
          { id: 'phone', type: 'phone', label: 'Phone number', required: true, halfWidth: true, helpText: 'A pharmacist will call you on this number.' },
          { id: 'email', type: 'email', label: 'Email address', required: true, halfWidth: true },
          { id: 'address', type: 'address', label: 'Home address', required: true },
          { id: 'gpSurgery', type: 'shortText', label: 'Your GP surgery', helpText: 'We tell them what has been supplied.' },
          {
            id: 'otherClinic',
            type: 'yesNo',
            label:
              'Are you currently receiving, or have you recently received, weight-management '
              + 'treatment from another clinic?',
            required: true,
            presentation: 'pills',
            helpText: 'This changes which questions we need to ask, and what evidence we need.',
          },
        ],
      },
      {
        id: 'measurements',
        title: 'Your measurements',
        description: 'Enter these in whichever units you know them in — we convert them.',
        visibleWhen: remoteOnly,
        fields: [
          { id: 'height', type: 'measurement', label: 'Height', measurementKind: 'height', required: true },
          { id: 'weight', type: 'measurement', label: 'Current weight', measurementKind: 'weight', required: true },
          { id: 'waist', type: 'measurement', label: 'Waist circumference', measurementKind: 'length', required: true },
          {
            id: 'bmi',
            type: 'derived',
            label: 'Calculated BMI',
            calculation: 'bmi',
            calculationInputs: ['weight', 'height'],
          },
        ],
      },
      {
        /*
         * Only for patients moving from another clinic.
         *
         * The client has given the ROUTE and the evidence CATEGORIES, and the
         * rule that a current BMI of 20 to under 25 may proceed only as a
         * verified continuation. He has not yet given the individual questions
         * or what counts as acceptable proof, so this collects the categories
         * he named and stops there. Inventing clinical questions to fill the
         * gap would be worse than an obviously unfinished step.
         */
        id: 'transfer',
        title: 'Your current treatment',
        description: 'Because you told us you are already being treated elsewhere.',
        visibleWhen: [
          { field: 'pathwayChoice', operator: 'eq', value: 'remote' },
          { field: 'otherClinic', operator: 'eq', value: 'yes' },
        ],
        fields: [
          { id: 'priorClinicName', type: 'shortText', label: 'Which clinic or pharmacy are you with?', required: true },
          {
            id: 'priorMedicine',
            type: 'select',
            label: 'Which medicine and strength are you currently on?',
            required: true,
            presentation: 'dropdown',
            options: MEDICINE_STRENGTH_OPTIONS,
          },
          { id: 'priorStartedOn', type: 'date', label: 'When did you start this strength?', required: true, halfWidth: true },
          { id: 'priorLastSupply', type: 'date', label: 'When was your last supply?', required: true, halfWidth: true },
          {
            id: 'priorStartingWeight',
            type: 'measurement',
            label: 'What did you weigh when you started treatment?',
            measurementKind: 'weight',
            required: true,
            helpText: 'Your progress is measured from this, so an approximate figure is better than none.',
          },
          {
            id: 'priorSideEffects',
            type: 'yesNo',
            label: 'Have you had any side effects on your current treatment?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'priorSideEffectsDetail', type: 'longText', label: 'Please describe them', required: true }] }],
          },
          {
            id: 'priorClinicReason',
            type: 'longText',
            label: 'Why are you moving to us?',
            helpText: 'Optional, but it helps the pharmacist understand your treatment so far.',
          },
        ],
      },
      {
        id: 'medical-history',
        title: 'Medical history',
        description: 'These questions decide whether this treatment is safe for you.',
        visibleWhen: remoteOnly,
        fields: [
          {
            id: 'contraindications',
            type: 'checkboxGroup',
            label: 'Do you have any of the following conditions?',
            helpText: 'Tick all that apply, or tick "None of the above".',
            required: true,
            presentation: 'checkList',
            options: CONTRAINDICATIONS,
          },
          {
            id: 'gallbladder',
            type: 'yesNo',
            label: 'Do you have gallbladder or bile duct issues?',
            required: true,
            presentation: 'pills',
            reveals: [
              {
                whenValue: 'yes',
                fields: [
                  {
                    id: 'gallbladderDetail',
                    type: 'checkboxGroup',
                    label: 'Could you tell us a little more?',
                    required: true,
                    presentation: 'checkList',
                    options: [
                      { value: 'current', label: 'Currently experiencing gallstones' },
                      { value: 'previous', label: 'Previously experienced gallstones' },
                      { value: 'removed', label: 'I had my gallbladder removed' },
                      { value: 'other', label: 'Other' },
                    ],
                  },
                  { id: 'gallbladderOther', type: 'longText', label: 'Please give any other details' },
                ],
              },
            ],
          },
          {
            id: 'liver',
            type: 'yesNo',
            label: 'Do you have liver impairment?',
            required: true,
            presentation: 'pills',
            reveals: [
              {
                whenValue: 'yes',
                fields: [
                  {
                    id: 'liverDetail',
                    type: 'checkboxGroup',
                    label: 'Which applies to you?',
                    required: true,
                    presentation: 'checkList',
                    options: [
                      { value: 'nafld', label: 'Non-alcoholic fatty liver disease' },
                      { value: 'nash', label: 'NASH' },
                      { value: 'moderate_severe', label: 'Moderate or severe liver impairment' },
                      { value: 'other', label: 'Other' },
                    ],
                  },
                  { id: 'liverOther', type: 'longText', label: 'Please give any other details' },
                ],
              },
            ],
          },
          {
            id: 'diabetes',
            type: 'select',
            label: 'Do you have diabetes?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'no', label: 'No' },
              { value: 'prediabetes', label: 'Pre-diabetes, or diet-controlled' },
              { value: 'medicated', label: 'Yes — and I take medicine for it' },
            ],
          },
          {
            id: 'weightConditions',
            type: 'multiSelect',
            label: 'Do you have any weight-related conditions?',
            helpText: 'Select all that apply.',
            presentation: 'chips',
            options: WEIGHT_RELATED_CONDITIONS,
            reveals: [
              { whenValue: 'other', fields: [{ id: 'weightConditionsOther', type: 'longText', label: 'Please tell us more' }] },
            ],
          },
        ],
      },
      {
        id: 'habits-safety',
        title: 'Habits and safety',
        description: 'Please answer honestly — nothing here is judged, and it changes what is safe to supply.',
        visibleWhen: remoteOnly,
        fields: [
          { id: 'madeSick', type: 'yesNo', label: 'Have you ever made yourself sick to lose weight?', required: true, presentation: 'pills' },
          { id: 'laxatives', type: 'yesNo', label: 'Have you ever taken laxatives to lose weight?', required: true, presentation: 'pills' },
          { id: 'controlEating', type: 'yesNo', label: 'Do you struggle to control your eating?', required: true, presentation: 'pills' },
          {
            id: 'eatingDisorder',
            type: 'yesNo',
            label: 'Have you ever been diagnosed with an eating disorder?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'eatingDisorderDetail', type: 'longText', label: 'Please tell us more', required: true }] }],
          },
          {
            id: 'otherMeds',
            type: 'yesNo',
            label: 'Are you taking any other medication?',
            helpText: 'Including anything bought over the counter.',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'otherMedsDetail', type: 'longText', label: 'Which medicines, and what dose?', required: true }] }],
          },
          {
            id: 'allergies',
            type: 'yesNo',
            label: 'Do you have any allergies?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'allergiesDetail', type: 'longText', label: 'What are you allergic to, and what happens?', required: true }] }],
          },
          {
            id: 'recentSurgery',
            type: 'yesNo',
            label: 'Have you had surgery in the last 3 months?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'recentSurgeryDetail', type: 'longText', label: 'What surgery, and when?', required: true }] }],
          },
        ],
      },
      {
        id: 'request',
        title: 'What you are asking for',
        visibleWhen: remoteOnly,
        fields: [
          {
            id: 'recentWeightLossMeds',
            type: 'select',
            label: 'Have you taken any weight loss medication in the last 2 weeks?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'none', label: 'Not currently taking any' },
              { value: 'wegovy', label: 'Wegovy' },
              { value: 'mounjaro', label: 'Mounjaro' },
              { value: 'ozempic', label: 'Ozempic' },
              { value: 'other', label: 'Other' },
            ],
            reveals: [{ whenValue: 'other', fields: [{ id: 'recentMedsOther', type: 'shortText', label: 'Which medicine?', required: true }] }],
          },
          {
            id: 'everUsedWeightLossMeds',
            type: 'yesNo',
            label: 'Have you ever used weight loss medication before?',
            required: true,
            presentation: 'pills',
            reveals: [
              {
                whenValue: 'yes',
                fields: [
                  {
                    id: 'previousMeds',
                    type: 'multiSelect',
                    label: 'Which have you used?',
                    required: true,
                    presentation: 'chips',
                    options: [
                      { value: 'wegovy', label: 'Wegovy' },
                      { value: 'mounjaro', label: 'Mounjaro' },
                      { value: 'saxenda', label: 'Saxenda' },
                      { value: 'orlistat', label: 'Xenical / Orlistat' },
                      { value: 'ozempic', label: 'Ozempic' },
                      { value: 'other', label: 'Other' },
                    ],
                  },
                  { id: 'previousMedsDetail', type: 'longText', label: 'How did you get on with them?' },
                ],
              },
            ],
          },
          {
            id: 'requestedMedicine',
            type: 'select',
            label: 'Which medicine and strength are you requesting?',
            required: true,
            presentation: 'dropdown',
            storeMetadataAs: 'requestedMedicineDetail',
            options: MEDICINE_STRENGTH_OPTIONS,
          },
          {
            id: 'doseRequest',
            type: 'select',
            label: 'Is this a starting dose, or a change?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'starting', label: 'Starting dose' },
              { value: 'same', label: 'Stay on the same dose' },
              { value: 'increase', label: 'Increase dose' },
              { value: 'decrease', label: 'Decrease dose' },
            ],
          },
          {
            id: 'supplyDuration',
            type: 'select',
            label: 'How much supply are you asking for?',
            helpText: 'One month is one pen — four doses, one a week.',
            required: true,
            presentation: 'segmented',
            options: [
              { value: '1', label: '1 pen (4 weeks)' },
              { value: '2', label: '2 pens (8 weeks)' },
            ],
          },
        ],
      },
      {
        id: 'evidence-safety',
        title: 'Evidence and safety',
        visibleWhen: remoteOnly,
        fields: [
          /*
           * Identity and evidence carry the safety this pathway no longer gets
           * from meeting the patient. The client listed ID, photographs, BMI
           * evidence, and prior prescription evidence for transfers.
           */
          {
            id: 'photoId',
            type: 'fileUpload',
            label: 'Photo ID',
            helpText: 'Passport, driving licence or another photographic ID. JPG, PNG or PDF.',
            required: true,
          },
          {
            id: 'patientPhoto',
            type: 'photoCapture',
            label: 'A photo of yourself',
            helpText: 'Taken now, so we can check it against your ID.',
            required: true,
          },
          {
            id: 'measurementEvidence',
            type: 'fileUpload',
            label: 'Photo showing your current weight',
            helpText: 'A picture of your scales reading, or a recent record from your GP.',
            required: true,
          },
          {
            /*
             * Required only for transfers, where it evidences the treatment
             * being continued rather than merely a previous dose.
             */
            id: 'evidence',
            type: 'fileUpload',
            label: 'Photo of your current prescription or medicine box',
            helpText: 'So we can confirm the medicine and strength you are already on.',
            required: true,
            visibleWhen: [{ field: 'otherClinic', operator: 'eq', value: 'yes' }],
          },
          {
            id: 'pregnancy',
            type: 'yesNo',
            label: 'Are you pregnant, breastfeeding, or planning a pregnancy?',
            required: true,
            presentation: 'pills',
            visibleWhen: [{ field: 'gender', operator: 'neq', value: 'male' }],
            warnWhen: [{ value: 'yes', severity: 'stop', message: 'This treatment cannot be supplied during pregnancy, breastfeeding, or while planning a pregnancy. Please speak to a pharmacist.' }],
          },
          {
            id: 'oralContraception',
            type: 'yesNo',
            label: 'Are you taking oral contraception (the pill)?',
            required: true,
            presentation: 'pills',
            visibleWhen: [{ field: 'gender', operator: 'neq', value: 'male' }],
            warnWhen: [{ value: 'yes', severity: 'warn', message: 'This medicine can slow digestion, which may affect how well the pill is absorbed. A pharmacist will discuss this with you.' }],
          },
          {
            id: 'bleedingDisorder',
            type: 'yesNo',
            label: 'Do you have a bleeding disorder?',
            required: true,
            presentation: 'pills',
            visibleWhen: [{ field: 'gender', operator: 'eq', value: 'male' }],
          },
          {
            id: 'anythingElse',
            type: 'yesNo',
            label: 'Is there anything else we should know?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'anythingElseDetail', type: 'longText', label: 'Please tell us', required: true }] }],
          },
        ],
      },
      {
        /*
         * How the medicine reaches them. Deliberately NOT an appointment — the
         * client is explicit that neither Weight Management journey creates
         * one, and a collection is a counter handover, not a booking.
         */
        id: 'supply',
        title: 'Getting your medicine',
        visibleWhen: remoteOnly,
        fields: [
          {
            id: 'fulfilmentMethod',
            type: 'select',
            label: 'How would you like to receive it?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'delivery', label: 'Post it to me' },
              { value: 'collection', label: 'I will collect it from the pharmacy' },
            ],
          },
          {
            id: 'collectionBranch',
            type: 'select',
            label: 'Which pharmacy will you collect from?',
            required: true,
            presentation: 'radioList',
            options: branchOptions(branches),
            // Same key the repeat form uses, so one reader serves both.
            storeMetadataAs: 'collectionBranchDetail',
            visibleWhen: [{ field: 'fulfilmentMethod', operator: 'eq', value: 'collection' }],
          },
          {
            id: 'deliveryAddress',
            type: 'address',
            label: 'Delivery address',
            helpText: 'Leave blank to use your home address above.',
            visibleWhen: [{ field: 'fulfilmentMethod', operator: 'eq', value: 'delivery' }],
          },
        ],
      },
      {
        id: 'consent',
        title: 'Consent',
        visibleWhen: remoteOnly,
        fields: [
          { id: 'consent', type: 'consentList', label: 'Consent to treatment', required: true },
          { id: 'signature', type: 'signature', label: 'Please sign below', required: true },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// FORM 2 — Repeat care follow-up
// ─────────────────────────────────────────────────────────────

export function buildWeightManagementRepeatForm(
  branches: { id: string; name: string }[],
): FormSchema {
  return {
    schemaVersion: 1,
    title: 'Weight Management — Repeat Request',
    description: 'A short check-in so we can supply your next pen safely. About four minutes.',
    numberQuestions: true,
    estimatedMinutes: 4,
    consentClauses: GLP1_CONSENT_CLAUSES,
    clinicianDeclarations: GLP1_CLINICIAN_DECLARATIONS,
    steps: [
      {
        id: 'how',
        title: 'How would you like to proceed?',
        fields: [
          {
            id: 'consultType',
            type: 'select',
            label: 'How would you like to proceed?',
            required: true,
            presentation: 'segmented',
            options: [
              { value: 'online', label: 'Complete online' },
              { value: 'clinic', label: 'I would rather be seen in person' },
            ],
            /*
             * Not an internal booking. This service is remote at the client's
             * explicit instruction, and being seen in person means the
             * separate Karsons programme — the old wording promised to book
             * them into an appointment this service does not offer.
             */
            warnWhen: [{ value: 'clinic', severity: 'info', message: 'Finish this form and a pharmacist will call you. If you would still rather be seen, they will point you to the Karsons face-to-face programme.' }],
          },
        ],
      },
      {
        id: 'progress',
        title: 'How you are getting on',
        description: 'Your height is carried over — only change it if it is wrong.',
        fields: [
          { id: 'height', type: 'measurement', label: 'Height', measurementKind: 'height', required: true },
          { id: 'weight', type: 'measurement', label: 'Current weight', measurementKind: 'weight', required: true },
          { id: 'waist', type: 'measurement', label: 'Current waist', measurementKind: 'length', required: true },
          { id: 'bmi', type: 'derived', label: 'Calculated BMI', calculation: 'bmi', calculationInputs: ['weight', 'height'] },
          {
            id: 'weightLostThisMonth',
            type: 'number',
            label: 'Roughly how much weight have you lost since your last supply?',
            helpText: 'In kilograms. Enter 0 if none.',
            required: true,
            validation: { min: 0, max: 30, message: 'Enter a figure between 0 and 30 kg.' },
          },
        ],
      },
      {
        id: 'medication',
        title: 'Your medicine',
        fields: [
          {
            id: 'historyChanged',
            type: 'yesNo',
            label: 'Has your medication or medical history changed since your last supply?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'historyChangedDetail', type: 'longText', label: 'What has changed?', required: true }] }],
          },
          {
            id: 'currentMedicine',
            type: 'select',
            label: 'What are you currently taking?',
            required: true,
            presentation: 'dropdown',
            storeMetadataAs: 'currentMedicineDetail',
            options: MEDICINE_STRENGTH_OPTIONS,
          },
          {
            id: 'weeksOnDose',
            type: 'select',
            label: 'How many weeks have you been on this strength?',
            required: true,
            presentation: 'dropdown',
            options: [
              ...Array.from({ length: 50 }, (_, i) => ({
                value: String(i + 1),
                label: `${i + 1} week${i === 0 ? '' : 's'}`,
              })),
              { value: '50+', label: 'More than 50 weeks' },
            ],
          },
          {
            id: 'missedDoses',
            type: 'select',
            label: 'How many doses have you missed in the last 4 weeks?',
            required: true,
            presentation: 'segmented',
            options: [
              { value: '0', label: 'None' },
              { value: '1', label: '1' },
              { value: '2+', label: '2 or more' },
            ],
          },
          {
            id: 'adverseEffects',
            type: 'scale',
            label: 'Have you had any side effects?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'none', label: 'None' },
              { value: 'mild', label: 'Mild — manageable, happy to continue' },
              { value: 'moderate', label: 'Moderate — troublesome' },
              { value: 'severe', label: 'Severe' },
              { value: 'red_flag', label: 'Severe stomach pain, persistent vomiting, or yellowing of the skin or eyes' },
            ],
            warnWhen: [
              { value: 'red_flag', severity: 'stop', message: 'Please stop taking your medicine and contact the pharmacy today.' },
              { value: 'severe', severity: 'stop', message: 'A pharmacist needs to speak with you before any further supply.' },
            ],
          },
          {
            id: 'glp1SideEffects',
            type: 'yesNo',
            label: 'Have you had any side effects specific to your GLP-1 medicine?',
            required: true,
            presentation: 'pills',
            reveals: [{ whenValue: 'yes', fields: [{ id: 'glp1SideEffectsDetail', type: 'longText', label: 'Please describe them', required: true }] }],
          },
          {
            id: 'pregnancy',
            type: 'yesNo',
            label: 'Are you pregnant or breastfeeding?',
            required: true,
            presentation: 'pills',
            visibleWhen: [{ field: 'gender', operator: 'neq', value: 'male' }],
            warnWhen: [{ value: 'yes', severity: 'stop', message: 'Treatment cannot be supplied. Please stop taking your medicine and contact the pharmacy.' }],
          },
        ],
      },
      {
        id: 'lifestyle',
        title: 'How the treatment is working',
        description: 'These answers are what tell us whether your dose is right.',
        fields: [
          {
            id: 'appetiteSuppression',
            type: 'scale',
            label: 'How well is your appetite being controlled?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'full', label: 'Full suppression all week — no hunger between meals' },
              { value: 'mostly', label: 'Mostly suppressed — minor hunger, manageable' },
              { value: 'wearing_off', label: 'Wearing off before my next dose — hungry later in the week' },
              { value: 'poor', label: 'Poor suppression — hungry most days' },
            ],
          },
          {
            id: 'snacking',
            type: 'scale',
            label: 'How would you describe your meals and snacking?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'controlled', label: 'Fewer than 3 regular meals, no snacks' },
              { value: 'occasional', label: 'Occasional small snacks, still controlled — fewer than 3 times a week' },
              { value: 'daily', label: 'A daily snacking habit creeping back in — more than 3 times a week' },
              { value: 'frequent', label: 'Frequent snacking or grazing, almost every day' },
            ],
          },
          {
            id: 'hydration',
            type: 'scale',
            label: 'How much water are you drinking each day?',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'high', label: '2 litres or more' },
              { value: 'adequate', label: '1.5 to 1.9 litres' },
              { value: 'low', label: '1 to 1.4 litres' },
              { value: 'very_low', label: 'Less than 1 litre' },
            ],
          },
          {
            id: 'focusArea',
            type: 'select',
            label: 'What would you like to focus on this month?',
            helpText: 'Pick one. We will tailor your advice around it.',
            required: true,
            presentation: 'radioList',
            options: [
              { value: 'eating_habits', label: 'Eating habits — timing and portion control' },
              { value: 'nutrition', label: 'Diet and nutrition — protein, fibre, balance' },
              { value: 'activity', label: 'Physical activity and exercise' },
              { value: 'sleep_stress', label: 'Sleep, stress and emotional health' },
              { value: 'support', label: 'Social support and routines' },
            ],
          },
        ],
      },
      {
        id: 'request',
        title: 'Your request',
        fields: [
          {
            id: 'doseRequest',
            type: 'select',
            label: 'What would you like to do with your dose?',
            required: true,
            presentation: 'segmented',
            options: [
              { value: 'same', label: 'Stay the same' },
              { value: 'increase', label: 'Increase' },
              { value: 'decrease', label: 'Decrease' },
            ],
          },
          {
            id: 'supplyQuantity',
            type: 'select',
            label: 'How much would you like?',
            required: true,
            presentation: 'segmented',
            options: [
              { value: '1', label: '1 pen (4 weeks)' },
              { value: '2', label: '2 pens (8 weeks)' },
              { value: '3', label: '3 pens (12 weeks)' },
            ],
          },
          {
            id: 'collectionBranch',
            type: 'select',
            label: 'Where would you like to collect?',
            required: true,
            presentation: 'segmented',
            storeMetadataAs: 'collectionBranchDetail',
            options: branchOptions(branches),
          },
          {
            id: 'questionsForPharmacist',
            type: 'longText',
            label: 'Anything you would like to ask or tell the pharmacist?',
            helpText: 'If you ask something here, we will make sure someone speaks to you when you collect.',
          },
        ],
      },
      {
        id: 'consent',
        title: 'Evidence and consent',
        fields: [
          {
            id: 'evidence',
            type: 'fileUpload',
            label: 'Photo of your current medicine box',
            helpText: 'Optional, but it helps us confirm your strength. JPG, PNG or PDF.',
          },
          { id: 'consent', type: 'consentList', label: 'Consent to continue treatment', required: true },
        ],
      },
    ],
  };
}
