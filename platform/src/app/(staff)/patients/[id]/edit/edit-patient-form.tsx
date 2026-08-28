'use client';

/**
 * Correcting a patient's details.
 *
 * Deliberately warns before changing a date of birth. It is the field every
 * other record keys off — a vaccination history, an age-based eligibility rule,
 * a GP match — and it is also the field most often typed wrong in the first
 * place. Changing it is legitimate and must stay possible; doing it by accident
 * while fixing a postcode must not be.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { updatePatient } from '../actions';
import 'react-phone-number-input/style.css';

export interface EditablePatient {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string | null;
  genderSelfDescribed: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  town: string | null;
  postcode: string | null;
  gpSurgeryId: string | null;
}

const labelCls = 'mb-1.5 block text-[13px] font-medium text-ink-soft';
const inputCls =
  'w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[15px] text-ink outline-none focus:border-brand-400';

export function EditPatientForm({
  patient,
  surgeries,
}: {
  patient: EditablePatient;
  surgeries: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth,
    gender: patient.gender ?? '',
    genderSelfDescribed: patient.genderSelfDescribed ?? '',
    email: patient.email ?? '',
    addressLine1: patient.addressLine1 ?? '',
    town: patient.town ?? '',
    postcode: patient.postcode ?? '',
    gpSurgeryId: patient.gpSurgeryId ?? '',
  });
  const [phone, setPhone] = useState<string | undefined>(patient.phone ?? undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const dobChanged = form.dateOfBirth !== patient.dateOfBirth;
  const phoneValid = !phone || isValidPhoneNumber(phone);
  const emailValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const canSave =
    Boolean(form.firstName.trim() && form.lastName.trim() && form.dateOfBirth) &&
    phoneValid && emailValid && !busy;

  async function save() {
    setBusy(true);
    setError(null);

    const result = await updatePatient({
      id: patient.id,
      firstName: form.firstName,
      lastName: form.lastName,
      dateOfBirth: form.dateOfBirth,
      gender: form.gender || null,
      genderSelfDescribed: form.genderSelfDescribed || null,
      phone: phone ?? null,
      email: form.email.trim() || null,
      addressLine1: form.addressLine1.trim() || null,
      town: form.town.trim() || null,
      postcode: form.postcode.trim() || null,
      gpSurgeryId: form.gpSurgeryId || null,
    });

    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save those changes.');
    else router.push(`/patients/${patient.id}`);
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-[10px] border border-line bg-surface p-5">
        <div className="flex flex-wrap gap-3.5">
          <div className="min-w-[200px] flex-1">
            <label className={labelCls} htmlFor="firstName">First name</label>
            <input
              id="firstName"
              value={form.firstName}
              onChange={(e) => set('firstName')(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className={labelCls} htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              value={form.lastName}
              onChange={(e) => set('lastName')(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-3.5">
          <div className="min-w-[200px] flex-1">
            <label className={labelCls} htmlFor="dateOfBirth">Date of birth</label>
            <input
              id="dateOfBirth"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => set('dateOfBirth')(e.target.value)}
              className={cn(inputCls, dobChanged && 'border-review-600')}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className={labelCls} htmlFor="gender">Gender</label>
            <input
              id="gender"
              value={form.gender}
              onChange={(e) => set('gender')(e.target.value)}
              className={inputCls}
              placeholder="Free text"
            />
          </div>
        </div>

        {dobChanged ? (
          <p className="mt-2.5 flex items-start gap-1.5 rounded-[8px] border border-review-200 bg-review-50 px-3 py-2 text-[13px] text-review-700">
            <AlertTriangle size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" />
            <span>
              You are changing the date of birth from{' '}
              <strong>{patient.dateOfBirth}</strong>. Age-based eligibility and the
              vaccination history key off this — make sure it is a correction, not a
              different patient.
            </span>
          </p>
        ) : null}
      </div>

      <div className="rounded-[10px] border border-line bg-surface p-5">
        <div className="flex flex-wrap gap-3.5">
          <div className="min-w-[220px] flex-1">
            <label className={labelCls} htmlFor="phone">Phone</label>
            <PhoneInput
              id="phone"
              international
              defaultCountry="IM"
              value={phone}
              onChange={setPhone}
              className={cn('karsons-phone', !phoneValid && 'border-stop-600')}
            />
            {!phoneValid ? (
              <p className="mt-1 text-[12.5px] text-stop-700">
                That number does not look valid.
              </p>
            ) : null}
          </div>
          <div className="min-w-[220px] flex-1">
            <label className={labelCls} htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
              className={cn(inputCls, !emailValid && 'border-stop-600')}
            />
            {!emailValid ? (
              <p className="mt-1 text-[12.5px] text-stop-700">
                That does not look like an email address.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3.5">
          <label className={labelCls} htmlFor="addressLine1">Address</label>
          <input
            id="addressLine1"
            value={form.addressLine1}
            onChange={(e) => set('addressLine1')(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="mt-3.5 flex flex-wrap gap-3.5">
          <div className="min-w-[200px] flex-1">
            <label className={labelCls} htmlFor="town">Town</label>
            <input
              id="town"
              value={form.town}
              onChange={(e) => set('town')(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className={labelCls} htmlFor="postcode">Postcode</label>
            <input
              id="postcode"
              value={form.postcode}
              onChange={(e) => set('postcode')(e.target.value.toUpperCase())}
              className={cn(inputCls, 'tabular font-mono')}
            />
          </div>
        </div>

        <div className="mt-3.5">
          <label className={labelCls} htmlFor="gpSurgeryId">GP surgery</label>
          <select
            id="gpSurgeryId"
            value={form.gpSurgeryId}
            onChange={(e) => set('gpSurgeryId')(e.target.value)}
            className={inputCls}
          >
            <option value="">Not recorded</option>
            {surgeries.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push(`/patients/${patient.id}`)}
          className="rounded-[7px] border border-line px-4 py-2 text-[13.5px] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className={cn(
            'flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700',
            !canSave && 'cursor-not-allowed opacity-40 hover:bg-brand-600',
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.6} />}
          Save changes
        </button>
      </div>
    </div>
  );
}
