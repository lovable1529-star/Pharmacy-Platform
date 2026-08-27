/**
 * Demo data store.
 *
 * An in-memory implementation of everything the UI reads, so the application
 * boots and demonstrates end to end with **no database, no auth provider and no
 * environment variables**.
 *
 * Why this exists rather than wiring Supabase first: for a client demo a
 * database buys nothing visible on screen, and adds migrations, connection
 * pooling and auth as live failure modes in front of the person you are trying
 * to convince. The domain layer touches no database by design, so swapping this
 * for Prisma later is mechanical — the types and the logic do not change.
 *
 * All patient data here is synthetic. Reference data (branches, pharmacists, GP
 * surgeries, vaccine batches) is real, because seeing his own pharmacists in a
 * dropdown is a large part of the demo's effect.
 */

import type { PatientRecord } from '@/lib/patients/search';
import { FLU_VACCINE_FORM, FLU_VACCINE_CLINICIAN_FORM, GP_SURGERIES } from '@/lib/forms/services/flu-vaccine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import type { FormSchema } from '@/types/form-schema';
import type { Outcome } from '@/types/rule-schema';

// ─────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────

export const ORGANISATION = { id: 'org_karsons', name: 'Karsons Pharmacy Group' };

export const COMPANIES = [
  { id: 'co_1', name: 'Karsons Pharmacy Limited', gphcNumber: '9012896' },
];

export const BRANCHES = [
  { id: 'br_onchan', companyId: 'co_1', companyName: 'Karsons Pharmacy Limited', name: 'Onchan', code: 'ONC' },
  { id: 'br_kirk',   companyId: 'co_1', companyName: 'Karsons Pharmacy Limited', name: 'Kirk Michael', code: 'KMI' },
];

/** PLACEHOLDER GPhC numbers — correctly formatted but invented. Replace before demo. */
export const PHARMACISTS = [
  { id: 'cl_1', name: 'Mukunda Measuria', gphcNumber: '2050123', role: 'OWNER' },
  { id: 'cl_2', name: 'Sarah Corlett',    gphcNumber: '2061234', role: 'PHARMACIST' },
  { id: 'cl_3', name: 'David Quayle',     gphcNumber: '2072345', role: 'PHARMACIST' },
  { id: 'cl_4', name: 'Priya Sharma',     gphcNumber: '2083456', role: 'PHARMACIST' },
  { id: 'cl_5', name: 'James Kneale',     gphcNumber: '2094567', role: 'PHARMACIST' },
  { id: 'cl_6', name: 'Aisha Rahman',     gphcNumber: '2105678', role: 'PHARMACIST' },
];

/** PLACEHOLDER addresses — correct gov.im format, not the real mailboxes. */
export const SURGERIES = GP_SURGERIES.filter((s) => 'email' in s).map((s, i) => ({
  id: `gp_${i + 1}`,
  name: s.label,
  email: (s as { email: string }).email,
}));

export interface DemoBatch {
  id: string;
  productId: string;
  productName: string;
  batchNumber: string;
  expiryDate: Date;
  allergens: string[];
  recalledAt: Date | null;
  recallReason: string | null;
  stock: Record<string, number>;
}

export const BATCHES: DemoBatch[] = [
  { id: 'b1', productId: 'p1', productName: 'Cell Based Quadrivalent Influenza Vaccine', batchNumber: '298465', expiryDate: new Date('2027-03-31'), allergens: [], recalledAt: null, recallReason: null, stock: { br_onchan: 84, br_kirk: 61 } },
  { id: 'b2', productId: 'p1', productName: 'Cell Based Quadrivalent Influenza Vaccine', batchNumber: '298470', expiryDate: new Date('2026-09-20'), allergens: [], recalledAt: null, recallReason: null, stock: { br_onchan: 38, br_kirk: 12 } },
  { id: 'b3', productId: 'p2', productName: 'Adjuvanted Quadrivalent Influenza Vaccine', batchNumber: 'AQ11402', expiryDate: new Date('2027-02-28'), allergens: ['egg'], recalledAt: null, recallReason: null, stock: { br_onchan: 45, br_kirk: 30 } },
  { id: 'b4', productId: 'p3', productName: 'Fluenz Tetra Nasal Spray', batchNumber: 'NS55210', expiryDate: new Date('2027-01-31'), allergens: ['egg', 'gelatin'], recalledAt: null, recallReason: null, stock: { br_onchan: 22, br_kirk: 14 } },
];

// ─────────────────────────────────────────────────────────────
// Synthetic patients
// ─────────────────────────────────────────────────────────────

const FIRST = ['Aalin', 'Bridget', 'Callum', 'Deborah', 'Eoin', 'Fiona', 'Gareth', 'Hannah', 'Illiam', 'Juan', 'Kirree', 'Liam', 'Moirrey', 'Niall', 'Orla', 'Paul', 'Ruth', 'Shona', 'Thomas', 'Una', 'Voirrey', 'William'];
const LAST = ['Callister', 'Cannell', 'Christian', 'Clague', 'Corkill', 'Corlett', 'Costain', 'Cowley', 'Craine', 'Crellin', 'Faragher', 'Gelling', 'Kelly', 'Kermode', 'Kewley', 'Killip', 'Kinrade', 'Kneale', 'Moore', 'Quayle', 'Quilliam', 'Radcliffe', 'Skillicorn', 'Teare'];
const TOWNS = [
  { town: 'Onchan', pc: 'IM3' }, { town: 'Douglas', pc: 'IM1' },
  { town: 'Kirk Michael', pc: 'IM6' }, { town: 'Ramsey', pc: 'IM8' },
  { town: 'Peel', pc: 'IM5' }, { town: 'Castletown', pc: 'IM9' },
];

export interface DemoPatient extends PatientRecord {
  gender: string;
  addressLine1: string;
  town: string;
  gpSurgeryId: string;
  allergies: { substance: string; severity?: string }[];
  alerts: string[];
}

function seededPatients(count: number): DemoPatient[] {
  const patients: DemoPatient[] = [];

  for (let i = 0; i < count; i += 1) {
    const location = TOWNS[i % TOWNS.length]!;
    const year = 1940 + (i * 7) % 68;

    patients.push({
      id: `pat_${i + 1}`,
      firstName: FIRST[(i * 3) % FIRST.length]!,
      lastName: LAST[(i * 5) % LAST.length]!,
      dateOfBirth: new Date(Date.UTC(year, (i * 3) % 12, 1 + (i * 11) % 28)),
      gender: i % 2 === 0 ? 'Female' : 'Male',
      email: `patient${i + 1}@example.test`,
      phone: `07624 ${String(100000 + i * 37).slice(0, 6)}`,
      addressLine1: `${1 + (i % 90)} Main Road`,
      town: location.town,
      postcode: `${location.pc} ${1 + (i % 9)}${['AA', 'BB', 'JD', 'LN'][i % 4]}`,
      gpSurgeryId: SURGERIES[i % SURGERIES.length]!.id,
      // Roughly one in seven has a recorded allergy, so the cross-check has
      // something to catch during a demo.
      allergies: i % 7 === 0 ? [{ substance: 'egg', severity: 'Anaphylaxis' }] : [],
      alerts: i % 23 === 0 ? ['Interpreter required (Polish)'] : [],
    });
  }
  return patients;
}

export const PATIENTS: DemoPatient[] = seededPatients(200);

// ─────────────────────────────────────────────────────────────
// Appointments, queue, consultations
// ─────────────────────────────────────────────────────────────

function todayAt(hour: number, minute = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
}

export interface DemoAppointment {
  id: string;
  patientId: string;
  branchId: string;
  serviceId: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
  status: 'BOOKED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
}

export const APPOINTMENTS: DemoAppointment[] = [
  { id: 'ap_1', patientId: 'pat_3',  branchId: 'br_onchan', serviceId: 'svc_flu', serviceName: 'Flu Vaccination', startsAt: todayAt(9, 0),  endsAt: todayAt(9, 15),  status: 'COMPLETED' },
  { id: 'ap_2', patientId: 'pat_8',  branchId: 'br_onchan', serviceId: 'svc_flu', serviceName: 'Flu Vaccination', startsAt: todayAt(9, 30), endsAt: todayAt(9, 45),  status: 'COMPLETED' },
  { id: 'ap_3', patientId: 'pat_15', branchId: 'br_onchan', serviceId: 'svc_flu', serviceName: 'Flu Vaccination', startsAt: todayAt(10, 0), endsAt: todayAt(10, 15), status: 'ARRIVED' },
  { id: 'ap_4', patientId: 'pat_22', branchId: 'br_onchan', serviceId: 'svc_flu', serviceName: 'Flu Vaccination', startsAt: todayAt(11, 0), endsAt: todayAt(11, 15), status: 'BOOKED' },
  { id: 'ap_5', patientId: 'pat_31', branchId: 'br_onchan', serviceId: 'svc_glp1', serviceName: 'Weight Management Review', startsAt: todayAt(14, 0), endsAt: todayAt(14, 30), status: 'BOOKED' },
  { id: 'ap_6', patientId: 'pat_44', branchId: 'br_kirk',   serviceId: 'svc_flu', serviceName: 'Flu Vaccination', startsAt: todayAt(10, 30), endsAt: todayAt(10, 45), status: 'BOOKED' },
  { id: 'ap_7', patientId: 'pat_51', branchId: 'br_kirk',   serviceId: 'svc_flu', serviceName: 'Flu Vaccination', startsAt: todayAt(15, 0),  endsAt: todayAt(15, 15), status: 'BOOKED' },
];

export const WALK_INS = [
  { id: 'wi_1', patientName: 'Illiam Corkill', serviceName: 'Flu Vaccination', arrivedAt: todayAt(9, 45), branchId: 'br_onchan' },
  { id: 'wi_2', patientName: 'Moirrey Teare',  serviceName: 'Flu Vaccination', arrivedAt: todayAt(10, 5), branchId: 'br_onchan', priority: true },
];

export interface DemoConsultation {
  id: string;
  patientId: string;
  branchId: string;
  serviceName: string;
  clinicianName: string;
  completedAt: Date;
  fundingType: 'NHS' | 'PAID';
  batchNumber: string;
  gpNotified: boolean;
}

export const CONSULTATIONS: DemoConsultation[] = Array.from({ length: 42 }, (_, i) => ({
  id: `con_${i + 1}`,
  patientId: `pat_${(i * 3) % 200 + 1}`,
  branchId: i % 3 === 0 ? 'br_kirk' : 'br_onchan',
  serviceName: 'Flu Vaccination',
  clinicianName: PHARMACISTS[(i % 5) + 1]!.name,
  completedAt: new Date(Date.now() - i * 3_600_000 * 5),
  fundingType: i % 4 === 0 ? 'PAID' : 'NHS',
  batchNumber: i % 2 === 0 ? '298465' : '298470',
  gpNotified: i > 6,
}));

// ─────────────────────────────────────────────────────────────
// Repeat care requests
// ─────────────────────────────────────────────────────────────

export interface DemoRepeatRequest {
  id: string;
  patientId: string;
  patientName: string;
  medicine: string;
  currentStrength: string;
  requestedStrength: string;
  weightKg: number;
  heightCm: number;
  dateOfBirth: Date;
  submittedAt: Date;
  answers: Record<string, unknown>;
  previousSupplies: { suppliedAt: Date; strength: string; weightKg?: number }[];
  outcome?: Outcome;
  reviewed: boolean;
}

const baseAnswers = {
  medicine: 'Mounjaro', supplyMonths: 1, pregnant: 'No', breastfeeding: 'No',
  adverseEffects: 'None', redFlagSymptoms: 'No', missedDoses: 0, healthChanges: 'No',
  appetiteSuppression: 'Full suppression all week',
  snacking: 'Less than 3 regular meals, no snacks', hydration: '≥ 2.0 L/day',
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export const REPEAT_REQUESTS: DemoRepeatRequest[] = [
  {
    id: 'rr_1', patientId: 'pat_31', patientName: 'Bridget Kelly',
    medicine: 'Mounjaro', currentStrength: '5mg', requestedStrength: '5mg',
    weightKg: 92, heightCm: 172, dateOfBirth: new Date('1980-05-10'),
    submittedAt: daysAgo(0),
    answers: { ...baseAnswers, doseRequest: 'Same' },
    previousSupplies: [
      { suppliedAt: daysAgo(30), strength: '5mg', weightKg: 95 },
      { suppliedAt: daysAgo(60), strength: '5mg', weightKg: 98 },
    ],
    reviewed: false,
  },
  {
    id: 'rr_2', patientId: 'pat_47', patientName: 'Callum Quayle',
    medicine: 'Mounjaro', currentStrength: '2.5mg', requestedStrength: '10mg',
    weightKg: 108, heightCm: 180, dateOfBirth: new Date('1975-11-02'),
    submittedAt: daysAgo(0),
    // Deliberate demo case: a three-step jump. Must come back RED.
    answers: { ...baseAnswers, doseRequest: 'Increase' },
    previousSupplies: [{ suppliedAt: daysAgo(28), strength: '2.5mg', weightKg: 110 }],
    reviewed: false,
  },
  {
    id: 'rr_3', patientId: 'pat_62', patientName: 'Fiona Kneale',
    medicine: 'Mounjaro', currentStrength: '7.5mg', requestedStrength: '7.5mg',
    weightKg: 78, heightCm: 168, dateOfBirth: new Date('1988-03-19'),
    submittedAt: daysAgo(1),
    answers: {
      ...baseAnswers, doseRequest: 'Same', adverseEffects: 'Moderate',
      appetiteSuppression: 'Wearing off before next dose', missedDoses: 1,
      patientQuestion: 'Should I still inject if I have a cold?',
    },
    previousSupplies: [
      { suppliedAt: daysAgo(31), strength: '7.5mg', weightKg: 80 },
      { suppliedAt: daysAgo(62), strength: '5mg', weightKg: 84 },
    ],
    reviewed: false,
  },
  {
    id: 'rr_4', patientId: 'pat_88', patientName: 'Orla Christian',
    medicine: 'Wegovy', currentStrength: '1mg', requestedStrength: '1.7mg',
    weightKg: 71, heightCm: 165, dateOfBirth: new Date('1992-07-25'),
    submittedAt: daysAgo(1),
    answers: { ...baseAnswers, medicine: 'Wegovy', doseRequest: 'Increase' },
    previousSupplies: [
      { suppliedAt: daysAgo(29), strength: '1mg', weightKg: 74 },
      { suppliedAt: daysAgo(58), strength: '1mg', weightKg: 77 },
    ],
    reviewed: false,
  },
  {
    id: 'rr_5', patientId: 'pat_103', patientName: 'Thomas Radcliffe',
    medicine: 'Mounjaro', currentStrength: '10mg', requestedStrength: '10mg',
    weightKg: 68, heightCm: 178, dateOfBirth: new Date('1969-01-14'),
    submittedAt: daysAgo(2),
    // BMI 21.5 — below 23 without a decrease request. Must be RED.
    answers: { ...baseAnswers, doseRequest: 'Same' },
    previousSupplies: [{ suppliedAt: daysAgo(30), strength: '10mg', weightKg: 70 }],
    reviewed: false,
  },
];

// ─────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────

export interface DemoService {
  id: string;
  name: string;
  slug: string;
  category: string;
  priceMinor: number;
  active: boolean;
  version: number;
  patientForm: FormSchema;
  clinicianForm?: FormSchema;
  hasRuleset: boolean;
}

export const SERVICES: DemoService[] = [
  {
    id: 'svc_flu', name: 'Flu Vaccination', slug: 'flu-vaccination',
    category: 'Vaccination', priceMinor: 1800, active: true, version: 1,
    patientForm: FLU_VACCINE_FORM, clinicianForm: FLU_VACCINE_CLINICIAN_FORM,
    hasRuleset: false,
  },
  {
    id: 'svc_glp1', name: 'Weight Management Repeat Care', slug: 'glp1-repeat-care',
    category: 'Weight Management', priceMinor: 14999, active: true, version: 1,
    patientForm: { schemaVersion: 1, title: 'Repeat Request', steps: [] },
    hasRuleset: true,
  },
  {
    id: 'svc_covid', name: 'COVID-19 Vaccination', slug: 'covid-vaccination',
    category: 'Vaccination', priceMinor: 0, active: false, version: 1,
    patientForm: { schemaVersion: 1, title: 'COVID-19 Vaccination', steps: [] },
    hasRuleset: false,
  },
];

export const RULESET = GLP1_REPEAT_RULESET;

// ─────────────────────────────────────────────────────────────
// Message log
// ─────────────────────────────────────────────────────────────

export interface DemoMessage {
  id: string;
  recipient: string;
  surgeryName: string;
  subject: string;
  patientCount: number;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED';
  sentAt: Date;
  batchRef: string;
}

export const MESSAGES: DemoMessage[] = SURGERIES.slice(0, 6).map((surgery, i) => ({
  id: `msg_${i + 1}`,
  recipient: surgery.email,
  surgeryName: surgery.name,
  subject: `Karsons Pharmacy — vaccinations administered ${new Date().toLocaleDateString('en-GB')}`,
  patientCount: [4, 7, 2, 5, 3, 1][i]!,
  // One bounce, deliberately — it demonstrates the delivery monitoring.
  status: i === 3 ? 'BOUNCED' : i === 5 ? 'QUEUED' : 'DELIVERED',
  sentAt: new Date(Date.now() - (i + 1) * 3_600_000),
  batchRef: `gpbatch-${new Date().toISOString().slice(0, 10)}-${surgery.id}`,
}));

// ─────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────

export function findPatient(id: string): DemoPatient | undefined {
  return PATIENTS.find((p) => p.id === id);
}

export function patientName(id: string): string {
  const patient = findPatient(id);
  return patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient';
}

export function findSurgery(id: string) {
  return SURGERIES.find((s) => s.id === id);
}

export function branchName(id: string): string {
  return BRANCHES.find((b) => b.id === id)?.name ?? 'Unknown';
}

/** The signed-in user for the demo. Owner, so every screen is reachable. */
export const DEMO_USER = {
  fullName: 'Mukunda Measuria',
  roleLabel: 'Owner · Pharmacist',
  clinicianId: 'cl_1',
};
