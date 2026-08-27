/**
 * Flu Vaccine service definition.
 *
 * This is the proof that the platform is a configuration engine. Nothing about
 * flu vaccination is hard-coded anywhere in the codebase — the entire service
 * is this data structure, which the client can edit in the Service Designer.
 *
 * Question wording, ordering and conditional logic are taken from the client's
 * "Flu Vaccine Zoho Module Dev Brief" and his subsequent feedback document.
 */

import type { FormSchema } from '@/types/form-schema';

/**
 * Isle of Man GP surgeries with their gov.im notification addresses.
 * The email is attached as option metadata — the patient selects a surgery
 * name and never sees the address, but it is captured on the submission and
 * used for the end-of-day GP batch.
 *
 * Addresses below are placeholders in the correct format. Replace with the
 * client's supplied list before go-live.
 */
export const GP_SURGERIES = [
  { value: 'ballasalla', label: 'Ballasalla Surgery', email: 'ballasalla.surgery@gov.im' },
  { value: 'castletown', label: 'Castletown Medical Centre', email: 'castletown.mc@gov.im' },
  { value: 'finch-hill', label: 'Finch Hill Surgery', email: 'finchhill.surgery@gov.im' },
  { value: 'kensington', label: 'Kensington Group Practice', email: 'kensington.gp@gov.im' },
  { value: 'laxey', label: 'Laxey Village Surgery', email: 'laxey.surgery@gov.im' },
  { value: 'onchan', label: 'Onchan Health Centre', email: 'onchan.hc@gov.im' },
  { value: 'palatine', label: 'Palatine Group Practice', email: 'palatine.gp@gov.im' },
  { value: 'peel', label: 'Peel Group Practice', email: 'peel.gp@gov.im' },
  { value: 'ramsey', label: 'Ramsey Group Practice', email: 'ramsey.gp@gov.im' },
  { value: 'southern', label: 'Southern Group Practice', email: 'southern.gp@gov.im' },
  { value: 'village-walk', label: 'Village Walk Surgery', email: 'villagewalk.surgery@gov.im' },
  { value: 'not-listed', label: 'My GP surgery is not listed' },
] as const;

const gpOptions = GP_SURGERIES.map((s) => ({
  value: s.value,
  label: s.label,
  ...('email' in s ? { metadata: { email: s.email, name: s.label } } : {}),
}));

export const FLU_VACCINE_FORM: FormSchema = {
  schemaVersion: 1,
  title: 'Flu Vaccine Consultation',
  description:
    'Your clinician will review your answers before your appointment. Your GP surgery will receive a record once you have been vaccinated.',
  numberQuestions: true,
  estimatedMinutes: 4,
  steps: [
    {
      id: 'about-you',
      title: 'About you',
      description: 'We use this to create your record and to notify your GP.',
      fields: [
        { id: 'firstName', type: 'text', label: 'First name', required: true },
        { id: 'lastName', type: 'text', label: 'Last name', required: true },
        { id: 'dateOfBirth', type: 'dateOfBirth', label: 'Date of birth', required: true },
        {
          id: 'gender',
          type: 'select',
          label: 'What is your gender?',
          required: true,
          options: [
            { value: 'Male', label: 'Male' },
            { value: 'Female', label: 'Female' },
            { value: 'Other', label: 'Prefer to self-describe' },
            { value: 'NotSaid', label: 'Prefer not to say' },
          ],
          reveals: [
            {
              whenValue: 'Other',
              fields: [
                { id: 'genderSelfDescribed', type: 'text', label: 'How would you describe your gender?', required: true },
              ],
            },
          ],
        },
        { id: 'phone', type: 'phone', label: 'Phone number', required: true },
        { id: 'email', type: 'email', label: 'Email address', required: true },
        { id: 'address', type: 'address', label: 'Home address', required: true },
        {
          id: 'gpSurgery',
          type: 'select',
          label: 'Which GP surgery are you registered with?',
          helpText: 'Your vaccination record is sent here automatically after your appointment.',
          required: true,
          storeMetadataAs: 'gpContact',
          options: gpOptions,
          reveals: [
            {
              whenValue: 'not-listed',
              fields: [
                { id: 'gpSurgeryOther', type: 'text', label: 'Please tell us your GP surgery', required: true },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'health',
      title: 'Health questions',
      description: 'This helps your clinician check the vaccine is right for you today.',
      fields: [
        // Clinician-only, placed high as the client requested — asked on the day.
        {
          id: 'feverLast24h',
          type: 'yesno',
          label: 'Have you had a fever in the last 24 hours?',
          required: true,
          clinicianOnly: true,
          helpText: 'Confirmed with the patient at the appointment.',
        },
        { id: 'hadFluVaccineBefore', type: 'yesno', label: 'Have you had a flu vaccine before?', required: true },
        { id: 'vaccineLast6Months', type: 'yesno', label: 'Have you had a flu vaccine in the last 6 months?', required: true },
        { id: 'currentlyUnwell', type: 'yesno', label: 'Are you currently unwell?', required: true },
        {
          id: 'allergies',
          type: 'yesno',
          label: 'Do you have any allergies?',
          required: true,
          reveals: [
            {
              whenValue: 'Yes',
              fields: [
                {
                  id: 'allergyDetail',
                  type: 'textarea',
                  label: 'Please tell us what you are allergic to',
                  required: true,
                  placeholder: 'For example: eggs, penicillin, latex',
                },
              ],
            },
          ],
        },
        {
          id: 'anticoagulants',
          type: 'yesno',
          label: 'Are you taking any blood-thinning medication, such as warfarin?',
          required: true,
        },
        {
          id: 'otherConditions',
          type: 'yesno',
          label: 'Do you have any other health conditions we should know about?',
          required: true,
          reveals: [
            {
              whenValue: 'Yes',
              fields: [
                { id: 'conditionsDetail', type: 'textarea', label: 'Please give details', required: true },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'pregnancy',
      title: 'Pregnancy',
      // Conditional step — only shown where relevant, as the client requested.
      visibleWhen: [{ field: 'gender', operator: 'in', value: ['Female', 'Other', 'NotSaid'] }],
      fields: [
        {
          id: 'pregnant',
          type: 'select',
          label: 'Are you currently pregnant?',
          required: true,
          options: [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
            { value: 'NA', label: 'Not applicable' },
          ],
          reveals: [
            {
              whenValue: 'Yes',
              fields: [
                { id: 'weeksPregnant', type: 'number', label: 'How many weeks pregnant are you?', validation: { min: 0, max: 45 } },
              ],
            },
          ],
        },
        {
          id: 'breastfeeding',
          type: 'select',
          label: 'Are you currently breastfeeding?',
          required: true,
          options: [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
            { value: 'NA', label: 'Not applicable' },
          ],
        },
      ],
    },
    {
      id: 'consent',
      title: 'Consent',
      fields: [
        {
          id: 'consentInfo',
          type: 'info',
          label:
            'By signing below you confirm the information you have given is accurate, and you consent to receive the flu vaccine from a Karsons Pharmacy clinician. Your vaccination details will be shared with your Isle of Man GP practice.',
        },
        { id: 'consentGiven', type: 'yesno', label: 'I consent to receive the flu vaccine', required: true },
        { id: 'signature', type: 'signature', label: 'Please sign here', required: true },
      ],
    },
  ],
};

/**
 * Clinician-side form. Completed at the appointment, after identity is verified.
 * Dropdowns carry metadata so selecting a pharmacist auto-fills their GPhC
 * number, and selecting a vaccine auto-fills batch and expiry — exactly the
 * behaviour the client asked for.
 */
export const FLU_VACCINE_CLINICIAN_FORM: FormSchema = {
  schemaVersion: 1,
  title: 'Vaccine administration',
  steps: [
    {
      id: 'administration',
      title: 'Administration details',
      fields: [
        {
          id: 'clinicianId',
          type: 'select',
          label: 'Administering pharmacist',
          required: true,
          storeMetadataAs: 'clinicianDetails',
          options: [],
        },
        {
          id: 'productBatch',
          type: 'select',
          label: 'Vaccine and batch',
          required: true,
          storeMetadataAs: 'batchDetails',
          helpText: 'Batch number and expiry date are filled in automatically.',
          options: [],
        },
        {
          id: 'siteOfAdministration',
          type: 'select',
          label: 'Site of administration',
          required: true,
          options: [
            { value: 'RightDeltoid', label: 'Right deltoid' },
            { value: 'LeftDeltoid', label: 'Left deltoid' },
            { value: 'RightThigh', label: 'Right thigh' },
            { value: 'LeftThigh', label: 'Left thigh' },
            { value: 'RightGluteal', label: 'Right gluteal' },
            { value: 'LeftGluteal', label: 'Left gluteal' },
            { value: 'Oral', label: 'Oral' },
            { value: 'Nasal', label: 'Nasal' },
          ],
        },
        {
          id: 'routeOfAdministration',
          type: 'select',
          label: 'Route of administration',
          required: true,
          options: [
            { value: 'Intramuscular', label: 'Intramuscular' },
            { value: 'Subcutaneous', label: 'Subcutaneous' },
            { value: 'Subdermal', label: 'Subdermal' },
          ],
        },
        {
          id: 'fundingType',
          type: 'radio',
          label: 'Funding',
          required: true,
          options: [
            { value: 'NHS', label: 'NHS / Manx Care' },
            { value: 'PAID', label: 'Private (paid)' },
          ],
        },
        { id: 'clinicalNotes', type: 'textarea', label: 'Notes (optional)' },
      ],
    },
  ],
};

/**
 * Declarations the pharmacist signs before submission. Stored on the
 * consultation and reproduced on the GP notification.
 */
export const FLU_VACCINE_DECLARATIONS = [
  'I have verified the patient\'s identity.',
  'I have reviewed the patient\'s answers and confirmed there are no contraindications.',
  'I have confirmed the patient has no fever and is well enough to be vaccinated today.',
  'I have checked the vaccine batch number and expiry date.',
  'The patient has given informed consent.',
  'I have advised the patient on possible side effects and what to do if they occur.',
];

/** What happens after submission — also configurable per service. */
export const FLU_VACCINE_OUTPUTS = [
  { type: 'DOCUMENT', template: 'VACCINATION_RECORD', audience: 'PATIENT', trigger: 'ON_COMPLETE' },
  { type: 'EMAIL', template: 'GP_NOTIFICATION', audience: 'GP', trigger: 'END_OF_DAY_BATCH' },
  { type: 'EMAIL', template: 'PATIENT_CONFIRMATION', audience: 'PATIENT', trigger: 'ON_COMPLETE' },
  { type: 'STOCK', action: 'DECREMENT', trigger: 'ON_COMPLETE' },
];
