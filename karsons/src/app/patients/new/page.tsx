'use client';

/**
 * New patient.
 *
 * Duplicate detection runs before anything is created, because duplicates are a
 * genuine clinical risk — half the allergy history in one record, half in the
 * other. The check suggests; it never merges automatically.
 */

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DuplicateWarning } from '@/components/clinical/patient-search';
import { findDuplicates } from '@/lib/patients/search';
import { PATIENTS, SURGERIES } from '@/lib/demo/data';

export default function NewPatientPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-ink-soft">Loading…</div>}>
      <NewPatientForm />
    </Suspense>
  );
}

function NewPatientForm() {
  const router = useRouter();
  const search = useSearchParams();

  // Carry through whatever they typed into the search box.
  const prefill = (search?.get('q') ?? '').trim().split(/\s+/);

  const [firstName, setFirstName] = useState(prefill[0] ?? '');
  const [lastName, setLastName] = useState(prefill[1] ?? '');
  const [dd, setDd] = useState('');
  const [mm, setMm] = useState('');
  const [yyyy, setYyyy] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [postcode, setPostcode] = useState('');
  const [gpSurgeryId, setGpSurgeryId] = useState('');
  const [checked, setChecked] = useState(false);
  const [created, setCreated] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const dateOfBirth = useMemo(() => {
    if (dd.length < 1 || mm.length < 1 || yyyy.length !== 4) return null;
    const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    // Reject dates that Date silently rolls over, e.g. 31 February.
    if (date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) return null;
    return date;
  }, [dd, mm, yyyy]);

  const duplicates = useMemo(() => {
    if (!dateOfBirth || !lastName) return [];
    return findDuplicates(
      { firstName, lastName, dateOfBirth, phone: phone || null, email: email || null },
      PATIENTS,
    );
  }, [firstName, lastName, dateOfBirth, phone, email]);

  function validate(): boolean {
    const found: string[] = [];
    if (!firstName.trim()) found.push('First name is needed.');
    if (!lastName.trim()) found.push('Last name is needed.');
    if (!dateOfBirth) found.push('Enter a valid date of birth.');
    if (!phone.trim() && !email.trim()) {
      found.push('Enter at least a phone number or an email address.');
    }
    setErrors(found);
    return found.length === 0;
  }

  function handleContinue() {
    if (!validate()) return;

    // Duplicates get one look before creation, not a blocking wall.
    if (duplicates.length > 0 && !checked) {
      setChecked(true);
      return;
    }
    setCreated(true);
  }

  if (created) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-clinical-green-100 text-clinical-green-700">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl">{firstName} {lastName} added</h1>
        <p className="mb-6 text-sm text-ink-soft">
          The record has been created and written to the audit trail.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/patients" className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">
            Find another
          </Link>
          <button
            type="button"
            onClick={() => router.push('/consultations/new?patient=pat_1')}
            className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white"
          >
            Start consultation
          </button>
        </div>
      </div>
    );
  }

  const inputClass = 'w-full rounded-lg border border-line px-3 py-2.5';

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/patients" className="mb-4 inline-block text-sm font-semibold text-brand-600">
        ← Back to search
      </Link>

      <h1 className="mb-1 text-2xl">Add a new patient</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Complete this with the patient in front of you.
      </p>

      {errors.length > 0 && (
        <div role="alert" className="mb-5 rounded-card border border-triage-red-700 bg-triage-red-100 p-4">
          <p className="mb-1 font-semibold">Please check the following</p>
          <ul className="list-inside list-disc text-sm">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      {checked && duplicates.length > 0 && (
        <div className="mb-5">
          <DuplicateWarning
            candidates={duplicates}
            onUseExisting={(id) => router.push(`/patients/${id}`)}
            onCreateAnyway={() => setCreated(true)}
          />
        </div>
      )}

      <div className="space-y-5 rounded-card border border-line bg-surface p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm font-semibold">First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-semibold">Last name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">Date of birth</span>
          <div className="flex gap-2">
            <input aria-label="Day" inputMode="numeric" maxLength={2} placeholder="DD"
              value={dd} onChange={(e) => setDd(e.target.value)}
              className={`${inputClass} w-20 text-center font-mono`} />
            <input aria-label="Month" inputMode="numeric" maxLength={2} placeholder="MM"
              value={mm} onChange={(e) => setMm(e.target.value)}
              className={`${inputClass} w-20 text-center font-mono`} />
            <input aria-label="Year" inputMode="numeric" maxLength={4} placeholder="YYYY"
              value={yyyy} onChange={(e) => setYyyy(e.target.value)}
              className={`${inputClass} w-24 text-center font-mono`} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm font-semibold">Phone</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="07624 000000" className={inputClass} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-semibold">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com" className={inputClass} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm font-semibold">Postcode</span>
            <input value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())}
              placeholder="IM1 1AA" className={`${inputClass} font-mono uppercase`} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-semibold">GP surgery</span>
            <select value={gpSurgeryId} onChange={(e) => setGpSurgeryId(e.target.value)} className={inputClass}>
              <option value="">Select a surgery</option>
              {SURGERIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        {/* Live feedback before they hit continue. */}
        {!checked && duplicates.length > 0 && (
          <p className="rounded-lg border border-triage-amber-700 bg-triage-amber-100 px-4 py-3 text-sm">
            <strong>{duplicates.length}</strong> existing record
            {duplicates.length === 1 ? '' : 's'} look similar. We will show you before creating.
          </p>
        )}

        <button type="button" onClick={handleContinue}
          className="w-full rounded-full bg-brand-600 px-6 py-3 text-sm font-bold text-white">
          {duplicates.length > 0 && !checked ? 'Check for duplicates' : 'Create patient'}
        </button>
      </div>
    </div>
  );
}
