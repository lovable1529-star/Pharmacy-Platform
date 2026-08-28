/**
 * A patient record.
 *
 * One timeline rather than separate tabs — consultations and submitted forms
 * merged in date order, so reconstructing what happened does not mean piecing it
 * together from three screens.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * The header gains the patient's initials in a 52px disc. On a screen that
 * looks identical for every patient, the one thing that reliably tells a
 * pharmacist they have the right record open is a shape they can recognise
 * before they have finished reading the name.
 *
 * The design also proposed "Book appointment" and "Start consultation" buttons
 * here. Neither was built: booking from a patient record would need the
 * booking screen to accept a pre-selected patient, and there is no route that
 * starts a consultation from a patient at all — consultations begin from an
 * arrived appointment. Both are behaviour, not styling, and are recorded in
 * CHANGELOG-UI.md rather than faked with a link that goes somewhere wrong.
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
import { Panel, SectionLabel, EmptyState } from '@/components/ui/primitives';

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
    <div className="page-shell mx-auto max-w-[calc(880px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link href="/patients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={2} /> All patients
      </Link>

      <Panel className="mb-5 px-[22px] py-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-100 font-mono text-[15px] font-medium text-brand-700">
            {patient.firstName[0]}
            {patient.lastName[0]}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-[1.15] text-ink">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="tabular mt-0.5 font-mono text-[13px] text-ink-faint">
              {formatDate(patient.dateOfBirth)} · {ageInYears(patient.dateOfBirth)} years
              {patient.gender ? ` · ${patient.gender}` : ''}
            </p>
          </div>
          <Link
            href={`/patients/${patient.id}/edit`}
            className="flex shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            <Pencil size={13} strokeWidth={2.2} />
            Edit details
          </Link>
        </div>

        <dl className="mt-[18px] grid gap-3.5 sm:grid-cols-2">
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
      </Panel>

      <AllergiesPanel patientId={patient.id} allergies={allergies} />

      <EnrolmentPanel
        patientId={patient.id}
        enrolments={enrolments}
        services={repeatServices}
      />

      <SectionLabel className="mb-2.5">History</SectionLabel>

      {timeline.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing recorded yet"
            body="Consultations and submitted forms appear here in date order."
          />
        </Panel>
      ) : (
        <Panel as="ol" className="[&>li:last-child]:border-b-0">
          {timeline.map((entry) => (
            <li
              key={`${entry.kind}-${entry.id}`}
              className="flex items-start gap-3.5 border-b border-line-soft px-5 py-3.5 transition-colors hover:bg-sunk"
            >
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
        </Panel>
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
