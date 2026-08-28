'use client';

/**
 * Consultation completion.
 *
 * What the pharmacist does with the patient in front of them, in the order the
 * client asked for it:
 *
 *   1. verify identity — the submit button is genuinely disabled until this is
 *      ticked, not styled to look it
 *   2. review what the patient already answered
 *   3. answer the clinician-only questions — fever first, because he asked for
 *      it to be high up
 *   4. record the administration — Branch above Pharmacist, "Site of
 *      Administration" with his eight options, and the Type of Injection
 *      dropdown he added
 *   5. tick the declarations
 *
 * Selecting a pharmacist fills in their GPhC number and selecting a vaccine
 * fills in its batch and expiry — the hidden-metadata feature he asked for,
 * working as plain configuration.
 */

import { useMemo, useState } from 'react';
import { Check, ShieldCheck, Loader2, AlertTriangle, Syringe, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { matchAllergens } from '@/lib/clinical/allergens';
import { AnswerReview } from '@/components/clinical/answer-review';
import { visibleFieldsForStep, activeWarnings, numberQuestions } from '@/lib/forms/runtime';
import { formatDate } from '@/lib/units';
import { ADMINISTRATION_SITES, INJECTION_TYPES } from '@/lib/seed/karsons';
import { FieldShell, FieldWarning, PillToggle } from '@/components/fields/controls';
import type { Answers, FormSchema } from '@/types/form-schema';

export interface ClinicianOption { id: string; fullName: string; gphcNumber: string }
export interface BatchOption {
  id: string; productName: string; batchNumber: string; expiryDate: string; quantity: number;
  /** What this product contains that someone can react to. */
  allergens: string[];
}

export interface ConsultationFormProps {
  patient: { id: string; fullName: string; dateOfBirth: string; addressLine1: string | null; postcode: string | null };
  schema: FormSchema;
  patientAnswers: Answers;
  /**
   * Correcting an answer. Absent for a record that is already closed, which is
   * how a completed consultation becomes read-only.
   */
  onAmend?: (answers: Answers, reason: string) => Promise<{ ok: boolean; error?: string }>;
  clinicians: ClinicianOption[];
  batches: BatchOption[];
  /** Substances on the patient's record, lowercase, as stored. */
  patientAllergies: string[];
  branchName: string;
  onComplete: (input: {
    clinicianId: string;
    batchId: string | null;
    identityVerified: boolean;
    declarationsAccepted: string[];
    clinicalData: Record<string, unknown>;
    notes: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function ConsultationForm({
  patient, schema, patientAnswers, clinicians, batches, patientAllergies,
  branchName, onComplete, onAmend,
}: ConsultationFormProps) {
  const numbered = useMemo(
    () => (schema.numberQuestions ? numberQuestions(schema) : schema),
    [schema],
  );

  const [verified, setVerified] = useState(false);
  const [clinicianId, setClinicianId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [site, setSite] = useState('');
  const [injectionType, setInjectionType] = useState('');
  const [funding, setFunding] = useState<'NHS' | 'Private' | ''>('');
  const [notes, setNotes] = useState('');
  const [clinicianAnswers, setClinicianAnswers] = useState<Answers>({});
  const [declarations, setDeclarations] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const merged = { ...patientAnswers, ...clinicianAnswers };

  const clinicianFields = numbered.steps
    .flatMap((step) => visibleFieldsForStep(step, merged, { includeClinicianOnly: true }))
    .filter((f) => f.clinicianOnly);

  const warnings = activeWarnings(numbered, merged);
  const blocked = warnings.some((w) => w.severity === 'stop');

  const selectedClinician = clinicians.find((c) => c.id === clinicianId);
  const selectedBatch = batches.find((b) => b.id === batchId);
  const requiredDeclarations = numbered.clinicianDeclarations ?? [];
  const allDeclared = requiredDeclarations.every((d) => declarations.includes(d.id));

  // Does the chosen product contain something this patient reacts to?
  // Warns rather than blocks — see the note in lib/clinical/allergens.
  const allergyClash = selectedBatch
    ? matchAllergens(selectedBatch.allergens, patientAllergies)
    : [];

  const missing: string[] = [];
  if (!verified) missing.push('verify the patient’s identity');
  if (!clinicianId) missing.push('choose the pharmacist');
  if (batches.length > 0 && !batchId) missing.push('choose the vaccine');
  if (batches.length > 0 && !site) missing.push('record the site of administration');
  if (!funding) missing.push('record NHS or private');
  if (clinicianFields.some((f) => f.required && !merged[f.id])) missing.push('answer the clinical questions');
  if (!allDeclared) missing.push('confirm the declarations');

  const canSubmit = missing.length === 0 && !blocked && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await onComplete({
      clinicianId,
      batchId: batchId || null,
      identityVerified: verified,
      declarationsAccepted: declarations,
      clinicalData: {
        ...clinicianAnswers,
        siteOfAdministration: site || null,
        injectionType: injectionType || null,
        fundedBy: funding || null,
        gphcNumber: selectedClinician?.gphcNumber ?? null,
        batchNumber: selectedBatch?.batchNumber ?? null,
        expiryDate: selectedBatch?.expiryDate ?? null,
      },
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not record the consultation.');
    else setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[520px] px-6 py-20 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-safe-100 text-safe-700">
          <Check size={26} strokeWidth={2.4} />
        </div>
        <h2 className="mb-2 text-[23px] text-ink">Recorded</h2>
        <ul className="mx-auto mt-4 flex max-w-[320px] flex-col gap-1.5 text-left text-[13.5px] text-ink-soft">
          <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-safe-600" /> Consultation saved</li>
          {selectedBatch ? (
            <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-safe-600" /> {branchName} stock reduced by one</li>
          ) : null}
          <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-safe-600" /> GP notification queued for tonight</li>
          <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-safe-600" /> Audit entry written</li>
        </ul>
      </div>
    );
  }

  const label = 'mb-1.5 block text-[13px] font-medium text-ink';
  const control = 'w-full rounded-[7px] border border-line bg-surface px-3 py-2.5 text-[14.5px] text-ink focus:border-brand-400 focus:outline-none';

  return (
    <div className="mx-auto max-w-[820px] px-6 py-8">
      {/* Patient + identity */}
      <section className="mb-5 overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h1 className="text-[21px] text-ink">{patient.fullName}</h1>
          <p className="tabular mt-0.5 font-mono text-[12.5px] text-ink-faint">
            {formatDate(patient.dateOfBirth)}
            {patient.postcode ? ` · ${patient.postcode}` : ''}
          </p>
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={verified}
          onClick={() => setVerified((v) => !v)}
          className={cn(
            'flex w-full items-start gap-3 px-5 py-4 text-left transition-colors',
            verified ? 'bg-safe-50' : 'hover:bg-sunk',
          )}
        >
          <span className={cn(
            'mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[5px] border-2',
            verified ? 'border-safe-600 bg-safe-600 text-white' : 'border-line',
          )}>
            {verified ? <Check size={13} strokeWidth={3} /> : null}
          </span>
          <span>
            <span className="block text-[14.5px] font-medium text-ink">
              I have verified this patient’s identity
            </span>
            <span className="block text-[12.5px] text-ink-faint">
              Confirm their address with them out loud — {patient.addressLine1 ?? 'no address recorded'}
            </span>
          </span>
        </button>
      </section>

      {/* What the patient told us — check it against them before anything else.
          His brief: "Clinician reviews all the information collected with the
          form". This is the step that was missing entirely. */}
      <section className="mb-5">
        <h2 className="mb-2.5 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
          <ClipboardCheck size={15} strokeWidth={2} />
          What the patient told us
        </h2>
        <AnswerReview schema={schema} answers={patientAnswers} onAmend={onAmend} />
      </section>

      {/* Clinician questions */}
      {clinicianFields.length > 0 ? (
        <Panel title="Ask the patient now" icon={<ShieldCheck size={15} strokeWidth={2} />}>
          {clinicianFields.map((field) => (
            <FieldShell key={field.id} field={field}>
              <PillToggle
                field={field}
                value={merged[field.id]}
                answers={merged}
                onChange={(v) => setClinicianAnswers((a) => ({ ...a, [field.id]: v }))}
              />
              {warnings.filter((w) => w.fieldId === field.id).map((w) => (
                <FieldWarning key={w.message} message={w.message} severity={w.severity} />
              ))}
            </FieldShell>
          ))}
        </Panel>
      ) : null}

      {/* Administration */}
      <Panel title="Administration" icon={<Syringe size={15} strokeWidth={2} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={label}>Branch</span>
            <div className="rounded-[7px] border border-line bg-sunk px-3 py-2.5 text-[14.5px] text-ink">
              {branchName}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="clinician">Pharmacist</label>
            <select id="clinician" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)} className={control}>
              <option value="">Choose…</option>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
            {selectedClinician ? (
              <p className="tabular mt-1 font-mono text-[11.5px] text-ink-faint">
                GPhC {selectedClinician.gphcNumber}
              </p>
            ) : null}
          </div>

          {batches.length > 0 ? (
            <>
              <div>
                <label className={label} htmlFor="batch">Vaccine</label>
                <select id="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={control}>
                  <option value="">Choose…</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id} disabled={b.quantity <= 0}>
                      {b.productName}{b.quantity <= 0 ? ' — out of stock' : ''}
                    </option>
                  ))}
                </select>
                {selectedBatch ? (
                  <p className="tabular mt-1 font-mono text-[11.5px] text-ink-faint">
                    Batch {selectedBatch.batchNumber} · expires {formatDate(selectedBatch.expiryDate)} · {selectedBatch.quantity} in stock
                  </p>
                ) : null}

                {allergyClash.length > 0 ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-[8px] border border-stop-200 bg-stop-50 px-3 py-2 text-[13px] text-stop-700">
                    <AlertTriangle size={13} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                    <span>
                      <strong>{selectedBatch?.productName}</strong> contains{' '}
                      {allergyClash.join(', ')}, and this patient has a recorded
                      allergy to it. Check the PGD before administering.
                    </span>
                  </p>
                ) : null}
              </div>

              <div>
                <label className={label} htmlFor="site">Site of administration</label>
                <select id="site" value={site} onChange={(e) => setSite(e.target.value)} className={control}>
                  <option value="">Choose…</option>
                  {ADMINISTRATION_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className={label} htmlFor="injection">Type of injection</label>
                <select id="injection" value={injectionType} onChange={(e) => setInjectionType(e.target.value)} className={control}>
                  <option value="">Choose…</option>
                  {INJECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          ) : null}

          <div>
            <span className={label}>Funded by</span>
            <div className="inline-flex gap-1 rounded-[8px] bg-sunk p-1">
              {(['NHS', 'Private'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFunding(f)} aria-pressed={funding === f}
                  className={cn(
                    'rounded-[6px] px-4 py-2 text-[14px] font-medium transition-colors',
                    funding === f ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]' : 'text-ink-soft hover:text-ink',
                  )}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className={label} htmlFor="notes">Notes</label>
          <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional" className={cn(control, 'resize-y')} />
        </div>
      </Panel>

      {/* Declarations */}
      {requiredDeclarations.length > 0 ? (
        <Panel title="Before you submit">
          <div className="flex flex-col gap-1.5">
            {requiredDeclarations.map((d) => {
              const checked = declarations.includes(d.id);
              return (
                <button key={d.id} type="button" role="checkbox" aria-checked={checked}
                  onClick={() => setDeclarations((cur) => checked ? cur.filter((x) => x !== d.id) : [...cur, d.id])}
                  className={cn(
                    'flex items-start gap-3 rounded-[7px] border px-3.5 py-2.5 text-left transition-colors',
                    checked ? 'border-brand-400 bg-brand-50' : 'border-line bg-surface hover:border-brand-300',
                  )}>
                  <span className={cn(
                    'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2',
                    checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
                  )}>
                    {checked ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  <span className="text-[13.5px] leading-snug text-ink-soft">{d.text}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* Submit */}
      <div className="sticky bottom-0 -mx-6 mt-6 border-t border-line bg-surface px-6 py-4">
        {error ? (
          <p role="alert" className="mb-3 flex items-start gap-1.5 text-[13.5px] text-stop-700">
            <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-faint">
            {blocked
              ? 'A safety answer prevents proceeding today.'
              : missing.length > 0
                ? `Still to do: ${missing.join(', ')}.`
                : 'Ready to record.'}
          </p>
          <button type="button" onClick={submit} disabled={!canSubmit}
            className={cn(
              'flex items-center gap-2 rounded-[8px] px-5 py-2.5 text-[14.5px] font-semibold text-white transition-colors',
              canSubmit ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-ink-faint',
            )}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            Record consultation
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title, icon, children,
}: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5 overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
        <h2 className="font-display text-[14.5px] font-semibold text-ink">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
