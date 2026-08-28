'use client';

/**
 * Allergies on the patient record.
 *
 * Placed high on the page and styled as a clinical warning rather than another
 * data field, because this is the thing a pharmacist must not miss while
 * scanning. An empty list says so explicitly — "none recorded" and "nobody has
 * asked" look identical otherwise, and only one of them is safe to act on.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { addAllergy, removeAllergy } from './allergy-actions';
import { SEVERITIES } from './allergy-severities';

export interface AllergyRow {
  id: string;
  substance: string;
  reaction: string | null;
  severity: string | null;
  recordedAt: Date;
}

const input =
  'w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand-400';

export function AllergiesPanel({
  patientId,
  allergies,
}: {
  patientId: string;
  allergies: AllergyRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [substance, setSubstance] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serious = allergies.some(
    (a) => a.severity === 'Severe' || a.severity === 'Anaphylaxis',
  );

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await addAllergy({
      patientId,
      substance,
      reaction: reaction || null,
      severity: severity || null,
    });
    setBusy(false);

    if (!result.ok) setError(result.error ?? 'Could not record that allergy.');
    else {
      setSubstance('');
      setReaction('');
      setSeverity('');
      setAdding(false);
      router.refresh();
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove "${name}" from this patient's allergies?`)) return;
    setBusy(true);
    await removeAllergy(id, patientId);
    setBusy(false);
    router.refresh();
  }

  return (
    <section
      className={cn(
        'mb-5 overflow-hidden rounded-[10px] border bg-surface',
        serious ? 'border-stop-200' : 'border-line',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-4 py-2.5',
          serious ? 'border-stop-200 bg-stop-50' : 'border-line bg-sunk',
        )}
      >
        {serious ? (
          <AlertTriangle size={13} strokeWidth={2.4} className="text-stop-700" />
        ) : (
          <ShieldCheck size={13} strokeWidth={2.2} className="text-ink-faint" />
        )}
        <span
          className={cn(
            'font-mono text-[10.5px] uppercase tracking-[0.08em]',
            serious ? 'text-stop-700' : 'text-ink-faint',
          )}
        >
          Allergies
        </span>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="ml-auto flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
        >
          {adding ? <X size={11} /> : <Plus size={11} strokeWidth={2.6} />}
          {adding ? 'Cancel' : 'Record one'}
        </button>
      </div>

      {error ? (
        <p className="border-b border-line-soft bg-stop-50 px-4 py-2 text-[13px] text-stop-700">
          {error}
        </p>
      ) : null}

      {allergies.length === 0 ? (
        <p className="px-4 py-3.5 text-[13.5px] text-ink-faint">
          None recorded. That is not the same as none — ask before administering
          anything.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {allergies.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-b-0"
            >
              <span className="text-[14px] font-medium capitalize text-ink">
                {a.substance}
              </span>
              {a.severity ? (
                <span
                  className={cn(
                    'rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                    a.severity === 'Anaphylaxis' || a.severity === 'Severe'
                      ? 'bg-stop-100 text-stop-700'
                      : 'bg-review-100 text-review-700',
                  )}
                >
                  {a.severity}
                </span>
              ) : null}
              {a.reaction ? (
                <span className="text-[13px] text-ink-soft">{a.reaction}</span>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(a.id, a.substance)}
                className="ml-auto rounded-[5px] border border-line px-1.5 py-0.5 text-[11.5px] text-ink-faint transition-colors hover:border-stop-200 hover:text-stop-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-3 border-t border-line bg-sunk px-4 py-3.5">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[170px] flex-1">
              <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft" htmlFor="al-sub">
                Substance
              </label>
              <input
                id="al-sub"
                value={substance}
                onChange={(e) => setSubstance(e.target.value)}
                className={input}
                placeholder="egg, penicillin, latex"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft" htmlFor="al-sev">
                Severity
              </label>
              <select
                id="al-sev"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className={input}
              >
                <option value="">Not stated</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft" htmlFor="al-reaction">
              Reaction
            </label>
            <input
              id="al-reaction"
              value={reaction}
              onChange={(e) => setReaction(e.target.value)}
              className={input}
              placeholder="What happened — rash, swelling, breathing difficulty"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !substance.trim()}
              onClick={submit}
              className={cn(
                'flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700',
                (busy || !substance.trim()) && 'cursor-not-allowed opacity-40 hover:bg-brand-600',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Record allergy
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
