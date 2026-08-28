'use client';

/**
 * Editing opening hours.
 *
 * Grouped by branch then weekday, because that is how a pharmacy thinks about
 * it — "what do we do on Saturdays at Onchan" — rather than as a flat list of
 * rows, which is how the table happens to store it.
 *
 * Times are entered as HH:MM and stored as minutes from midnight. A <input
 * type="time"> gives a native, locale-correct, keyboard-accessible picker on
 * every platform, which is worth far more here than a bespoke one.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Loader2, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import {
  saveOpeningWindow, removeOpeningWindow, type WindowRow,
} from './actions';

const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface Draft {
  id: string | null;
  branchId: string;
  serviceId: string | null;
  weekday: number;
  start: string;
  end: string;
  slotMinutes: number;
  capacity: number;
}

const inputCls =
  'rounded-[6px] border border-line bg-surface px-2 py-1.5 text-[13.5px] text-ink outline-none focus:border-brand-400';

export function OpeningHoursEditor({
  windows,
  branches,
  services,
}: {
  windows: WindowRow[];
  branches: { id: string; name: string }[];
  services: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byBranch = new Map<string, WindowRow[]>();
  for (const w of windows) {
    const list = byBranch.get(w.branchId);
    if (list) list.push(w);
    else byBranch.set(w.branchId, [w]);
  }

  function startNew(branchId: string) {
    setError(null);
    setDraft({
      id: null,
      branchId,
      serviceId: null,
      weekday: 1,
      start: '09:00',
      end: '17:00',
      slotMinutes: 15,
      capacity: 1,
    });
  }

  function startEdit(w: WindowRow) {
    setError(null);
    setDraft({
      id: w.id,
      branchId: w.branchId,
      serviceId: w.serviceId,
      weekday: w.weekday,
      start: toTime(w.startMinute),
      end: toTime(w.endMinute),
      slotMinutes: w.slotMinutes,
      capacity: w.capacity,
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);

    const result = await saveOpeningWindow({
      id: draft.id,
      branchId: draft.branchId,
      serviceId: draft.serviceId,
      weekday: draft.weekday,
      startMinute: toMinutes(draft.start),
      endMinute: toMinutes(draft.end),
      slotMinutes: draft.slotMinutes,
      capacity: draft.capacity,
    });

    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not save.');
    else {
      setDraft(null);
      router.refresh();
    }
  }

  async function archive(w: WindowRow) {
    if (!window.confirm(`Remove ${DAYS[w.weekday]} ${toTime(w.startMinute)}–${toTime(w.endMinute)}?`)) {
      return;
    }
    setBusy(true);
    const result = await removeOpeningWindow(w.id, w.branchId);
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not remove.');
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}

      {branches.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface shadow-panel px-6 py-10 text-center text-[13.5px] text-ink-faint">
          No branches yet.
        </p>
      ) : null}

      {branches.map((b) => {
        const rows = byBranch.get(b.id) ?? [];

        return (
          <section key={b.id} className="overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
            <div className="flex items-center justify-between border-b border-line bg-sunk px-4 py-2.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                {b.name}
              </span>
              <button
                type="button"
                onClick={() => startNew(b.id)}
                className="flex items-center gap-1 rounded-[6px] border border-line bg-surface px-2 py-1 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
              >
                <Plus size={12} strokeWidth={2.4} /> Add hours
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13.5px] text-ink-faint">
                Closed all week — nothing can be booked here until you add hours.
              </p>
            ) : (
              rows.map((w) => (
                <div
                  key={w.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                >
                  <span className="w-[84px] shrink-0 text-[13.5px] font-medium text-ink">
                    {DAYS[w.weekday]}
                  </span>
                  <span className="tabular font-mono text-[13px] text-ink-soft">
                    {toTime(w.startMinute)}–{toTime(w.endMinute)}
                  </span>
                  <span className="text-[12.5px] text-ink-faint">
                    {w.slotMinutes} min
                    {w.capacity > 1 ? ` · ${w.capacity} at a time` : ''}
                    {w.serviceName ? ` · ${w.serviceName} only` : ' · all services'}
                  </span>

                  <div className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(w)}
                      className="rounded-[6px] border border-line px-2 py-1 text-[12.5px] text-ink-soft hover:border-brand-300 hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => archive(w)}
                      aria-label="Remove"
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-line text-ink-faint hover:border-stop-200 hover:text-stop-700"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        );
      })}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4">
          <div className="w-full max-w-[480px] rounded-panel border border-line bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
                <Clock size={15} strokeWidth={2.2} />
                {draft.id ? 'Edit hours' : 'Add hours'}
              </h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-faint hover:bg-sunk hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-3.5 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="weekday">
                  Day
                </label>
                <SearchSelect
                  id="weekday"
                  value={String(draft.weekday)}
                  onChange={(next) => setDraft({ ...draft, weekday: Number(next) })}
                  options={DAYS.map((d, i) => ({ value: String(i), label: d }))}
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="start">
                    Opens
                  </label>
                  <input
                    id="start"
                    type="time"
                    value={draft.start}
                    onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    className={cn(inputCls, 'w-full tabular font-mono')}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="end">
                    Closes
                  </label>
                  <input
                    id="end"
                    type="time"
                    value={draft.end}
                    onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                    className={cn(inputCls, 'w-full tabular font-mono')}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="slot">
                    Appointment length
                  </label>
                  <SearchSelect
                    id="slot"
                    value={String(draft.slotMinutes)}
                    onChange={(next) => setDraft({ ...draft, slotMinutes: Number(next) })}
                    options={[5, 10, 15, 20, 30, 45, 60].map((m) => ({
                      value: String(m),
                      label: `${m} minutes`,
                    }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="capacity">
                    Seen at once
                  </label>
                  <input
                    id="capacity"
                    type="number"
                    min={1}
                    max={50}
                    value={draft.capacity}
                    onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
                    className={cn(inputCls, 'w-full tabular')}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-ink-soft" htmlFor="service">
                  Service
                </label>
                <SearchSelect
                  id="service"
                  value={draft.serviceId ?? ''}
                  onChange={(next) => setDraft({ ...draft, serviceId: next || null })}
                  emptyLabel="All services"
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                />
                <p className="mt-1 text-[12.5px] text-ink-faint">
                  Leave as all services unless this window is reserved for one thing.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className={cn(
                  'flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-700',
                  busy && 'opacity-60',
                )}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
