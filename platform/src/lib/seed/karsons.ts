/**
 * Karsons reference data.
 *
 * Everything here except the patients is REAL, taken from the client's own
 * documents. Reference data is not personal data, so it belongs in source
 * control and in every environment — seeing his own pharmacists and surgeries
 * in the dropdowns is a large part of what makes a demo land.
 *
 * Patients are synthetic. No real patient data exists outside production,
 * ever.
 */

export const ORGANISATION = {
  slug: 'karsons',
  name: 'Karsons Pharmacy Group',
};

/**
 * NOTE FOR THE CLIENT MEETING: Kirk Michael uses villagepharmacykm@gmail.com,
 * which suggests it may trade as a separate legal entity ("Village Pharmacy").
 * If so it is a second Company, not a second Branch — which changes the name
 * and GPhC number printed on prescriptions issued there. Needs confirming.
 */
export const COMPANIES = [
  {
    key: 'karsons-ltd',
    name: 'Karsons Pharmacy Limited',
    tradingName: null,
    // GPhC premises registration — NOT YET SUPPLIED by the client.
    gphcNumber: null,
    town: 'Onchan',
    postcode: 'IM3 1BA',
  },
];

export const BRANCHES = [
  {
    key: 'onchan',
    companyKey: 'karsons-ltd',
    name: 'Onchan',
    code: 'ONC',
    addressLine1: '1 Main Road',
    town: 'Onchan',
    postcode: 'IM3 1BA',
    phone: '01624 615150',
    inboxEmail: 'clinic@karsonspharmacy.co.uk',
  },
  {
    key: 'kirk-michael',
    companyKey: 'karsons-ltd',
    name: 'Kirk Michael',
    code: 'KMI',
    addressLine1: 'Main Road',
    town: 'Kirk Michael',
    postcode: 'IM6 1AB',
    phone: '01624 878545',
    // Clinical mail cannot go out from a personal Gmail — raise with client.
    inboxEmail: 'villagepharmacykm@gmail.com',
  },
];

/** Real pharmacists and GPhC registration numbers, from the client's list. */
export const CLINICIANS = [
  { fullName: 'Mukunda Measuria', gphcNumber: '2077837' },
  { fullName: 'Valentin Oancea', gphcNumber: '2072600' },
  { fullName: 'Haresh Measuria', gphcNumber: '2028159' },
  { fullName: 'Carol Hutchinson', gphcNumber: '2032817' },
  { fullName: 'Chs Moura Hermidas', gphcNumber: '2204492' },
  { fullName: 'Kathryn Ions', gphcNumber: '2060816' },
];

/** All eleven Isle of Man practices with their prescription mailboxes. */
export const GP_SURGERIES = [
  { name: 'Ballasalla Medical centre', email: 'Ballasallamedicalcentre@gov.im' },
  { name: 'Castletown Medical centre', email: 'cmc@gov.im' },
  { name: 'Hailwood Medical centre', email: 'Hailwoodmeds@gov.im' },
  { name: 'Finch Hill Health centre', email: 'finchhill.gp@gov.im' },
  { name: 'Kensington Group Practice', email: 'DHSCKensingtonPrescription@gov.im' },
  { name: 'Palatine Health centre', email: 'palatineprescriptions@gov.im' },
  { name: 'Peel Group Practice', email: 'peeldoctors@gov.im' },
  { name: 'Ramsey and Jurby Group Practice', email: 'RGP.General@gov.im' },
  { name: 'Snaefell Surgery', email: 'medicine.snaefell@gov.im' },
  { name: 'Southern Group Practice', email: 'sgp@gov.im' },
  { name: 'Village Walk and Laxey Health centre', email: 'laxey&villagewalk@gov.im' },
];

export interface SeedBatch {
  batchNumber: string;
  expiryDate: string;
  onchan: number;
  kirkMichael: number;
}

export interface SeedProduct {
  key: string;
  name: string;
  category: string;
  allergens: string[];
  batches: SeedBatch[];
}

/**
 * Flu vaccines and batches are real, from the client's document. He noted there
 * will be other types he does not have batch numbers for yet — which is exactly
 * why products and batches are reference data he maintains himself.
 */
export const PRODUCTS: SeedProduct[] = [
  {
    key: 'cell-based-tiv',
    name: 'Cell Based TIV',
    category: 'Influenza vaccine',
    allergens: [],
    batches: [
      { batchNumber: '3051270', expiryDate: '2026-05-31', onchan: 120, kirkMichael: 80 },
    ],
  },
  {
    key: 'adjuvant-tiv',
    name: 'Adjuvant TIV',
    category: 'Influenza vaccine',
    allergens: ['egg'],
    batches: [
      { batchNumber: '0767711P1', expiryDate: '2026-04-30', onchan: 90, kirkMichael: 60 },
    ],
  },
  {
    key: 'mounjaro',
    name: 'Mounjaro',
    category: 'Weight management',
    allergens: [],
    batches: [],
  },
  {
    key: 'wegovy',
    name: 'Wegovy',
    category: 'Weight management',
    allergens: [],
    batches: [],
  },
];

/** Dose ladders. Order matters — a change of more than one step is blocked. */
export const DOSE_LADDERS: Record<string, string[]> = {
  Mounjaro: ['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg'],
  Wegovy: ['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg'],
};

/** Site of administration options, exactly as the client specified them. */
export const ADMINISTRATION_SITES = [
  'Right Deltoid',
  'Left Deltoid',
  'Right Thigh',
  'Left Thigh',
  'Oral',
  'Nasal',
  'Topical',
  'Self-Injection (abdomen, thigh or upper arm)',
];

export const INJECTION_TYPES = ['Intramuscular', 'Subcutaneous', 'Subdermal'];

// ─────────────────────────────────────────────────────────────
// Synthetic patients — never real data outside production
// ─────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Aalin', 'Bridget', 'Callum', 'Deborah', 'Eoin', 'Fiona', 'Gareth', 'Hannah',
  'Illiam', 'Juan', 'Kirree', 'Liam', 'Moirrey', 'Niall', 'Orla', 'Paul',
  'Ruth', 'Shona', 'Thomas', 'Una', 'Voirrey', 'William',
];

const LAST_NAMES = [
  'Corlett', 'Quayle', 'Kelly', 'Cregeen', 'Skillicorn', 'Radcliffe', 'Kermode',
  'Costain', 'Teare', 'Crellin', 'Kneale', 'Cannell', 'Faragher', 'Gelling',
  'Kinrade', 'Quirk', 'Watterson', 'Clague',
];

const TOWNS: [string, string][] = [
  ['Onchan', 'IM3 1'], ['Douglas', 'IM1 2'], ['Kirk Michael', 'IM6 1'],
  ['Peel', 'IM5 1'], ['Ramsey', 'IM8 1'], ['Castletown', 'IM9 1'],
  ['Laxey', 'IM4 7'], ['Port Erin', 'IM9 6'],
];

/** Deterministic so the same data appears on every machine and every reload. */
function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export interface SeedPatient {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  email: string;
  phone: string;
  addressLine1: string;
  town: string;
  postcode: string;
  gpSurgeryIndex: number;
  registeredBranchKey: string;
}

export function syntheticPatients(count = 200): SeedPatient[] {
  const next = pseudoRandom(20260827);
  const patients: SeedPatient[] = [];

  for (let i = 0; i < count; i += 1) {
    const firstName = FIRST_NAMES[Math.floor(next() * FIRST_NAMES.length)]!;
    const lastName = LAST_NAMES[Math.floor(next() * LAST_NAMES.length)]!;
    const town = TOWNS[Math.floor(next() * TOWNS.length)]!;

    const year = 1940 + Math.floor(next() * 68);
    const month = 1 + Math.floor(next() * 12);
    const day = 1 + Math.floor(next() * 28);

    patients.push({
      firstName,
      lastName,
      dateOfBirth: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      gender: next() > 0.5 ? 'Female' : 'Male',
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.im`,
      phone: `01624 ${String(200000 + Math.floor(next() * 700000)).slice(0, 6)}`,
      addressLine1: `${1 + Math.floor(next() * 90)} ${['Main Road', 'Church Street', 'Glen Road', 'Bay View'][Math.floor(next() * 4)]}`,
      town: town[0],
      postcode: `${town[1]}${'ABDEFGHJ'[Math.floor(next() * 8)]}${'ABDEFGHJ'[Math.floor(next() * 8)]}`,
      gpSurgeryIndex: Math.floor(next() * GP_SURGERIES.length),
      registeredBranchKey: next() > 0.45 ? 'onchan' : 'kirk-michael',
    });
  }

  return patients;
}

/**
 * Default opening hours for appointments.
 *
 * Monday to Friday all day, Saturday mornings — a sensible starting point the
 * client changes in Settings rather than a guess he is stuck with. A null
 * service means the window is open to every service, which is what his GLP-1
 * document requires: repeat-care appointments share the vaccination calendar.
 *
 * Minutes from midnight, because "Tuesdays 9 to 5" is what a pharmacy decides —
 * concrete slots are generated from these on demand.
 */
export const DEFAULT_AVAILABILITY = [
  { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60, slotMinutes: 15, capacity: 1 },
  { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60, slotMinutes: 15, capacity: 1 },
  { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60, slotMinutes: 15, capacity: 1 },
  { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60, slotMinutes: 15, capacity: 1 },
  { weekday: 5, startMinute: 9 * 60, endMinute: 17 * 60, slotMinutes: 15, capacity: 1 },
  { weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60, slotMinutes: 15, capacity: 1 },
];
