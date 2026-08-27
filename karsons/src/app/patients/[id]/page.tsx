'use client';

/**
 * Patient record.
 *
 * Alerts and allergies sit above everything else. A pharmacist opening this
 * screen mid-consultation must see "interpreter required" and "allergic to egg"
 * before they see anything administrative.
 */

import { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  APPOINTMENTS, CONSULTATIONS, MESSAGES, REPEAT_REQUESTS,
  branchName, findPatient, findSurgery,
} from '@/lib/demo/data';
import { ageInYears } from '@/lib/patients/search';

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface TimelineEntry {
  at: Date;
  kind: string;
  title: string;
  detail: string;
}

export default function PatientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const patient = findPatient(id);

  if (!patient) notFound();

  const surgery = findSurgery(patient.gpSurgeryId);

  // One merged timeline rather than separate tabs — a clinical history reads as
  // a sequence, not as a set of unrelated tables.
  const timeline: TimelineEntry[] = [
    ...CONSULTATIONS.filter((c) => c.patientId === id).map((c) => ({
      at: c.completedAt,
      kind: 'Consultation',
      title: c.serviceName,
      detail: `${c.clinicianName} at ${branchName(c.branchId)} · batch ${c.batchNumber} · ${c.fundingType}`,
    })),
    ...APPOINTMENTS.filter((a) => a.patientId === id).map((a) => ({
      at: a.startsAt,
      kind: 'Appointment',
      title: a.serviceName,
      detail: `${branchName(a.branchId)} · ${a.status.toLowerCase()}`,
    })),
    ...REPEAT_REQUESTS.filter((r) => r.patientId === id).map((r) => ({
      at: r.submittedAt,
      kind: 'Repeat request',
      title: `${r.medicine} ${r.requestedStrength}`,
      detail: `Requested from ${r.currentStrength}`,
    })),
    ...MESSAGES.slice(0, 1).map((m) => ({
      at: m.sentAt,
      kind: 'Message',
      title: 'GP notification sent',
      detail: `${m.surgeryName} · ${m.status.toLowerCase()}`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/patients" className="mb-4 inline-block text-sm font-semibold text-brand-600">
        ← Back to search
      </Link>

      {/* Safety-critical information first. */}
      {(patient.alerts.length > 0 || patient.allergies.length > 0) && (
        <div className="mb-4 space-y-2">
          {patient.allergies.map((allergy) => (
            <div key={allergy.substance} role="alert"
              className="rounded-card border border-triage-red-700 bg-triage-red-100 px-4 py-3">
              <span className="mr-2 rounded bg-triage-red-700 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                Allergy
              </span>
              <span className="font-semibold">{allergy.substance}</span>
              {allergy.severity && <span className="ml-2 text-sm">— {allergy.severity}</span>}
            </div>
          ))}
          {patient.alerts.map((alert) => (
            <div key={alert} className="rounded-card border border-triage-amber-700 bg-triage-amber-100 px-4 py-3">
              <span className="mr-2 rounded bg-triage-amber-700 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                Alert
              </span>
              <span className="font-semibold">{alert}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 rounded-card border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl">{patient.firstName} {patient.lastName}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              <span className="font-mono">{formatDate(patient.dateOfBirth)}</span>
              {' · '}{ageInYears(patient.dateOfBirth)} years
              {' · '}{patient.gender}
            </p>
          </div>
          <Link href={`/consultations/new?patient=${patient.id}`}
            className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">
            Start consultation
          </Link>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-3"><dt className="w-24 text-ink-soft">Phone</dt><dd className="font-semibold">{patient.phone}</dd></div>
          <div className="flex gap-3"><dt className="w-24 text-ink-soft">Email</dt><dd className="truncate font-semibold">{patient.email}</dd></div>
          <div className="flex gap-3"><dt className="w-24 text-ink-soft">Address</dt><dd className="font-semibold">{patient.addressLine1}, {patient.town}, {patient.postcode}</dd></div>
          <div className="flex gap-3"><dt className="w-24 text-ink-soft">GP surgery</dt><dd className="font-semibold">{surgery?.name ?? 'Not recorded'}</dd></div>
        </dl>
      </div>

      <section className="rounded-card border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base">History</h2>
        </div>
        {timeline.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-soft">
            Nothing recorded for this patient yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {timeline.map((entry, index) => (
              <li key={index} className="flex gap-4 px-5 py-3.5">
                <div className="w-24 flex-none text-xs text-ink-soft">
                  <div className="font-mono">{formatDate(entry.at)}</div>
                  <div>{entry.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-brand-600">{entry.kind}</div>
                  <div className="font-semibold">{entry.title}</div>
                  <div className="text-sm text-ink-soft">{entry.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
