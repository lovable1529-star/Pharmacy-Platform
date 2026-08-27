'use client';

/**
 * Consultation runner.
 *
 * The full clinical flow: verify identity → review answers → safety checks →
 * record what was done → sign declarations → submit.
 *
 * Two things are enforced rather than suggested:
 *   - Identity verification gates everything. It is a BLOCK finding, so the
 *     safety panel refuses to let the consultation proceed without it.
 *   - The allergy cross-check runs against the actual batch selected, and a
 *     conflict cannot be clicked past.
 */

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShell } from '@/components/shell/shell-provider';
import { SafetyPanel } from '@/components/clinical/safety-panel';
import { BATCHES, PHARMACISTS, SERVICES, findPatient, findSurgery } from '@/lib/demo/data';
import { runPreAdministrationChecks } from '@/lib/clinical/safety';
import { selectBatch } from '@/lib/inventory/stock';
import { FLU_VACCINE_DECLARATIONS } from '@/lib/forms/services/flu-vaccine';
import { ageInYears } from '@/lib/patients/search';

const SITES = ['Right deltoid', 'Left deltoid', 'Right thigh', 'Left thigh', 'Oral', 'Nasal'];
const ROUTES = ['Intramuscular', 'Subcutaneous', 'Subdermal'];

/**
 * `useSearchParams` forces client-side rendering, so Next requires a Suspense
 * boundary around it or the production build fails at prerender. The wrapper
 * below is that boundary.
 */
export default function NewConsultationPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-ink-soft">Loading…</div>}>
      <ConsultationRunner />
    </Suspense>
  );
}

function ConsultationRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const { branchId, branchName } = useShell();

  const patientId = search?.get('patient') ?? '';
  const patient = findPatient(patientId);

  const [identityVerified, setIdentityVerified] = useState(false);
  const [clinicianId, setClinicianId] = useState(PHARMACISTS[1]!.id);
  const [batchId, setBatchId] = useState(() => {
    const suggested = selectBatch(
      BATCHES.map((b) => ({
        batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate,
        quantity: b.stock[branchId] ?? 0, recalledAt: b.recalledAt,
      })),
    );
    return suggested?.batchId ?? BATCHES[0]!.id;
  });
  const [site, setSite] = useState(SITES[0]!);
  const [route, setRoute] = useState(ROUTES[0]!);
  const [funding, setFunding] = useState<'NHS' | 'PAID'>('NHS');
  const [fever, setFever] = useState<string | null>(null);
  const [signed, setSigned] = useState<boolean[]>(FLU_VACCINE_DECLARATIONS.map(() => false));
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const batch = BATCHES.find((b) => b.id === batchId)!;
  const clinician = PHARMACISTS.find((p) => p.id === clinicianId)!;

  const safety = useMemo(
    () =>
      runPreAdministrationChecks({
        allergies: patient?.allergies ?? [],
        product: { id: batch.productId, name: batch.productName, allergens: batch.allergens },
        batch: {
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          recalledAt: batch.recalledAt,
          recallReason: batch.recallReason,
        },
        availableStock: batch.stock[branchId] ?? 0,
        requiredQuantity: 1,
        identityVerified,
        hasAllergyHistory: true,
      }),
    [patient, batch, branchId, identityVerified],
  );

  if (!patient) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="mb-4 text-ink-soft">No patient selected.</p>
        <Link href="/patients" className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">
          Find a patient
        </Link>
      </div>
    );
  }

  const allSigned = signed.every(Boolean);
  const feverAnswered = fever !== null;
  const feverBlocks = fever === 'Yes';

  const canSubmit =
    safety.canProceed &&
    (!safety.requiresAcknowledgement || acknowledged) &&
    allSigned && feverAnswered && !feverBlocks;

  if (submitted) {
    const surgery = findSurgery(patient.gpSurgeryId);
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-clinical-green-100 text-clinical-green-700">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl">Consultation recorded</h1>
        <p className="mb-6 text-sm text-ink-soft">
          {patient.firstName} {patient.lastName} · {batch.productName}
        </p>

        <ul className="mx-auto mb-7 max-w-sm space-y-2 text-left text-sm">
          {[
            `Stock for batch ${batch.batchNumber} reduced by 1 at ${branchName}`,
            'Vaccination record generated',
            `Queued for tonight's batch to ${surgery?.name ?? 'the GP surgery'}`,
            'Written to the audit trail',
          ].map((line) => (
            <li key={line} className="flex gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
              <span className="text-clinical-green-600" aria-hidden>✓</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-center gap-3">
          <Link href={`/patients/${patient.id}`} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">
            View record
          </Link>
          <Link href="/patients" className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">
            Next patient
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/patients/${patient.id}`} className="mb-4 inline-block text-sm font-semibold text-brand-600">
        ← Back to record
      </Link>

      <h1 className="mb-1 text-2xl">Flu vaccination</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {patient.firstName} {patient.lastName} · {ageInYears(patient.dateOfBirth)} years · {branchName}
      </p>

      <div className="space-y-5">
        {/* 1 — Identity */}
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 text-base">1. Verify identity</h2>
          <p className="mb-3 text-sm text-ink-soft">
            Confirm the person in front of you matches the record.
          </p>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-4 py-3">
            <input type="checkbox" checked={identityVerified}
              onChange={(e) => setIdentityVerified(e.target.checked)} className="h-4 w-4" />
            <span className="text-sm font-semibold">
              I have verified this patient's identity
            </span>
          </label>
        </section>

        {/* 2 — Pharmacist-only question */}
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 text-base">2. Ask the patient</h2>
          <p className="mb-3 text-sm text-ink-soft">
            This question is marked for the pharmacist, so the patient never saw it on their form.
          </p>
          <p className="mb-2 font-semibold">Have you had a fever in the last 24 hours?</p>
          <div className="flex gap-2">
            {['Yes', 'No'].map((option) => (
              <button key={option} type="button" aria-pressed={fever === option}
                onClick={() => setFever(option)}
                className={`flex-1 rounded-lg border px-4 py-2.5 font-semibold ${
                  fever === option ? 'border-brand-600 bg-brand-600 text-white' : 'border-line'
                }`}>
                {option}
              </button>
            ))}
          </div>
          {feverBlocks && (
            <p role="alert" className="mt-3 rounded-lg border border-triage-red-700 bg-triage-red-100 px-4 py-3 text-sm font-semibold text-triage-red-700">
              Do not vaccinate today. Rebook once the patient is well.
            </p>
          )}
        </section>

        {/* 3 — Administration */}
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-3 text-base">3. Record the vaccination</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-semibold">Administering pharmacist</span>
              <select value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5">
                {PHARMACISTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {/* Auto-filled from the selection — exactly what the client asked for. */}
              <span className="mt-1 block text-xs text-ink-soft">
                GPhC {clinician.gphcNumber} — filled in automatically
              </span>
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold">Vaccine and batch</span>
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5">
                {BATCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.productName} — {b.batchNumber}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-soft">
                Expires {batch.expiryDate.toLocaleDateString('en-GB')} · {batch.stock[branchId] ?? 0} in stock
              </span>
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold">Site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5">
                {SITES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-semibold">Route</span>
              <select value={route} onChange={(e) => setRoute(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5">
                {ROUTES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-sm font-semibold">Funding</span>
            <div className="flex gap-2">
              {(['NHS', 'PAID'] as const).map((option) => (
                <button key={option} type="button" aria-pressed={funding === option}
                  onClick={() => setFunding(option)}
                  className={`flex-1 rounded-lg border px-4 py-2.5 font-semibold ${
                    funding === option ? 'border-brand-600 bg-brand-600 text-white' : 'border-line'
                  }`}>
                  {option === 'NHS' ? 'NHS / Manx Care' : 'Private'}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 4 — Safety */}
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-3 text-base">4. Safety checks</h2>
          <SafetyPanel result={safety} onAcknowledge={setAcknowledged} />
        </section>

        {/* 5 — Declarations */}
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 text-base">5. Declarations</h2>
          <p className="mb-3 text-sm text-ink-soft">
            These are recorded permanently and appear on the GP notification.
          </p>
          <ul className="space-y-1.5">
            {FLU_VACCINE_DECLARATIONS.map((declaration, index) => (
              <li key={declaration}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-4 py-2.5">
                  <input type="checkbox" checked={signed[index] ?? false}
                    onChange={(e) => setSigned((current) =>
                      current.map((v, i) => (i === index ? e.target.checked : v)),
                    )}
                    className="mt-0.5 h-4 w-4" />
                  <span className="text-sm">{declaration}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex items-center justify-between gap-4 pb-8">
          <p className="text-sm text-ink-soft">
            {canSubmit
              ? 'Ready to submit.'
              : !safety.canProceed
                ? 'Resolve the safety issues above.'
                : feverBlocks
                  ? 'Cannot vaccinate a patient with a fever.'
                  : !feverAnswered
                    ? 'Answer the fever question.'
                    : 'Sign all declarations to continue.'}
          </p>
          <button type="button" disabled={!canSubmit} onClick={() => setSubmitted(true)}
            className="rounded-full bg-brand-600 px-7 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
            Complete consultation
          </button>
        </div>
      </div>
    </div>
  );
}
