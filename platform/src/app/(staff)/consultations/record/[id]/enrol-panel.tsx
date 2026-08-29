'use client';

/**
 * Putting a patient on repeat care, from the consultation that justified it.
 *
 * Enrolment is step one of the GLP-1 workflow and it was the step nobody could
 * find. It lived only on the patient record, several clicks away, behind a form
 * asking for height, weight, waist, medicine and strength — every one of which
 * the consultation on this page had just collected.
 *
 * The cost of that was not inconvenience. `repeat_enrolment` was empty, so the
 * repeat gate rejected every patient, no repeat request could ever be made, and
 * the published rules had never run once. The chain was complete except for the
 * one link a human had to remember.
 *
 * So it is offered here, at the moment a pharmacist has just decided the patient
 * should be on it, with the baseline already filled in from what they answered.
 * They confirm it rather than retype it — but they DO confirm it, because the
 * baseline is what every later decision is measured against, and the person
 * enrolling is the one taking clinical responsibility for it.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Repeat, Check, TriangleAlert, ChevronRight } from 'lucide-react';
import { saveEnrolment } from '@/app/(staff)/patients/[id]/enrolment-actions';
import type { EnrolmentBaseline } from '@/lib/clinical/enrolment-baseline';

const labelClass = 'mb-1.5 block text-[12.5px] font-medium text-ink-soft';
const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)]';

export interface EnrolPanelProps {
  patientId: string;
  patientName: string;
  /** Services of kind REPEAT_SUPPLY. Empty means there is nothing to enrol into. */
  services: { id: string; name: string }[];
  /** Set when they are already on repeat care, so this becomes a statement not an offer. */
  existing: { serviceName: string; status: string } | null;
  baseline: EnrolmentBaseline;
  /** What each blank baseline value will cost, in rules that stop applying. */
  gaps: string[];
}

export function EnrolPanel({
  patientId, patientName, services, existing, baseline, gaps,
}: EnrolPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [form, setForm] = useState<EnrolmentBaseline>(baseline);
  const [externalRef, setExternalRef] = useState('');
  const [notes, setNotes] = useState('');

  const set = (key: keyof EnrolmentBaseline) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Nothing to offer: this organisation has no repeat service configured.
  if (services.length === 0 && !existing) return null;

  /*
   * Already on it. Stated quietly rather than hidden — "is she on repeat care?"
   * is a question this page should answer, and an absent panel answers it only
   * by implication.
   */
  if (existing || done) {
    const name =
      existing?.serviceName
      ?? services.find((s) => s.id === serviceId)?.name
      ?? 'repeat care';
    const paused = existing != null && existing.status !== 'ACTIVE';

    return (
      <section className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-safe-200 bg-safe-50 px-4 py-3">
        <Check size={15} strokeWidth={2.4} className="shrink-0 text-safe-700" />
        <p className="m-0 min-w-0 flex-1 text-[13.5px] text-safe-900">
          On repeat care for <strong className="font-semibold">{name}</strong>
          {paused ? (
            <span className="ml-1.5 font-mono text-[11px] uppercase tracking-wide text-review-700">
              · {existing.status.toLowerCase()}
            </span>
          ) : null}
          {done ? ' — they can now request repeat supply online.' : null}
        </p>
        <Link
          href={`/patients/${patientId}`}
          className="shrink-0 text-[13px] font-medium text-safe-700 underline-offset-2 hover:underline"
        >
          Baseline on their record
        </Link>
      </section>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const result = await saveEnrolment({
      patientId,
      serviceId,
      externalRef: externalRef || null,
      heightCm: form.heightCm || null,
      startingWeightKg: form.startingWeightKg || null,
      startingWaistCm: form.startingWaistCm || null,
      medicine: form.medicine || null,
      strength: form.strength || null,
      strengthSince: form.strengthSince || null,
      notes: notes || null,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
    router.refresh();
  }

  // Collapsed: a prompt, not a form. This page is for reading a finished record.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-5 flex w-full items-center gap-3 rounded-panel border border-brand-200 bg-brand-50 px-4 py-3 text-left transition-colors hover:border-brand-400"
      >
        <Repeat size={15} strokeWidth={2.2} className="shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-ink">
            Put {patientName.split(' ')[0]} on repeat care
          </span>
          <span className="block text-[12.5px] text-ink-soft">
            Lets them request repeat supply online. The baseline is filled in from this
            consultation.
          </span>
        </span>
        <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-brand-600" />
      </button>
    );
  }

  return (
    <section className="mb-5 overflow-hidden rounded-panel border border-brand-200 bg-surface shadow-panel">
      <div className="flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
        <Repeat size={13} strokeWidth={2.2} className="text-brand-600" />
        <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-brand-700">
          Put on repeat care
        </span>
      </div>

      <div className="px-4 py-4">
        <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
          Taken from this consultation. Check it before confirming — every later decision is
          measured against these numbers, not re-read from the form.
        </p>

        {gaps.length > 0 ? (
          <div className="mb-4 rounded-control border border-review-200 bg-review-50 px-3 py-2.5">
            <p className="m-0 mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-review-900">
              <TriangleAlert size={13} strokeWidth={2.4} />
              This consultation did not record everything
            </p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {gaps.map((gap) => (
                <li key={gap} className="text-[12.5px] leading-relaxed text-review-900">
                  {gap}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {services.length > 1 ? (
          <div className="mb-4">
            <label htmlFor="enrol-service" className={labelClass}>Service</label>
            <select
              id="enrol-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={inputClass}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field
            id="enrol-weight"
            label="Starting weight (kg)"
            value={form.startingWeightKg}
            onChange={set('startingWeightKg')}
          />
          <Field
            id="enrol-height"
            label="Height (cm)"
            value={form.heightCm}
            onChange={set('heightCm')}
          />
          <Field
            id="enrol-waist"
            label="Waist (cm)"
            value={form.startingWaistCm}
            onChange={set('startingWaistCm')}
          />
          <Field
            id="enrol-medicine"
            label="Medicine"
            value={form.medicine}
            onChange={set('medicine')}
          />
          <Field
            id="enrol-strength"
            label="Strength"
            value={form.strength}
            onChange={set('strength')}
          />
          <Field
            id="enrol-since"
            label="On this dose since"
            type="date"
            value={form.strengthSince}
            onChange={set('strengthSince')}
          />
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="enrol-ref" className={labelClass}>
              Repeat Care ID <span className="font-normal text-ink-faint">— optional</span>
            </label>
            <input
              id="enrol-ref"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="Left blank, one is generated"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="enrol-notes" className={labelClass}>
              Note <span className="font-normal text-ink-faint">— optional</span>
            </label>
            <input
              id="enrol-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="mb-3 text-[13px] text-stop-700">{error}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !serviceId}
            className="flex items-center gap-1.5 rounded-control bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {busy
              ? <Loader2 size={14} className="animate-spin" />
              : <Check size={14} strokeWidth={2.4} />}
            Confirm and enrol
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
        </div>

        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
          Enrolling is a clinical authorisation — it is recorded against your name, and it is what
          allows this patient to request supply without being seen each time.
        </p>
      </div>
    </section>
  );
}

function Field({
  id, label, value, onChange, type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
