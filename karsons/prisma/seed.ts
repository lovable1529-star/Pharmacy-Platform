/**
 * Database seed.
 *
 * Reference data (branches, GP surgeries, products, batches) is real — it is
 * not personal data and it makes the demo land. When the client opens the
 * system and sees his own branches and vaccine batches in the dropdowns, the
 * conversation changes.
 *
 * Patient data is entirely synthetic. See CLAUDE.md §5 — no real patient data
 * outside production, ever.
 *
 * Run with:  pnpm db:seed
 */

import { PrismaClient } from '@prisma/client';
import { FLU_VACCINE_FORM, FLU_VACCINE_CLINICIAN_FORM, FLU_VACCINE_DECLARATIONS, FLU_VACCINE_OUTPUTS, GP_SURGERIES } from '../src/lib/forms/services/flu-vaccine';
import { GLP1_REPEAT_RULESET } from '../src/lib/rules/glp1-ruleset';

const prisma = new PrismaClient();

/** Synthetic Manx names — plausible for the Isle of Man, entirely fictional. */
const FIRST_NAMES = ['Aalin', 'Bridget', 'Callum', 'Deborah', 'Eoin', 'Fiona', 'Gareth', 'Hannah', 'Illiam', 'Juan', 'Kirree', 'Liam', 'Moirrey', 'Niall', 'Orla', 'Paul', 'Quinn', 'Ruth', 'Shona', 'Thomas', 'Una', 'Voirrey', 'William'];
const LAST_NAMES = ['Callister', 'Cannell', 'Christian', 'Clague', 'Corkill', 'Corlett', 'Costain', 'Cowley', 'Craine', 'Crellin', 'Faragher', 'Gelling', 'Kelly', 'Kermode', 'Kewley', 'Killip', 'Kinrade', 'Kneale', 'Moore', 'Quayle', 'Quilliam', 'Radcliffe', 'Skillicorn', 'Teare'];
const TOWNS = [
  { town: 'Onchan', postcode: 'IM3' },
  { town: 'Douglas', postcode: 'IM1' },
  { town: 'Kirk Michael', postcode: 'IM6' },
  { town: 'Ramsey', postcode: 'IM8' },
  { town: 'Peel', postcode: 'IM5' },
  { town: 'Castletown', postcode: 'IM9' },
];

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}

function randomDateOfBirth(seed: number): Date {
  const year = 1940 + (seed * 7) % 68;
  const month = (seed * 3) % 12;
  const day = 1 + (seed * 11) % 28;
  return new Date(Date.UTC(year, month, day));
}

async function main() {
  console.log('Seeding Karsons Pharmacy Platform…');

  // ── Organisation ───────────────────────────────────────────
  const org = await prisma.organisation.upsert({
    where: { slug: 'karsons' },
    update: {},
    create: {
      name: 'Karsons Pharmacy Group',
      slug: 'karsons',
      settings: {
        branding: { primary: '#3E2465', accent: '#1F8A54' },
        timezone: 'Europe/Isle_of_Man',
        retention: { consultationMonths: 60, prescriptionMonths: 24 },
      },
    },
  });

  // ── Companies and branches ─────────────────────────────────
  const company = await prisma.company.create({
    data: {
      organisationId: org.id,
      name: 'Karsons Pharmacy Limited',
      tradingName: 'Karsons Pharmacy',
      gphcNumber: '9012896',
      town: 'Onchan',
      postcode: 'IM3 1AR',
    },
  });

  const branches = await Promise.all([
    prisma.branch.create({
      data: {
        companyId: company.id,
        name: 'Onchan',
        code: 'ONC',
        town: 'Onchan',
        postcode: 'IM3 1AR',
        inboxEmail: 'onchan@karsonspharmacy.im',
      },
    }),
    prisma.branch.create({
      data: {
        companyId: company.id,
        name: 'Kirk Michael',
        code: 'KMI',
        town: 'Kirk Michael',
        postcode: 'IM6 1AT',
        inboxEmail: 'kirkmichael@karsonspharmacy.im',
      },
    }),
  ]);

  for (const branch of branches) {
    await prisma.resource.createMany({
      data: [
        { branchId: branch.id, name: 'Consultation Room 1', type: 'CONSULTATION_ROOM' },
        { branchId: branch.id, name: 'Patient Tablet', type: 'TABLET' },
      ],
    });
  }

  // ── Pharmacists ────────────────────────────────────────────
  // Placeholder GPhC numbers in the correct 7-digit format.
  // Replace with the client's real registration numbers before go-live.
  const pharmacists = [
    { fullName: 'Mukunda Measuria', email: 'muka@karsonspharmacy.im', gphc: '2050123', role: 'OWNER' as const },
    { fullName: 'Sarah Corlett', email: 'sarah@karsonspharmacy.im', gphc: '2061234', role: 'PHARMACIST' as const },
    { fullName: 'David Quayle', email: 'david@karsonspharmacy.im', gphc: '2072345', role: 'PHARMACIST' as const },
    { fullName: 'Priya Sharma', email: 'priya@karsonspharmacy.im', gphc: '2083456', role: 'PHARMACIST' as const },
    { fullName: 'James Kneale', email: 'james@karsonspharmacy.im', gphc: '2094567', role: 'PHARMACIST' as const },
    { fullName: 'Aisha Rahman', email: 'aisha@karsonspharmacy.im', gphc: '2105678', role: 'PHARMACIST' as const },
  ];

  for (const p of pharmacists) {
    const user = await prisma.user.create({
      data: { organisationId: org.id, email: p.email, fullName: p.fullName },
    });
    await prisma.roleAssignment.create({ data: { userId: user.id, role: p.role } });
    await prisma.clinician.create({
      data: { userId: user.id, gphcNumber: p.gphc, qualification: 'MRPharmS' },
    });
  }

  // Non-clinical staff, to demonstrate scoped roles.
  const receptionist = await prisma.user.create({
    data: { organisationId: org.id, email: 'reception.onchan@karsonspharmacy.im', fullName: 'Emma Craine' },
  });
  await prisma.roleAssignment.create({
    data: { userId: receptionist.id, role: 'RECEPTION', companyId: company.id, branchId: branches[0]!.id },
  });

  // ── GP surgeries ───────────────────────────────────────────
  const surgeries = await Promise.all(
    GP_SURGERIES.filter((s) => 'email' in s).map((s) =>
      prisma.gpSurgery.create({
        data: { organisationId: org.id, name: s.label, email: (s as { email: string }).email },
      }),
    ),
  );

  // ── Products and batches ───────────────────────────────────
  const productData = [
    { name: 'Cell Based Quadrivalent Influenza Vaccine', manufacturer: 'Seqirus', allergens: [], batches: [{ batchNumber: '298465', expiry: '2027-03-31' }, { batchNumber: '298470', expiry: '2027-05-31' }] },
    { name: 'Adjuvanted Quadrivalent Influenza Vaccine', manufacturer: 'Seqirus', allergens: ['egg'], batches: [{ batchNumber: 'AQ11402', expiry: '2027-02-28' }] },
    { name: 'Quadrivalent Influenza Vaccine (Split Virion)', manufacturer: 'Sanofi', allergens: ['egg'], batches: [{ batchNumber: 'V4C821', expiry: '2027-04-30' }] },
    { name: 'Fluenz Tetra Nasal Spray', manufacturer: 'AstraZeneca', allergens: ['egg', 'gelatin'], batches: [{ batchNumber: 'NS55210', expiry: '2027-01-31' }] },
  ];

  for (const p of productData) {
    const product = await prisma.product.create({
      data: { organisationId: org.id, name: p.name, type: 'VACCINE', manufacturer: p.manufacturer, allergens: p.allergens },
    });

    for (const b of p.batches) {
      const batch = await prisma.batch.create({
        data: { productId: product.id, batchNumber: b.batchNumber, expiryDate: new Date(b.expiry) },
      });

      for (const branch of branches) {
        await prisma.stockLevel.create({
          data: { branchId: branch.id, productId: product.id, batchId: batch.id, quantity: 120 },
        });
        await prisma.stockMovement.create({
          data: { branchId: branch.id, batchId: batch.id, type: 'RECEIPT', quantity: 120, reason: 'Opening stock' },
        });
      }
    }
  }

  // GLP-1 medicines, for the repeat care service.
  for (const name of ['Mounjaro (tirzepatide)', 'Wegovy (semaglutide)']) {
    await prisma.product.create({
      data: { organisationId: org.id, name, type: 'MEDICINE', allergens: [] },
    });
  }

  // ── Consent text, versioned ────────────────────────────────
  await prisma.consentTextVersion.create({
    data: {
      organisationId: org.id,
      key: 'flu-vaccine-consent',
      version: 1,
      body:
        'I confirm the information I have given is accurate to the best of my knowledge, and I consent to receive the flu vaccine from a Karsons Pharmacy clinician. I understand my vaccination details will be shared with my Isle of Man GP practice.',
    },
  });

  // ── Services ───────────────────────────────────────────────
  const fluService = await prisma.service.create({
    data: {
      organisationId: org.id,
      name: 'Flu Vaccination',
      slug: 'flu-vaccination',
      category: 'Vaccination',
      description: 'Seasonal influenza vaccination, NHS and private.',
      priceMinor: 1800,
      active: true,
    },
  });

  await prisma.serviceVersion.create({
    data: {
      serviceId: fluService.id,
      version: 1,
      patientForm: FLU_VACCINE_FORM as object,
      clinicianForm: FLU_VACCINE_CLINICIAN_FORM as object,
      declarations: FLU_VACCINE_DECLARATIONS,
      outputs: FLU_VACCINE_OUTPUTS as object,
      publishedAt: new Date(),
    },
  });

  // GLP-1 repeat care, with its ruleset attached.
  const ruleset = await prisma.ruleset.create({
    data: { organisationId: org.id, name: 'GLP-1 Repeat Care Triage', description: 'Built from the client decision matrices.' },
  });

  const rulesetVersion = await prisma.rulesetVersion.create({
    data: { rulesetId: ruleset.id, version: 1, definition: GLP1_REPEAT_RULESET as object, publishedAt: new Date() },
  });

  const glp1Service = await prisma.service.create({
    data: {
      organisationId: org.id,
      name: 'Weight Management Repeat Care',
      slug: 'glp1-repeat-care',
      category: 'Weight Management',
      priceMinor: 14999,
      active: true,
    },
  });

  await prisma.serviceVersion.create({
    data: {
      serviceId: glp1Service.id,
      version: 1,
      patientForm: { schemaVersion: 1, title: 'Repeat Request', steps: [] },
      rulesetId: rulesetVersion.id,
      publishedAt: new Date(),
    },
  });

  // ── Synthetic patients ─────────────────────────────────────
  console.log('Creating 200 synthetic patients…');

  for (let i = 0; i < 200; i += 1) {
    const location = pick(TOWNS, i);
    await prisma.patient.create({
      data: {
        organisationId: org.id,
        firstName: pick(FIRST_NAMES, i * 3),
        lastName: pick(LAST_NAMES, i * 5),
        dateOfBirth: randomDateOfBirth(i + 1),
        gender: i % 2 === 0 ? 'Female' : 'Male',
        email: `patient${i}@example.test`,
        phone: `07624 ${String(100000 + i).slice(0, 6)}`,
        addressLine1: `${1 + (i % 90)} Main Road`,
        town: location.town,
        postcode: `${location.postcode} ${1 + (i % 9)}${pick(['AA', 'BB', 'JD', 'LN'], i)}`,
        gpSurgeryId: pick(surgeries, i).id,
      },
    });
  }

  // ── Retention policies ─────────────────────────────────────
  await prisma.retentionPolicy.createMany({
    data: [
      { organisationId: org.id, entityType: 'Consultation', retainMonths: 60, action: 'PURGE_PII' },
      { organisationId: org.id, entityType: 'Prescription', retainMonths: 24, action: 'PURGE_PII' },
      { organisationId: org.id, entityType: 'Submission', retainMonths: 60, action: 'PURGE_PII' },
    ],
  });

  console.log('Seed complete.');
  console.log(`  Organisation : ${org.name}`);
  console.log(`  Branches     : ${branches.map((b) => b.name).join(', ')}`);
  console.log(`  Pharmacists  : ${pharmacists.length}`);
  console.log(`  GP surgeries : ${surgeries.length}`);
  console.log('  Patients     : 200 (synthetic)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
