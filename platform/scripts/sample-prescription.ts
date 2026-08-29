/**
 * Renders a sample prescription so the layout can be looked at without needing
 * a completed consultation in the database.
 *
 * Uses the same document component the live route uses, so what comes out here
 * is what a patient would actually be handed.
 */

import { writeFileSync } from 'node:fs';
import { renderToBuffer } from '@react-pdf/renderer';
import { PrescriptionDocument, type PrescriptionData } from '../src/lib/pdf/prescription';

const data: PrescriptionData = {
  prescriptionNumber: 'KP-2026-004182',
  issuedAt: new Date('2026-08-28T14:20:00Z'),
  company: {
    name: 'Karsons Pharmacy Limited',
    gphcNumber: '9011682',
    addressLine1: '17 Main Road',
    town: 'Onchan',
    postcode: 'IM3 1RB',
  },
  branch: { name: 'Onchan', phone: '01624 675544' },
  patient: {
    fullName: 'Margaret Kelly',
    dateOfBirth: '1958-03-14',
    addressLine1: '42 Royal Avenue',
    town: 'Onchan',
    postcode: 'IM3 1LG',
    phone: '+44 7624 491203',
    email: 'm.kelly@example.im',
  },
  medicine: {
    name: 'Mounjaro (tirzepatide)',
    strength: '5 mg / 0.5 ml',
    directions: 'Inject once weekly, subcutaneously, on the same day each week.',
    quantity: '4 pre-filled pens',
    duration: '1 month',
  },
  price: { amount: '£185.00', paid: true, method: 'Paid online' },
  prescriber: {
    fullName: 'Mukunda Measuria',
    gphcNumber: '2077837',
    signatureDataUrl: null,
  },
  alert:
    'The patient asked: “I am going on holiday on the 14th — can I collect two months at once?”',
  consultation: {
    serviceName: 'Weight Management — Repeat Supply',
    completedAt: new Date('2026-08-28T14:18:00Z'),
    outcome: 'AMBER',
    // Deliberately includes the long, wrapping questions from the real flu
    // questionnaire — those are the rows that used to run into their answers.
    sections: [
      {
        title: 'Your measurements',
        entries: [
          { label: 'Height', value: '163 cm' },
          { label: 'Current weight', value: '84.2 kg' },
          { label: 'Waist circumference', value: '96 cm' },
          { label: 'Calculated BMI', value: '31.7' },
        ],
      },
      {
        title: 'Your treatment',
        entries: [
          { label: 'Current treatment strength', value: 'Mounjaro 5 mg' },
          { label: 'Weight recorded at your last supply', value: '86.9 kg' },
          { label: 'Change since last supply', value: '-2.7 kg (-3.1%)' },
          { label: 'Which dose would you like to request this time?', value: 'The same strength' },
          { label: 'How much would you like to be supplied?', value: '2 months' },
        ],
      },
      {
        title: 'Medical history',
        entries: [
          {
            label: 'Have you ever had an allergic or anaphylactic reaction to a vaccine before?',
            value: 'No',
          },
          {
            label: 'Do you have a bleeding disorder, including taking any medication that thins your blood (anticoagulants)?',
            value: 'No',
          },
          {
            label: 'Are you currently taking any medication, over the counter or prescription?',
            value: 'Yes',
          },
          {
            label: 'Please provide medication details',
            value: 'Atorvastatin 20 mg once daily, and lansoprazole 15 mg as required for reflux.',
          },
          {
            label: 'Have there been any changes to your medicines or health conditions since your last supply?',
            value: 'No',
          },
          { label: 'Are you pregnant, or is there any possibility that you could be pregnant?', value: 'No' },
        ],
      },
      {
        title: 'How the treatment has been going',
        entries: [
          { label: 'Appetite suppression', value: 'Mostly suppressed - minor hunger, manageable' },
          { label: 'Snacking and eating control', value: 'Occasional small snacks, still controlled' },
          { label: 'Hydration', value: '1.5-1.9 L/day' },
          { label: 'Missed doses in the past 4 weeks', value: 'None' },
          { label: 'Adverse effects', value: 'Mild nausea in the first two days after each dose' },
          { label: 'What would you most like to focus on before your next supply?', value: 'Diet and nutrition - protein, fibre and balance' },
        ],
      },
      {
        title: 'Recorded at the appointment',
        entries: [
          { label: 'Site of administration', value: 'Self-injection (abdomen)' },
          { label: 'Type of injection', value: 'Subcutaneous' },
          { label: 'Funded by', value: 'Private' },
          { label: 'Notes', value: 'Patient reports good adherence. Discussed hydration and timing of the weekly dose.' },
        ],
      },
    ],
    patientSignature:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    // Wording taken from the live ruleset, so the sample is representative
    // rather than a worst case invented for the layout.
    advice: [
      'Try to drink at least 1.5 to 2 litres of water a day. It helps with constipation, headaches and dizziness.',
      'Focus on protein at each meal and keep portions controlled - this helps preserve muscle while losing weight.',
      'Keep going - you are on track. Aim for 1.5 to 2 litres of water a day.',
    ],
  },
};

async function main() {
  const buffer = await renderToBuffer(PrescriptionDocument({ data }));
  const out = process.argv[2] ?? 'sample-prescription.pdf';
  writeFileSync(out, buffer);
  console.log(`\n  Wrote ${out} — ${(buffer.length / 1024).toFixed(1)} KB\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
