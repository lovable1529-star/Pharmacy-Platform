'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertTriangle, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import { formatDate } from '@/lib/units';
import { similarity, type PatientRecord } from '@/lib/patients/search';
import { DateOfBirthField } from '@/components/ui/date-of-birth';
import { createPatient } from './actions';

const input =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[14.5px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none';
const label = 'mb-1.5 block text-[13px] font-medium text-ink';

interface Candidate extends PatientRecord {
  reason: string;
}

export interface Prefill {
  firstName: string; lastName: string; dateOfBirth: string;
  phone: string; email: string;
  addressLine1: string; town: string; postcode: string;
}

export function NewPatientForm({
  surgeries, branchId, companyId, existing, linkSubmissionId = null, prefill = null,
}: {
  surgeries: { id: string; name: string }[];
  branchId: string | null;
  companyId: string | null;
  existing: PatientRecord[];
  /** The questionnaire that sent us here — attached on save. */
  linkSubmissionId?: string | null;
  /** What is already known, so nobody types from memory. */
  prefill?: Prefill | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: prefill?.firstName ?? '',
    lastName: prefill?.lastName ?? '',
    dateOfBirth: prefill?.dateOfBirth ?? '',
    gender: '', genderSelfDescribed: '',
    phone: prefill?.phone ?? '',
    email: prefill?.email ?? '',
    addressLine1: prefill?.addressLine1 ?? '',
    town: prefill?.town ?? '',
    postcode: prefill?.postcode ?? '',
    gpSurgeryId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  /**
   * Possible duplicates, checked as they type. Same date of birth with a similar
   * surname is the pattern that matters — that is almost always the same person
   * with a typo, not two people.
   */
  const duplicates = useMemo<Candidate[]>(() => {
    if (form.lastName.trim().length < 3) return [];

    return existing
      .map((p) => {
        const surnameMatch = similarity(p.lastName, form.lastName.trim());
        const sameDob = Boolean(form.dateOfBirth) && p.dateOfBirth === form.dateOfBirth;
        const firstMatch = form.firstName.trim()
          ? similarity(p.firstName, form.firstName.trim())
          : 0;

        if (sameDob && surnameMatch > 0.7) {
          return { ...p, reason: 'Same date of birth and a similar surname' };
        }
        if (surnameMatch > 0.85 && firstMatch > 0.85) {
          return { ...p, reason: 'Very similar name already on file' };
        }
        return null;
      })
      .filter((c): c is Candidate => c !== null)
      .slice(0, 4);
  }, [existing, form.firstName, form.lastName, form.dateOfBirth]);

  const blockedByDuplicates = duplicates.length > 0 && !acknowledged;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result = await createPatient({
      firstName: form.firstName,
      lastName: form.lastName,
      dateOfBirth: form.dateOfBirth,
      gender: form.gender || null,
      genderSelfDescribed: form.gender === 'other' ? form.genderSelfDescribed || null : null,
      phone: form.phone || null,
      email: form.email || null,
      addressLine1: form.addressLine1 || null,
      town: form.town || null,
      postcode: form.postcode || null,
      gpSurgeryId: form.gpSurgeryId || null,
      branchId,
      companyId,
      linkSubmissionId,
    });

    setBusy(false);
    if (result.ok) {
      // Back where they came from, now unblocked. They came to get on with a
      // consultation, not to admire a new patient record.
      router.push(
        linkSubmissionId ? `/consultations/${linkSubmissionId}` : `/patients/${result.id}`,
      );
    }
    else setError(result.error);
  }

  return (
    <div className="page-shell mx-auto max-w-[calc(720px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link href="/patients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={2} /> All patients
      </Link>

      <h1 className="mb-1 text-[26px] leading-tight text-ink">Add a patient</h1>
      <p className="mb-6 text-[14px] text-ink-faint">
        You can complete the clinical form with them straight after.
      </p>

      {duplicates.length > 0 ? (
        <div className="mb-5 rounded-panel border border-review-200 bg-review-50 px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <Users size={16} strokeWidth={2.1} className="mt-0.5 shrink-0 text-review-700" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-review-700">
                {duplicates.length === 1 ? 'A similar record already exists' : 'Similar records already exist'}
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/patients/${d.id}`} className="text-[13.5px] font-medium text-review-700 underline">
                      {d.firstName} {d.lastName}
                    </Link>
                    <span className="tabular font-mono text-[11.5px] text-review-700">
                      {formatDate(d.dateOfBirth)}
                    </span>
                    <span className="text-[12px] text-review-700">— {d.reason}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setAcknowledged(true)}
                className={cn(
                  'mt-3 text-[12.5px] font-medium underline',
                  acknowledged ? 'text-ink-faint' : 'text-review-700',
                )}
              >
                {acknowledged ? 'Continuing with a new record' : 'None of these — create a new record'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} className="rounded-panel border border-line bg-surface shadow-panel px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="firstName">First name</label>
            <input id="firstName" required value={form.firstName}
              onChange={(e) => set('firstName')(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="lastName">Last name</label>
            <input id="lastName" required value={form.lastName}
              onChange={(e) => set('lastName')(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="dob">Date of birth</label>
            <DateOfBirthField
              id="dob"
              required
              value={form.dateOfBirth}
              onChange={set('dateOfBirth')}
            />
          </div>
          <div>
            <label className={label} htmlFor="gender">Gender</label>
            <SearchSelect
              id="gender"
              value={form.gender}
              onChange={set('gender')}
              emptyLabel="Prefer not to say"
              options={[
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          {form.gender === 'other' ? (
            <div className="sm:col-span-2">
              <label className={label} htmlFor="genderSelf">How would they describe their gender?</label>
              <input id="genderSelf" value={form.genderSelfDescribed}
                onChange={(e) => set('genderSelfDescribed')(e.target.value)} className={input} />
            </div>
          ) : null}
          <div>
            <label className={label} htmlFor="phone">Phone</label>
            <input id="phone" type="tel" value={form.phone}
              onChange={(e) => set('phone')(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="email">Email</label>
            <input id="email" type="email" value={form.email}
              onChange={(e) => set('email')(e.target.value)} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="address">Address</label>
            <input id="address" value={form.addressLine1}
              onChange={(e) => set('addressLine1')(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="town">Town</label>
            <input id="town" value={form.town}
              onChange={(e) => set('town')(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="postcode">Postcode</label>
            <input id="postcode" value={form.postcode}
              onChange={(e) => set('postcode')(e.target.value)} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="gp">GP surgery</label>
            <SearchSelect
              id="gp"
              value={form.gpSurgeryId}
              onChange={set('gpSurgeryId')}
              emptyLabel="Not known"
              options={surgeries.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-4 flex items-start gap-1.5 text-[13.5px] text-stop-700">
            <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy || blockedByDuplicates}
          className={cn(
            'mt-5 flex items-center gap-2 rounded-control px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
            busy || blockedByDuplicates ? 'cursor-not-allowed bg-ink-faint' : 'bg-brand-600 hover:bg-brand-700',
          )}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          {blockedByDuplicates ? 'Check the similar records first' : 'Create record'}
        </button>
      </form>
    </div>
  );
}
