'use client';

/**
 * Repeat Care on the patient record.
 *
 * Shows whether this patient is authorised to request repeat supply online,
 * what they are currently on, and what their progress is measured against.
 *
 * The status is the part that matters operationally. Pausing someone means
 * "must be seen before the next supply", and that has to be visible on the
 * record rather than buried in a settings screen — otherwise the next
 * pharmacist has no idea why a request was blocked.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Repeat, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import { formatDate } from '@/lib/units';
import { saveEnrolment, setEnrolmentStatus } from './enrolment-actions';

export interface EnrolmentRow {
  id: string;
  serviceId: string;
  serviceName: string;
  status: string;
  externalRef: string | null;
  heightCm: string | null;
  startingWeightKg: string | null;
  startingWaistCm: string | null;
  medicine: string | null;
  strength: string | null;
  strengthSince: string | null;
  lastSuppliedAt: Date | null;
  lastWeightKg: string | null;
  notes: string | null;
  enrolledAt: Date;
  enrolledByName: string | null;
}

const label = 'mb-1.5 block text-[12.5px] font-medium text-ink-soft';
const input =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand-400';

export function EnrolmentPanel({
  patientId,
  enrolments,
  services,
}: {
  patientId: string;
  enrolments: EnrolmentRow[];
  services: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EnrolmentRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = editing === 'new' ? null : editing;

  const [form, setForm] = useState({
    serviceId: '',
    externalRef: '',
    heightCm: '',
    startingWeightKg: '',
    startingWaistCm: '',
    medicine: '',
    strength: '',
    strengthSince: '',
    notes: '',
  });

  function open(row: EnrolmentRow | 'new') {
    setError(null);
    setEditing(row);
    if (row === 'new') {
      setForm({
        serviceId: services[0]?.id ?? '',
        externalRef: '', heightCm: '', startingWeightKg: '', startingWaistCm: '',
        medicine: '', strength: '', strengthSince: '', notes: '',
      });
    } else {
      setForm({
        serviceId: row.serviceId,
        externalRef: row.externalRef ?? '',
        heightCm: row.heightCm ?? '',
        startingWeightKg: row.startingWeightKg ?? '',
        startingWaistCm: row.startingWaistCm ?? '',
        medicine: row.medicine ?? '',
        strength: row.strength ?? '',
        strengthSince: row.strengthSince ?? '',
        notes: row.notes ?? '',
      });
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await saveEnrolment({
      patientId,
      serviceId: form.serviceId,
      externalRef: form.externalRef || null,
      heightCm: form.heightCm || null,
      startingWeightKg: form.startingWeightKg || null,
      startingWaistCm: form.startingWaistCm || null,
      medicine: form.medicine || null,
      strength: form.strength || null,
      strengthSince: form.strengthSince || null,
      notes: form.notes || null,
    });
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save.');
    else {
      setEditing(null);
      router.refresh();
    }
  }

  async function changeStatus(row: EnrolmentRow, status: 'ACTIVE' | 'PAUSED' | 'STOPPED') {
    setBusy(true);
    await setEnrolmentStatus(patientId, row.id, status);
    setBusy(false);
    router.refresh();
  }

  if (services.length === 0 && enrolments.length === 0) return null;

  return (
    <section className="mb-5 overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
      <div className="flex items-center gap-2 border-b border-line bg-sunk px-4 py-2.5">
        <Repeat size={13} strokeWidth={2.2} className="text-ink-faint" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
          Repeat care
        </span>
        {services.length > 0 ? (
          <button
            type="button"
            onClick={() => open('new')}
            className="ml-auto rounded-[6px] border border-line bg-surface px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            {enrolments.length === 0 ? 'Enrol' : 'Enrol in another service'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="border-b border-line-soft bg-stop-50 px-4 py-2 text-[13px] text-stop-700">
          {error}
        </p>
      ) : null}

      {enrolments.length === 0 ? (
        <p className="px-4 py-3.5 text-[13.5px] text-ink-faint">
          Not enrolled. Until they are, a repeat request from this patient is
          turned away and they are asked to book an appointment.
        </p>
      ) : (
        enrolments.map((e) => (
          <div key={e.id} className="border-b border-line-soft px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium text-ink">{e.serviceName}</span>
              <span
                className={cn(
                  'rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                  e.status === 'ACTIVE'
                    ? 'bg-safe-100 text-safe-700'
                    : e.status === 'PAUSED'
                      ? 'bg-review-100 text-review-700'
                      : 'bg-sunk text-ink-faint',
                )}
              >
                {e.status}
              </span>
              {e.externalRef ? (
                <span className="font-mono text-[11.5px] text-ink-faint">
                  {e.externalRef}
                </span>
              ) : null}

              <div className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={() => open(e)}
                  className="rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-soft hover:border-brand-300 hover:text-ink"
                >
                  Edit
                </button>
                {e.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(e, 'PAUSED')}
                    className="rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-soft hover:border-review-200 hover:text-review-700"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(e, 'ACTIVE')}
                    className="rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-soft hover:border-safe-200 hover:text-safe-700"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </div>

            <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[13px]">
              {e.medicine ? (
                <div className="flex gap-1.5">
                  <dt className="text-ink-faint">On</dt>
                  <dd className="m-0 text-ink-soft">
                    {e.medicine}{e.strength ? ` ${e.strength}` : ''}
                    {e.strengthSince ? ` since ${formatDate(e.strengthSince)}` : ''}
                  </dd>
                </div>
              ) : null}
              {e.startingWeightKg ? (
                <div className="flex gap-1.5">
                  <dt className="text-ink-faint">Started at</dt>
                  <dd className="m-0 text-ink-soft">{e.startingWeightKg} kg</dd>
                </div>
              ) : null}
              {e.lastWeightKg ? (
                <div className="flex gap-1.5">
                  <dt className="text-ink-faint">Last</dt>
                  <dd className="m-0 text-ink-soft">{e.lastWeightKg} kg</dd>
                </div>
              ) : null}
              {e.heightCm ? (
                <div className="flex gap-1.5">
                  <dt className="text-ink-faint">Height</dt>
                  <dd className="m-0 text-ink-soft">{e.heightCm} cm</dd>
                </div>
              ) : null}
            </dl>

            {e.notes ? (
              <p className="mt-1 text-[13px] text-ink-soft">{e.notes}</p>
            ) : null}

            <p className="mt-1 font-mono text-[11px] text-ink-faint">
              Enrolled {formatDate(e.enrolledAt.toISOString().slice(0, 10))}
              {e.enrolledByName ? ` by ${e.enrolledByName}` : ''}
            </p>
          </div>
        ))
      )}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4 py-8">
          <div className="max-h-full w-full max-w-[560px] overflow-auto rounded-panel border border-line bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h3 className="font-display text-[16px] font-semibold text-ink">
                {current ? 'Edit repeat care' : 'Enrol in repeat care'}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-faint hover:bg-sunk hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-3.5 px-5 py-4">
              <p className="m-0 rounded-control border border-brand-200 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
                Enrolling confirms a pharmacist has assessed this patient and is
                content for them to request repeat supply online. It is recorded
                against your name.
              </p>

              <div>
                <label className={label} htmlFor="en-service">Service</label>
                <SearchSelect
                  id="en-service"
                  value={form.serviceId}
                  onChange={(next) => setForm({ ...form, serviceId: next })}
                  disabled={Boolean(current)}
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="min-w-[150px] flex-1">
                  <label className={label} htmlFor="en-ref">Pharmadoctor ID</label>
                  <input
                    id="en-ref"
                    value={form.externalRef}
                    onChange={(e) => setForm({ ...form, externalRef: e.target.value })}
                    className={cn(input, 'font-mono')}
                  />
                </div>
                <div className="min-w-[110px]">
                  <label className={label} htmlFor="en-height">Height (cm)</label>
                  <input
                    id="en-height"
                    inputMode="decimal"
                    value={form.heightCm}
                    onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
                    className={cn(input, 'tabular')}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="min-w-[140px] flex-1">
                  <label className={label} htmlFor="en-weight">Starting weight (kg)</label>
                  <input
                    id="en-weight"
                    inputMode="decimal"
                    value={form.startingWeightKg}
                    onChange={(e) => setForm({ ...form, startingWeightKg: e.target.value })}
                    className={cn(input, 'tabular')}
                  />
                </div>
                <div className="min-w-[140px] flex-1">
                  <label className={label} htmlFor="en-waist">Starting waist (cm)</label>
                  <input
                    id="en-waist"
                    inputMode="decimal"
                    value={form.startingWaistCm}
                    onChange={(e) => setForm({ ...form, startingWaistCm: e.target.value })}
                    className={cn(input, 'tabular')}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="min-w-[150px] flex-1">
                  <label className={label} htmlFor="en-medicine">Medicine</label>
                  <input
                    id="en-medicine"
                    value={form.medicine}
                    onChange={(e) => setForm({ ...form, medicine: e.target.value })}
                    className={input}
                    placeholder="Mounjaro"
                  />
                </div>
                <div className="min-w-[110px]">
                  <label className={label} htmlFor="en-strength">Strength</label>
                  <input
                    id="en-strength"
                    value={form.strength}
                    onChange={(e) => setForm({ ...form, strength: e.target.value })}
                    className={input}
                    placeholder="5 mg"
                  />
                </div>
                <div className="min-w-[140px]">
                  <label className={label} htmlFor="en-since">On it since</label>
                  <input
                    id="en-since"
                    type="date"
                    value={form.strengthSince}
                    onChange={(e) => setForm({ ...form, strengthSince: e.target.value })}
                    className={cn(input, 'font-mono')}
                  />
                  <p className="mt-1 text-[12px] text-ink-faint">
                    Drives the 3 and 6 week rules
                  </p>
                </div>
              </div>

              <div>
                <label className={label} htmlFor="en-notes">Notes</label>
                <textarea
                  id="en-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={input}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !form.serviceId}
                onClick={submit}
                className={cn(
                  'flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700',
                  (busy || !form.serviceId) &&
                    'cursor-not-allowed opacity-40 hover:bg-brand-600',
                )}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                {current ? 'Save' : 'Enrol patient'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
