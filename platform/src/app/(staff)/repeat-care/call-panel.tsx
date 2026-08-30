'use client';

/**
 * The verification call, recorded rather than remembered.
 *
 * This is the safety step that replaces meeting the patient, so it is a
 * structured record and a workflow gate, not a note. Until a completed call
 * with identity confirmed exists against a new-patient request, the server
 * refuses to approve it.
 *
 * Every attempt is its own row. Rang twice and reached them on the third is
 * three records — the thing somebody needs months later is not the last
 * outcome but the sequence, and an editable single note cannot hold it.
 */

import { useEffect, useState } from 'react';
import {
  Phone, PhoneOff, Check, Loader2, ShieldCheck, ShieldAlert, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/units';
import {
  NEW_PATIENT_VERIFICATION, CALL_OUTCOMES, outcomeLabel, type ContactOutcome,
} from '@/lib/clinical/contact';
import { recordContact, getContacts, type ContactRow } from './contact-actions';

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)]';
const labelClass = 'mb-1.5 block text-[12.5px] font-medium text-ink-soft';

export function CallPanel({
  submissionId, branchId, companyId, onRecorded,
}: {
  submissionId: string;
  branchId?: string | null;
  companyId?: string | null;
  /** So the drawer can re-check whether approval is now unlocked. */
  onRecorded: () => void;
}) {
  const [history, setHistory] = useState<ContactRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<ContactOutcome>('COMPLETED');
  const [identityVerified, setIdentityVerified] = useState(false);
  const [verifiedBy, setVerifiedBy] = useState('');
  const [findings, setFindings] = useState('');
  const [advice, setAdvice] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState(false);

  useEffect(() => {
    let live = true;
    getContacts(submissionId).then((rows) => { if (live) setHistory(rows); });
    return () => { live = false; };
  }, [submissionId]);

  const verified = history?.find(
    (c) => c.outcome === 'COMPLETED' && c.identityVerified && c.completedAt !== null,
  );
  const completed = outcome === 'COMPLETED';

  async function submit() {
    setBusy(true);
    setError(null);

    const result = await recordContact({
      submissionId,
      purpose: NEW_PATIENT_VERIFICATION,
      outcome,
      identityVerified,
      verificationData: verifiedBy.trim() ? { confirmedBy: verifiedBy.trim() } : {},
      clinicalFindings: findings,
      adviceGiven: advice,
      notes,
      followUpRequired: followUp,
      branchId,
      companyId,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setHistory(await getContacts(submissionId));
    setOpen(false);
    setFindings(''); setAdvice(''); setNotes(''); setVerifiedBy('');
    setIdentityVerified(false); setFollowUp(false); setOutcome('COMPLETED');
    onRecorded();
  }

  return (
    <section className="mb-5 overflow-hidden rounded-panel border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-sunk px-4 py-2.5">
        {verified
          ? <ShieldCheck size={13} strokeWidth={2.2} className="text-safe-600" />
          : <ShieldAlert size={13} strokeWidth={2.2} className="text-review-600" />}
        <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.09em] text-ink-faint">
          Verification call
        </span>
        <span
          className={cn(
            'rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
            verified ? 'bg-safe-100 text-safe-700' : 'bg-review-100 text-review-700',
          )}
        >
          {verified ? 'verified' : history?.length ? 'attempted' : 'not called'}
        </span>
      </div>

      <div className="px-4 py-3.5">
        {!verified ? (
          <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">
            This request cannot be approved until you have spoken to the patient and confirmed
            who they are. That is the check this service has instead of seeing them.
          </p>
        ) : null}

        {history === null ? (
          <p className="text-[13px] text-ink-faint">Loading call history…</p>
        ) : history.length === 0 ? null : (
          <ul className="mb-3 flex list-none flex-col gap-2 p-0">
            {history.map((call) => (
              <li key={call.id} className="rounded-control border border-line-soft bg-sunk px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {call.outcome === 'COMPLETED'
                    ? <Phone size={12} strokeWidth={2.2} className="shrink-0 text-safe-600" />
                    : <PhoneOff size={12} strokeWidth={2.2} className="shrink-0 text-ink-faint" />}
                  <span className="text-[13px] font-medium text-ink">
                    {outcomeLabel(call.outcome)}
                  </span>
                  {call.outcome === 'COMPLETED' ? (
                    <span
                      className={cn(
                        'rounded-[4px] px-1.5 py-0.5 font-mono text-[9.5px] uppercase',
                        call.identityVerified
                          ? 'bg-safe-100 text-safe-700'
                          : 'bg-stop-100 text-stop-700',
                      )}
                    >
                      {call.identityVerified ? 'id confirmed' : 'id not confirmed'}
                    </span>
                  ) : null}
                  <span className="tabular ml-auto shrink-0 font-mono text-[10.5px] text-ink-faint">
                    {formatDateTime(call.createdAt)}
                    {call.staffName ? ` · ${call.staffName}` : ''}
                  </span>
                </div>
                {call.notes || call.clinicalFindings ? (
                  <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                    {[call.clinicalFindings, call.notes].filter(Boolean).join(' — ')}
                  </p>
                ) : null}
                {call.followUpRequired ? (
                  <p className="m-0 mt-1 font-mono text-[10.5px] uppercase tracking-wide text-review-700">
                    follow-up needed
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            <ChevronRight size={13} strokeWidth={2.2} />
            {history?.length ? 'Record another attempt' : 'Record a call'}
          </button>
        ) : (
          <div className="rounded-control border border-brand-200 bg-brand-50 px-3.5 py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-brand-700"
            >
              <ChevronDown size={13} strokeWidth={2.2} />
              Recording a call
            </button>

            <div className="mb-3">
              <label className={labelClass} htmlFor="call-outcome">What happened?</label>
              <select
                id="call-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as ContactOutcome)}
                className={inputClass}
              >
                {CALL_OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/*
              Identity is only offered on a completed call. It cannot be
              confirmed on a voicemail, and the server refuses the combination
              regardless — this simply stops it being asked.
            */}
            {completed ? (
              <>
                <label className="mb-3 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={identityVerified}
                    onChange={(e) => setIdentityVerified(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="text-[13px] leading-snug text-ink">
                    I confirmed I was speaking to the patient
                    <span className="block text-[12px] text-ink-soft">
                      Approval is blocked until this is ticked.
                    </span>
                  </span>
                </label>

                {identityVerified ? (
                  <div className="mb-3">
                    <label className={labelClass} htmlFor="call-verified-by">
                      How did you confirm it?
                    </label>
                    <input
                      id="call-verified-by"
                      value={verifiedBy}
                      onChange={(e) => setVerifiedBy(e.target.value)}
                      placeholder="e.g. date of birth and address"
                      className={inputClass}
                    />
                  </div>
                ) : null}

                <div className="mb-3">
                  <label className={labelClass} htmlFor="call-findings">Clinical findings</label>
                  <textarea
                    id="call-findings"
                    rows={2}
                    value={findings}
                    onChange={(e) => setFindings(e.target.value)}
                    placeholder="What you established about their health and suitability."
                    className={cn(inputClass, 'resize-y')}
                  />
                </div>

                <div className="mb-3">
                  <label className={labelClass} htmlFor="call-advice">Advice given</label>
                  <textarea
                    id="call-advice"
                    rows={2}
                    value={advice}
                    onChange={(e) => setAdvice(e.target.value)}
                    className={cn(inputClass, 'resize-y')}
                  />
                </div>
              </>
            ) : null}

            <div className="mb-3">
              <label className={labelClass} htmlFor="call-notes">Notes</label>
              <textarea
                id="call-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={completed ? 'Anything else worth recording.' : 'e.g. rang at 10:20, no answer.'}
                className={cn(inputClass, 'resize-y')}
              />
            </div>

            <label className="mb-3 flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={followUp}
                onChange={(e) => setFollowUp(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-brand-600"
              />
              <span className="text-[13px] text-ink">Someone needs to follow this up</span>
            </label>

            {error ? (
              <p role="alert" className="mb-3 text-[12.5px] text-stop-700">{error}</p>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {busy
                ? <Loader2 size={13} className="animate-spin" />
                : <Check size={13} strokeWidth={2.4} />}
              Save call
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
