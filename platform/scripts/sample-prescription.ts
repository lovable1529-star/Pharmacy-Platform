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
    summary: [
      { label: 'Current weight', value: '84.2 kg' },
      { label: 'Weight at last supply', value: '86.9 kg' },
      { label: 'Change since last supply', value: '−2.7 kg (−3.1%)' },
      { label: 'BMI', value: '29.4' },
      { label: 'Waist circumference', value: '96 cm' },
      { label: 'Current strength', value: '5 mg' },
      { label: 'Requested dose', value: 'Same' },
      { label: 'Requested supply', value: '2 months' },
      { label: 'Appetite suppression', value: 'Good' },
      { label: 'Snacking between meals', value: 'Occasionally' },
      { label: 'Hydration', value: 'About 1.5 litres a day' },
      { label: 'Missed doses in the last 4 weeks', value: 'None' },
      { label: 'Adverse effects', value: 'Mild nausea in the first two days' },
      { label: 'Changes to medicines or health since last supply', value: 'No' },
      { label: 'Pregnant or breastfeeding', value: 'No' },
      { label: 'Site of administration', value: 'Self-injection (abdomen)' },
      { label: 'Type of injection', value: 'Subcutaneous' },
      { label: 'Funded by', value: 'Private' },
    ],
    advice: [
      'Weight loss of 3.1% since last supply is on track. Continuing at the same strength is appropriate.',
      'Aim for at least 2 litres of fluid a day — mild nausea and constipation are more common below this.',
      'Two months of supply requires six weeks stable on the current dose. Pharmacist review required before this can be approved.',
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
