'use client';

/**
 * The vaccine administration record — §27.1, in the order the specification
 * lists, with branch above pharmacist because it says so and because stock
 * comes out of the branch.
 *
 * Two behaviours are the point of this file rather than decoration:
 *
 *   §27.4  choosing an oral, nasal or topical route hides the injection type
 *          and clears it, so a stale value cannot be saved behind the form
 *   §28.4  only batches that are in date, un-recalled and actually in stock
 *          at this branch are offered
 *
 * Both are re-checked on the server. The form is a convenience; the record is
 * the thing that has to be right.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Syringe, AlertTriangle } from 'lucide-react';
import { Panel } from '@/components/ui/primitives';
import {
  ADMINISTRATION_SITES, INJECTION_TYPES, SITE_LABELS, INJECTION_LABELS,
  needsInjectionType, CLINICIAN_DECLARATIONS,
  type AdministrationSite, type InjectionType,
} from '@/lib/vaccination/administration';
import { recordVaccination } from '../actions';
import type { UsableBatch } from '@/lib/queries/vaccinations';

const PAYMENT_TYPES = ['NHS', 'Paid'];

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const label = 'mb-1.5 block text-[12.5px] font-medium text-ink-soft';
const control =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand-300 focus:shadow-[0_0_0_3px_var(--color-brand-50)]';

export function AdministerForm({
  submissionId,
  branchId,
  branches,
  clinicians,
  batches,
  consentAccepted,
}: {
  submissionId: string;
  branchId: string;
  branches: { id: string; name: string; companyId: string | null }[];
  clinicians: { id: string; fullName: string; gphcNumber: string }[];
  batches: UsableBatch[];
  consentAccepted: boolean;
}) {
  const router = useRouter();

  const [branch, setBranch] = useState(branchId);
  const [clinicianId, setClinicianId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [administeredOn, setAdministeredOn] = useState(todayIso());
  const [site, setSite] = useState<AdministrationSite | ''>('');
  const [injectionType, setInjectionType] = useState<InjectionType | ''>('');
  const [paymentType, setPaymentType] = useState('');
  const [adverseReaction, setAdverseReaction] = useState('');
  const [notes, setNotes] = useState('');
  const [suitable, setSuitable] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const injectionNeeded = site ? needsInjectionType(site) : true;
  const chosenBatch = batches.find((b) => b.batchId === batchId);
  const signer = clinicians.find((c) => c.id === clinicianId);

  const allDeclared = confirmed.size === CLINICIAN_DECLARATIONS.length;

  const ready = useMemo(
    () =>
      Boolean(branch && clinicianId && batchId && administeredOn && site)
      && (!injectionNeeded || Boolean(injectionType))
      && suitable
      && allDeclared
      && consentAccepted,
    [branch, clinicianId, batchId, administeredOn, site, injectionNeeded, injectionType, suitable, allDeclared, consentAccepted],
  );

  /** Changing the route clears an injection type that no longer applies. */
  function chooseSite(next: AdministrationSite | '') {
    setSite(next);
    if (next && !needsInjectionType(next)) setInjectionType('');
  }

  function toggleDeclaration(key: string) {
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const result = await recordVaccination({
      submissionId,
      branchId: branch,
      companyId: branches.find((b) => b.id === branch)?.companyId ?? null,
      clinicianId,
      batchId,
      administeredOn,
      site: site as AdministrationSite,
      injectionType: injectionType === '' ? null : injectionType,
      paymentType: paymentType || null,
      adverseReaction: adverseReaction || null,
      notes: notes || null,
      declarationKeys: [...confirmed],
      suitabilityConfirmed: suitable,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.refresh();
  }

  return (
    <Panel className="mb-4 px-5 py-4">
      <h2 className="mb-1 text-[15px] font-semibold text-ink">Record what was given</h2>
      <p className="mb-4 text-[13.5px] text-ink-faint">
        Stock comes out of the branch you choose here.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* §27.1 — branch above pharmacist. */}
        <div>
          <label className={label} htmlFor="v-branch">Branch</label>
          <select id="v-branch" className={control} value={branch}
                  onChange={(e) => setBranch(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="v-clinician">Pharmacist</label>
          <select id="v-clinician" className={control} value={clinicianId}
                  onChange={(e) => setClinicianId(e.target.value)}>
            <option value="">Choose…</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>{c.fullName}</option>
            ))}
          </select>
          {/* Selecting a pharmacist fills in their registration number. */}
          {signer ? (
            <p className="tabular mt-1.5 font-mono text-[11.5px] text-ink-faint">
              GPhC {signer.gphcNumber}
            </p>
          ) : null}
        </div>

        <div>
          <label className={label} htmlFor="v-date">Date given</label>
          <input id="v-date" type="date" className={control} value={administeredOn}
                 onChange={(e) => setAdministeredOn(e.target.value)} />
        </div>

        <div>
          <label className={label} htmlFor="v-batch">Vaccine and batch</label>
          <select id="v-batch" className={control} value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}>
            <option value="">Choose…</option>
            {batches.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {b.productName} — {b.batchNumber} ({b.quantity} left)
              </option>
            ))}
          </select>
          {/* Batch selection fills in the expiry, per §27.1. */}
          {chosenBatch ? (
            <p className="tabular mt-1.5 font-mono text-[11.5px] text-ink-faint">
              expires {chosenBatch.expiryDate}
            </p>
          ) : null}
          {batches.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-review-700">
              No in-date stock at this branch.
            </p>
          ) : null}
        </div>

        <div>
          <label className={label} htmlFor="v-site">Site of administration</label>
          <select id="v-site" className={control} value={site}
                  onChange={(e) => chooseSite(e.target.value as AdministrationSite | '')}>
            <option value="">Choose…</option>
            {ADMINISTRATION_SITES.map((s) => (
              <option key={s} value={s}>{SITE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {/* §27.4 — not asked at all where nothing is injected. */}
        {injectionNeeded ? (
          <div>
            <label className={label} htmlFor="v-injection">Type of injection</label>
            <select id="v-injection" className={control} value={injectionType}
                    onChange={(e) => setInjectionType(e.target.value as InjectionType | '')}>
              <option value="">Choose…</option>
              {INJECTION_TYPES.map((t) => (
                <option key={t} value={t}>{INJECTION_LABELS[t]}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-end">
            <p className="text-[12.5px] text-ink-faint">
              No injection type needed for {site ? SITE_LABELS[site].toLowerCase() : 'this route'}.
            </p>
          </div>
        )}

        <div>
          <label className={label} htmlFor="v-payment">Payment</label>
          <select id="v-payment" className={control} value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}>
            <option value="">Choose…</option>
            {PAYMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="v-reaction">Adverse reaction, if any</label>
          <input id="v-reaction" className={control} value={adverseReaction}
                 placeholder="Leave blank if none"
                 onChange={(e) => setAdverseReaction(e.target.value)} />
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="v-notes">Notes</label>
          <textarea id="v-notes" rows={2} className={control} value={notes}
                    onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* §26.3 and §26.4 */}
      <div className="mt-5 border-t border-line-soft pt-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" checked={suitable} className="mt-0.5 accent-brand-600"
                 onChange={(e) => setSuitable(e.target.checked)} />
          <span className="text-[13.5px] text-ink">
            I have assessed this patient against the applicable protocol or PGD and
            consider vaccination clinically appropriate.
          </span>
        </label>

        <p className="mb-2 mt-4 text-[12.5px] font-medium text-ink-soft">
          Before completing, confirm:
        </p>
        <div className="grid gap-2">
          {CLINICIAN_DECLARATIONS.map((d) => (
            <label key={d.key} className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={confirmed.has(d.key)}
                     className="mt-0.5 accent-brand-600"
                     onChange={() => toggleDeclaration(d.key)} />
              <span className="text-[13px] text-ink-soft">{d.text}</span>
            </label>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3.5 py-2.5">
          <AlertTriangle size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-stop-600" />
          <p className="text-[13px] text-stop-700">{error}</p>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={submit}
          className="flex items-center gap-1.5 rounded-control bg-brand-600 px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Syringe size={14} strokeWidth={2.2} />
          {busy ? 'Recording…' : 'Complete vaccination'}
        </button>

        {!consentAccepted ? (
          <span className="text-[12.5px] text-review-700">Consent is missing.</span>
        ) : !ready ? (
          <span className="text-[12.5px] text-ink-faint">
            Fill in everything above and confirm the declarations.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}
