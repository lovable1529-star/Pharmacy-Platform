/**
 * Flu vaccination — the seeded starting configuration.
 *
 * IMPORTANT: this is a *configuration*, not code. Every question below is
 * editable by the client in the Service Designer, and publishing an edit creates
 * a new version. Nothing here is special-cased anywhere in the application — if
 * you find flu-specific logic outside this file, it belongs in configuration.
 *
 * Built from the client's own documents:
 *   · "Karsons Pharmacy Flu Vaccine Development Overview"
 *   · "Flu Vaccine Zoho Module Dev Brief"
 *   · "Zoho Flu Vaccine Module Feedback"  ← the corrections round, applied here
 *
 * Outstanding: he told us to match his existing paper form exactly and linked
 * a PDF that now 404s. The questions below are his stated list; the wording
 * should be checked against that form before the first clinic.
 */

import type { FormSchema } from '@/types/form-schema';

/** Applied from the feedback document, which replaced the earlier wording wholesale. */
export const FLU_CONSENT_CLAUSES = [
  { id: 'accurate', text: 'The medical information I have provided is true and accurate to the best of my knowledge.' },
  { id: 'injection', text: 'I understand that this vaccination treatment may involve an injection, and I may experience side effects.' },
  { id: 'questions', text: 'I understand that I have the opportunity to ask questions about the risks and benefits of the medicine, by speaking with the pharmacy before, during or after the consultation, and by submitting this form, I consent to the medicine being administered during the consultation.' },
  { id: 'efficacy', text: 'I understand that not all vaccines are effective for everyone, and that I may still contract the illness despite being vaccinated.' },
  { id: 'wait', text: 'I understand I may be asked to remain in the pharmacy for 10–15 minutes after vaccination if advised, for my safety.' },
  { id: 'storage', text: "I understand that my personal information, including name, contact details, date of birth, address and GP details, will be securely uploaded to Karsons Pharmacy's database for electronic storage and kept in line with data protection regulations, along with the details of the consultation and medicines provided." },
  { id: 'gp', text: 'I acknowledge that after the consultation, the details of my vaccination and consultation will be shared with my Isle of Man GP practice. If I do not have an Isle of Man GP, I may request a copy of my administration record to share with my GP.' },
  { id: 'transmission', text: 'I authorise the collection, storage, and secure transmission of my information for the purposes mentioned above.' },
  { id: 'rights', text: 'I understand that I can speak to a member of staff about any queries regarding the consultation or the processing of my personal data, including exercising my rights under data protection legislation.' },
  { id: 'privacy', text: "I confirm I have been made aware of Karsons Pharmacy's Privacy Policy." },
];

/** Ticked by the pharmacist before submitting — never shown to the patient. */
export const FLU_CLINICIAN_DECLARATIONS = [
  { id: 'verified', text: 'I confirm that I have verified the accuracy of the information provided by the patient in the pre-consultation form (medical conditions and allergies), and have determined that it is clinically appropriate for them, and they meet the criteria to receive the vaccine, as per the PGDs in use (private or Manx Care).' },
  { id: 'leaflet', text: 'I confirm I have offered the patient a patient information leaflet and discussed as required.' },
  { id: 'side-effects', text: 'I confirm I have advised the patient on possible side effects and their management.' },
  { id: 'monitoring', text: 'I confirm I have advised the patient to remain in the pharmacy for 10–15 minutes after their vaccine, for monitoring.' },
];

export function buildFluVaccinationForm(
  gpSurgeries: { id: string; name: string; email: string }[],
): FormSchema {
  return {
    schemaVersion: 1,
    title: 'Flu Vaccination',
    description: 'Please complete this before your appointment. It takes about three minutes.',
    numberQuestions: true,
    estimatedMinutes: 3,
    consentClauses: FLU_CONSENT_CLAUSES,
    clinicianDeclarations: FLU_CLINICIAN_DECLARATIONS,
    steps: [
      {
        id: 'about-you',
        title: 'About you',
        description: 'So we can find your record and let your GP know.',
        fields: [
          { id: 'firstName', type: 'shortText', label: 'First name', required: true, halfWidth: true },
          { id: 'lastName', type: 'shortText', label: 'Last name', required: true, halfWidth: true },
          { id: 'dateOfBirth', type: 'dateOfBirth', label: 'Date of birth', required: true },
          {
            id: 'gender',
            type: 'select',
            label: 'Gender',
            required: true,
            presentation: 'segmented',
            helpText: 'We ask only so we know which health questions apply to you.',
            options: [
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' },
            ],
            reveals: [
              {
                whenValue: 'other',
                fields: [
                  { id: 'genderSelfDescribed', type: 'shortText', label: 'How would you describe your gender?', required: true },
                ],
              },
            ],
          },
          { id: 'phone', type: 'phone', label: 'Phone number', required: true, halfWidth: true },
          { id: 'email', type: 'email', label: 'Email address', required: true, halfWidth: true },
          { id: 'address', type: 'address', label: 'Home address', required: true },
          {
            id: 'gpSurgery',
            type: 'select',
            label: 'Which GP surgery are you registered with?',
            required: true,
            presentation: 'dropdown',
            // The surgery's @gov.im mailbox rides along, hidden, and is what the
            // end-of-day notification is addressed to.
            storeMetadataAs: 'gpSurgeryContact',
            options: gpSurgeries.map((s) => ({
              value: s.id,
              label: s.name,
              metadata: { email: s.email, name: s.name },
            })),
          },
        ],
      },
      {
        id: 'health',
        title: 'Health questions',
        description: 'A pharmacist will go through these with you before your vaccination.',
        fields: [
          /*
           * Fever leads the section because the specification numbers it Q1 and
           * requires it high in the pharmacist's view. It stays clinician-only:
           * "in the last 24 hours" is a question about the day of the
           * appointment, and asking it a week in advance answers nothing.
           */
          {
            id: 'feverLast24Hours',
            type: 'yesNo',
            label: 'Have you had a high fever or temperature in the last 24 hours?',
            required: true,
            presentation: 'pills',
            clinicianOnly: true,
            warnWhen: [
              {
                value: 'yes',
                severity: 'stop',
                message: 'Do not vaccinate today. Postpone until the patient has recovered.',
              },
            ],
          },

          // Both pregnancy questions are closed for male patients and mandatory
          // for everyone else, per the gender rule in the specification.
          {
            id: 'breastfeeding',
            type: 'yesNo',
            label: 'Are you breast-feeding?',
            required: true,
            presentation: 'pills',
            visibleWhen: [{ field: 'gender', operator: 'neq', value: 'male' }],
          },
          {
            id: 'pregnant',
            type: 'yesNo',
            label: 'Are you pregnant, or is there any possibility that you could be pregnant?',
            required: true,
            presentation: 'pills',
            visibleWhen: [{ field: 'gender', operator: 'neq', value: 'male' }],
          },

          {
            id: 'vaccineReaction',
            type: 'yesNo',
            label: 'Have you ever had an allergic or anaphylactic reaction to a vaccine before?',
            required: true,
            presentation: 'pills',
            reveals: [
              {
                whenValue: 'yes',
                fields: [
                  {
                    id: 'vaccineReactionDetail',
                    type: 'longText',
                    label: 'Please provide details of which vaccines you have had an allergic reaction to, and the reaction',
                    required: true,
                  },
                ],
              },
            ],
          },
          {
            id: 'otherAllergies',
            type: 'yesNo',
            label: 'Do you have any other allergies?',
            required: true,
            presentation: 'pills',
            reveals: [
              {
                whenValue: 'yes',
                fields: [
                  {
                    id: 'otherAllergiesDetail',
                    type: 'longText',
                    label: 'Please provide details of what other allergies you have, and the reaction',
                    required: true,
                  },
                ],
              },
            ],
          },
          {
            id: 'bleedingDisorder',
            type: 'yesNo',
            label: 'Do you have a bleeding disorder, including taking any medication that thins your blood (anticoagulants)?',
            required: true,
            presentation: 'pills',
            helpText: 'This affects how and where the vaccine is given, not whether you can have it.',
          },
          {
            id: 'currentMedication',
            type: 'yesNo',
            label: 'Are you currently taking any medication, over the counter or prescription?',
            required: true,
            presentation: 'pills',
            reveals: [
              {
                whenValue: 'yes',
                fields: [
                  {
                    id: 'currentMedicationDetail',
                    type: 'longText',
                    label: 'Please provide medication details',
                    required: true,
                  },
                ],
              },
            ],
          },
          /*
           * The season, not a rolling six months. The previous wording asked
           * about the last 6 months, which answers a different question either
           * side of a season boundary. `fluVaccineLast6Months` is retired
           * rather than relabelled: an id must keep meaning what it meant, and
           * submissions already bound to version 3 still render against it.
           */
          {
            id: 'fluVaccineThisSeason',
            type: 'yesNo',
            label: 'Have you already had a flu vaccine for this flu season?',
            required: true,
            presentation: 'pills',
          },
          {
            id: 'covidThisSeason',
            type: 'yesNo',
            label: 'Have you already had a COVID vaccine this season?',
            required: true,
            presentation: 'pills',
            warnWhen: [
              {
                value: 'no',
                severity: 'info',
                message: 'Ask our team about getting a COVID vaccine at the pharmacy.',
              },
            ],
          },

          // From the pharmacy's own paper form, kept alongside the specified set.
          {
            id: 'hadFluVaccineBefore',
            type: 'yesNo',
            label: 'Have you had a flu vaccine before?',
            required: true,
            presentation: 'pills',
          },
          {
            id: 'currentlyUnwell',
            type: 'yesNo',
            label: 'Are you currently unwell?',
            required: true,
            presentation: 'pills',
          },
          {
            id: 'otherConditions',
            type: 'longText',
            label: 'Do you have any other health conditions we should know about?',
            placeholder: 'Leave blank if none.',
          },
        ],
      },
      {
        id: 'consent',
        title: 'Consent',
        description: 'Please read these carefully before signing.',
        fields: [
          {
            id: 'consent',
            type: 'consentList',
            label: 'Consent to receive the vaccine',
            required: true,
          },
          {
            id: 'signature',
            type: 'signature',
            label: 'Please sign below',
            required: true,
            helpText: 'Sign with your finger or mouse.',
          },
        ],
      },
    ],
  };
}
