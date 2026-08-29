'use client';

/**
 * Sign off a supply, or record who collected it.
 *
 * One dialog, two jobs, chosen by where the prescription already is. Splitting
 * them into separate screens would mean a pharmacist who dispensed and handed
 * over in the same breath — which is most of them — has to find a second place
 * to record the second half.
 *
 * The patient's question is repeated here in full. It appears on the row
 * behind this dialog too, but a dialog covers what is behind it, and "I saw it
 * a moment ago" is exactly how a question goes unasked.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { X, Pill, MessageCircleQuestion, AlertTriangle } from 'lucide-react';
import { dispensePrescription, collectPrescription } from './actions';
import type { PrescriptionRow } from './prescriptions-view';

const control =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-300 focus:shadow-[0_0_0_3px_var(--color-brand-50)]';

export function DispenseDialog({
  row,
  clinicians,
  onClose,
}: {
  row: PrescriptionRow;
  clinicians: { id: string; fullName: string; gphcNumber: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const collecting = row.status === 'DISPENSED';

  const [clinicianId, setClinicianId] = useState('');
  const [spokenTo, setSpokenTo] = useState(false);
  const [notes, setNotes] = useState('');
  const [collectedBy, setCollectedBy] = useState(collecting ? row.patientName : '');
  const [isPatient, setIsPatient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Escape closes. A dialog that traps a pharmacist mid-counter is worse than
  // one they dismiss by accident.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ready = collecting
    ? collectedBy.trim().length > 0
    : clinicianId.length > 0 && (!row.patientQuestion || spokenTo);

  async function submit() {
    setBusy(true);
    setError(null);

    const result = collecting
      ? await collectPrescription({
        prescriptionId: row.id,
        branchId: row.branchId,
        companyId: row.companyId,
        collectedByName: collectedBy,
        isPatient,
      })
      : await dispensePrescription({
        prescriptionId: row.id,
        clinicianId,
        branchId: row.branchId,
        companyId: row.companyId,
        patientSpokenTo: spokenTo,
        notes: notes || null,
      });

    setBusy(false);
    if (!result.ok) { setError(result.error); return; }

    onClose();
    router.refresh();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={collecting ? 'Record collection' : 'Dispense'}
        className="max-h-[90dvh] w-full max-w-[460px] overflow-y-auto rounded-t-panel border border-line bg-surface p-5 shadow-lift sm:rounded-panel"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">
              {collecting ? 'Record collection' : 'Dispense'}
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              {row.patientName} · {row.medicineName}
              {row.number ? ` · ${row.number}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-control p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {row.patientQuestion ? (
          <div className="mb-4 flex items-start gap-2 rounded-control border border-brand-200 bg-brand-50 px-3 py-2.5">
            <MessageCircleQuestion size={14} strokeWidth={2.2} className="mt-0.5 shrink-0 text-brand-600" />
            <div>
              <p className="text-[12.5px] font-semibold text-brand-700">They asked:</p>
              <p className="mt-0.5 text-[13px] text-brand-700">{row.patientQuestion}</p>
            </div>
          </div>
        ) : null}

        {!row.paidOnline && row.priceMinor ? (
          <p className="mb-4 rounded-control border border-review-200 bg-review-50 px-3 py-2 text-[13px] text-review-700">
            Payment is due on collection.
          </p>
        ) : null}

        {collecting ? (
          <div className="grid gap-4">
            <div>
              <label htmlFor="collected-by" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
                Collected by
              </label>
              <input
                id="collected-by"
                className={control}
                value={collectedBy}
                onChange={(e) => setCollectedBy(e.target.value)}
                placeholder="Print their name"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={isPatient}
                className="accent-brand-600"
                onChange={(e) => setIsPatient(e.target.checked)}
              />
              <span className="text-[13.5px] text-ink">This is the patient themselves</span>
            </label>
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <label htmlFor="dispensed-by" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
                Dispensing pharmacist
              </label>
              <select
                id="dispensed-by"
                className={control}
                value={clinicianId}
                onChange={(e) => setClinicianId(e.target.value)}
              >
                <option value="">Choose…</option>
                {clinicians.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </div>

            {row.patientQuestion ? (
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={spokenTo}
                  className="mt-0.5 accent-brand-600"
                  onChange={(e) => setSpokenTo(e.target.checked)}
                />
                <span className="text-[13.5px] text-ink">
                  I have spoken to them about their question.
                </span>
              </label>
            ) : null}

            <div>
              <label htmlFor="dispense-notes" className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
                Notes
              </label>
              <textarea
                id="dispense-notes"
                rows={2}
                className={control}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3 py-2.5">
            <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-stop-600" />
            <p className="text-[13px] text-stop-700">{error}</p>
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={submit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-brand-600 px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Pill size={14} strokeWidth={2.2} />
            {busy ? 'Saving…' : collecting ? 'Record collection' : 'Sign off supply'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border border-line px-3.5 py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            Cancel
          </button>
        </div>

        {row.patientQuestion && !spokenTo && !collecting ? (
          <p className="mt-2.5 text-center text-[12px] text-ink-faint">
            Confirm you have raised their question before signing off.
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
