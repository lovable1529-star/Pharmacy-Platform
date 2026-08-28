/**
 * A patient record.
 *
 * One timeline rather than separate tabs — consultations and submitted forms
 * merged in date order, so reconstructing what happened does not mean piecing it
 * together from three screens.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, Phone, MapPin, Stethoscope, Pencil } from 'lucide-react';
import { getAllergies } from './allergy-actions';
import { AllergiesPanel } from './allergies-panel';
import { getEnrolments, getRepeatServices } from './enrolment-actions';
import { EnrolmentPanel } from './enrolment-panel';
import { getStaffContext } from '@/lib/auth/context';
import { getPatient, getPatientTimeline } from '@/lib/queries/clinical';
import { formatDate, formatDateTime } from '@/lib/units';
import { ageInYears } from '@/lib/patients/search';

export const dynamic = 'force-dynamic';

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await getStaffContext();
  const { id } = await params;

  const patient = await getPatient(actor.organisationId, id);
  if (!patient) notFound();

  const [allergies, enrolments, repeatServices] = await Promise.all([
    getAllergies(patient.id),
    getEnrolments(patient.id),
    getRepeatServices(actor.organisationId),
  ]);

  const timeline = await getPatientTimeline(actor.organisationId, id);

  return (
    <div className="mx-auto max-w-[880px] px-6 py-8">
      <Link href="/patients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={2} /> All patients
      </Link>

      <div className="mb-6 rounded-[10px] border border-line bg-surface px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[26px] leading-tight text-ink">
            {patient.firstName} {patient.lastName}
          </h1>
          <Link
            href={`/patients/${patient.id}/edit`}
            className="flex items-center gap-1.5 rounded-[7px] border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            <Pencil size={13} strokeWidth={2.2} />
            Edit details
          </Link>
        </div>
        <p className="tabular mt-1 font-mono text-[13px] text-ink-faint">
          {formatDate(patient.dateOfBirth)} · {ageInYears(patient.dateOfBirth)} years
          {patient.gender ? ` · ${patient.gender}` : ''}
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {patient.phone ? <Detail icon={<Phone size={13} />} label="Phone" value={patient.phone} /> : null}
          {patient.email ? <Detail icon={<Mail size={13} />} label="Email" value={patient.email} /> : null}
          {patient.addressLine1 ? (
            <Detail
              icon={<MapPin size={13} />}
              label="Address"
              value={[patient.addressLine1, patient.town, patient.postcode].filter(Boolean).join(', ')}
            />
          ) : null}
          {patient.gpSurgeryName ? (
            <Detail
              icon={<Stethoscope size={13} />}
              label="GP surgery"
              value={patient.gpSurgeryName}
              hint={patient.gpSurgeryEmail}
            />
          ) : null}
        </dl>
      </div>

      <AllergiesPanel patientId={patient.id} allergies={allergies} />

      <EnrolmentPanel
        patientId={patient.id}
        enrolments={enrolments}
        services={repeatServices}
      />

      <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
        History
      </h2>

      {timeline.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-[14px] text-ink-soft">Nothing recorded yet.</p>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-[10px] border border-line bg-surface">
          {timeline.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="flex items-start gap-3.5 border-b border-line-soft px-5 py-3.5 last:border-b-0">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${entry.kind === 'consultation' ? 'bg-safe-600' : 'bg-brand-400'}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">{entry.title}</span>
                <span className="block text-[12.5px] text-ink-faint">
                  {[entry.detail, entry.branchName].filter(Boolean).join(' · ') || entry.status}
                </span>
              </span>
              <span className="tabular shrink-0 font-mono text-[11.5px] text-ink-faint">
                {formatDateTime(entry.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Detail({
  icon, label, value, hint,
}: { icon: React.ReactNode; label: string; value: string; hint?: string | null }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1 shrink-0 text-ink-faint">{icon}</span>
      <div className="min-w-0">
        <dt className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-faint">{label}</dt>
        <dd className="truncate text-[13.5px] text-ink">{value}</dd>
        {hint ? <dd className="truncate font-mono text-[11px] text-ink-faint">{hint}</dd> : null}
      </div>
    </div>
  );
}
