'use client';

/**
 * Editing patient resources.
 *
 * One list, with an inline editor that opens in place. A modal was the other
 * option and was rejected: the whole job here is judging a new leaflet against
 * the ones already there — where it sits in the order, whether it duplicates
 * something — and a modal covers exactly the list you are judging it against.
 *
 * Superseded versions stay in the list, dimmed. They are what past
 * acknowledgements point at, and hiding them would make "what did this patient
 * actually agree to in June" unanswerable from the screen that owns the answer.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, ExternalLink, Trash2, Pencil, Check, X, EyeOff, Eye, History,
} from 'lucide-react';
import {
  archiveResource, saveResource, setResourceActive,
  type ResourceRow, type ResourcesView,
} from './actions';
import { resourceProblems, type DisplayStage } from '@/lib/resources/applicable';
import { EmptyState, Notice, Panel, Tag } from '@/components/ui/primitives';

const STAGE_LABEL: Record<DisplayStage, string> = {
  BEFORE_SUBMISSION: 'On the form',
  AFTER_RX: 'After the prescription',
  BOTH: 'Form and after',
};

interface Draft {
  title: string;
  description: string;
  url: string;
  displayStage: DisplayStage;
  requiresAcknowledgement: boolean;
  sortOrder: number;
  medicineId: string;
}

function draftFrom(r: ResourceRow): Draft {
  return {
    title: r.title,
    description: r.description ?? '',
    url: r.url,
    displayStage: r.displayStage,
    requiresAcknowledgement: r.requiresAcknowledgement,
    sortOrder: r.sortOrder,
    medicineId: r.medicineId ?? '',
  };
}

const BLANK: Draft = {
  title: '',
  description: '',
  url: '',
  displayStage: 'BOTH',
  requiresAcknowledgement: true,
  sortOrder: 0,
  medicineId: '',
};

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[13.5px] text-ink '
  + 'outline-none transition-colors placeholder:text-ink-faint focus:border-brand-400';

const labelClass = 'block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint';

export function ResourcesClient({
  view, editable, removable,
}: {
  view: ResourcesView;
  editable: boolean;
  removable: boolean;
}) {
  const router = useRouter();
  /** The resource being edited, `'new'` while adding, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = view.resources.filter((r) => !r.superseded && r.archivedAt === null);
  const history = view.resources.filter((r) => r.superseded || r.archivedAt !== null);

  function startAdd() {
    // Land at the end of the list rather than the top. A new leaflet is rarely
    // the first thing a patient should read.
    const highest = live.reduce((n, r) => Math.max(n, r.sortOrder), 0);
    setDraft({ ...BLANK, sortOrder: highest + 10 });
    setEditing('new');
    setError(null);
  }

  function startEdit(r: ResourceRow) {
    setDraft(draftFrom(r));
    setEditing(r.id);
    setError(null);
  }

  function cancel() {
    setEditing(null);
    setError(null);
  }

  /*
   * Checked here with the same function the server uses, so the form never
   * accepts something the server will then refuse — and so the message a
   * person reads is the same message either way.
   */
  const problems = resourceProblems({
    title: draft.title,
    description: draft.description || null,
    url: draft.url,
    displayStage: draft.displayStage,
    requiresAcknowledgement: draft.requiresAcknowledgement,
    sortOrder: draft.sortOrder,
    medicineId: draft.medicineId || null,
  });

  async function submit() {
    if (problems.length > 0) { setError(problems.join(' ')); return; }

    setBusy(true);
    setError(null);

    const result = await saveResource({
      serviceId: view.serviceId,
      resourceId: editing === 'new' ? undefined : editing!,
      title: draft.title,
      description: draft.description || null,
      url: draft.url,
      displayStage: draft.displayStage,
      requiresAcknowledgement: draft.requiresAcknowledgement,
      sortOrder: draft.sortOrder,
      medicineId: draft.medicineId || null,
    });

    setBusy(false);
    if (!result.ok) { setError(result.error); return; }

    setEditing(null);
    router.refresh();
  }

  async function toggle(r: ResourceRow) {
    setBusy(true);
    const result = await setResourceActive({ resourceId: r.id, active: !r.active });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }

  async function remove(r: ResourceRow) {
    setBusy(true);
    const result = await archiveResource(r.id);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }

  const editor = (
    <Panel className="border-brand-200 bg-brand-50/40 px-5 py-4">
      <div className="grid gap-3.5">
        <div>
          <label className={labelClass} htmlFor="res-title">Title</label>
          <input
            id="res-title"
            className={`${inputClass} mt-1`}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="How to inject your medicine"
            autoFocus
          />
          <p className="mt-1 text-[11.5px] text-ink-faint">
            This is the link the patient taps.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="res-url">Link</label>
          <input
            id="res-url"
            className={`${inputClass} mt-1 font-mono text-[12.5px]`}
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="res-desc">
            Description <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id="res-desc"
            className={`${inputClass} mt-1`}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="A short line under the title"
          />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="res-stage">When it is shown</label>
            <select
              id="res-stage"
              className={`${inputClass} mt-1`}
              value={draft.displayStage}
              onChange={(e) =>
                setDraft({ ...draft, displayStage: e.target.value as DisplayStage })}
            >
              <option value="BEFORE_SUBMISSION">On the form</option>
              <option value="AFTER_RX">After the prescription</option>
              <option value="BOTH">Both</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="res-med">Applies to</label>
            <select
              id="res-med"
              className={`${inputClass} mt-1`}
              value={draft.medicineId}
              onChange={(e) => setDraft({ ...draft, medicineId: e.target.value })}
            >
              <option value="">Every patient</option>
              {view.medicines.map((m) => (
                <option key={m.id} value={m.id}>{m.brand} only</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="res-order">Order</label>
            <input
              id="res-order"
              type="number"
              className={`${inputClass} tabular mt-1`}
              value={draft.sortOrder}
              onChange={(e) =>
                setDraft({ ...draft, sortOrder: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-[13.5px] text-ink-soft">
          <input
            type="checkbox"
            className="mt-[3px] h-[15px] w-[15px] accent-[var(--brand-600)]"
            checked={draft.requiresAcknowledgement}
            onChange={(e) =>
              setDraft({ ...draft, requiresAcknowledgement: e.target.checked })}
          />
          <span>
            The patient must confirm they have read this before they can submit.
            <span className="mt-0.5 block text-[11.5px] text-ink-faint">
              What they confirmed, and the exact title and link they saw, is kept
              with their answers.
            </span>
          </span>
        </label>

        {/*
          Shown while typing rather than only on save. The person is writing a
          URL; telling them it is wrong after they press the button wastes the
          only moment they were looking at it.
        */}
        {draft.title.length > 0 && problems.length > 0 ? (
          <Notice tone="review">{problems.join(' ')}</Notice>
        ) : null}

        {error ? <Notice tone="stop">{error}</Notice> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || problems.length > 0}
            className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-[8px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={13} strokeWidth={2.4} />
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-3.5 py-[8px] text-[12.5px] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            <X size={13} strokeWidth={2.2} />
            Cancel
          </button>

          {editing !== 'new' ? (
            <span className="ml-auto text-[11.5px] text-ink-faint">
              Changing the title or the link creates a new version.
            </span>
          ) : null}
        </div>
      </div>
    </Panel>
  );

  return (
    <div className="grid gap-3">
      {editable ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={startAdd}
            disabled={editing !== null}
            className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-[8px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={14} strokeWidth={2.4} />
            Add a resource
          </button>
        </div>
      ) : null}

      {editing === 'new' ? editor : null}

      {live.map((r) => (
        editing === r.id ? (
          <div key={r.id}>{editor}</div>
        ) : (
          <Panel key={r.id} className="px-5 py-[15px]">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className={`text-[15px] font-semibold ${r.active ? 'text-ink' : 'text-ink-faint line-through'}`}>
                    {r.title}
                  </h2>
                  <span className="tabular font-mono text-[10.5px] text-ink-faint">
                    v{r.version}
                  </span>
                </div>

                {r.description ? (
                  <p className="mt-0.5 text-[13px] text-ink-faint">{r.description}</p>
                ) : null}

                {/*
                  rel="noreferrer" and a new tab. These are links the client
                  typed, pointing off our origin.
                */}
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex max-w-full items-center gap-1.5 font-mono text-[11.5px] text-brand-700 underline-offset-2 hover:underline"
                >
                  <span className="truncate">{r.url}</span>
                  <ExternalLink size={11} strokeWidth={2.2} className="shrink-0" />
                </a>

                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <Tag tone="neutral">{STAGE_LABEL[r.displayStage]}</Tag>
                  {r.requiresAcknowledgement ? (
                    <Tag tone="brand">must confirm</Tag>
                  ) : null}
                  {r.medicineBrand ? (
                    <Tag tone="neutral">{r.medicineBrand} only</Tag>
                  ) : null}
                  {!r.active ? <Tag tone="review">switched off</Tag> : null}
                  <span className="tabular font-mono text-[11px] text-ink-faint">
                    order {r.sortOrder}
                  </span>
                </div>
              </div>

              {editable ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    disabled={busy || editing !== null}
                    aria-label={r.active ? `Switch off ${r.title}` : `Switch on ${r.title}`}
                    title={r.active ? 'Stop showing this' : 'Show this again'}
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-control border border-line text-ink-faint transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-40"
                  >
                    {r.active
                      ? <EyeOff size={13} strokeWidth={2} />
                      : <Eye size={13} strokeWidth={2} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    disabled={busy || editing !== null}
                    className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-[7px] text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-40"
                  >
                    <Pencil size={13} strokeWidth={2} />
                    Edit
                  </button>

                  {removable ? (
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busy || editing !== null}
                      aria-label={`Retire ${r.title}`}
                      title="Retire this resource"
                      className="flex h-[32px] w-[32px] items-center justify-center rounded-control border border-line text-ink-faint transition-colors hover:border-stop-200 hover:text-stop-700 disabled:opacity-40"
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>
        )
      ))}

      {live.length === 0 && editing !== 'new' ? (
        <Panel>
          <EmptyState
            title="No resources yet"
            body={
              editable
                ? 'Add the links you want patients to read before they submit — an injection guide, a side-effects leaflet, your needle disposal policy.'
                : 'Nobody has added patient resources to this service yet.'
            }
          />
        </Panel>
      ) : null}

      {error && editing === null ? <Notice tone="stop">{error}</Notice> : null}

      {/*
        Kept visible on purpose. These are what past acknowledgements point at,
        so the screen that owns resources should be able to answer "what did
        this patient agree to in June".
      */}
      {history.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            <History size={12} strokeWidth={2} />
            Earlier versions and retired resources
          </div>

          <div className="grid gap-2">
            {history.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-panel border border-line bg-sunk px-4 py-2.5"
              >
                <span className="text-[13.5px] text-ink-faint">{r.title}</span>
                <span className="tabular font-mono text-[10.5px] text-ink-faint">
                  v{r.version}
                </span>
                {r.archivedAt ? (
                  <Tag tone="neutral">retired</Tag>
                ) : (
                  <Tag tone="neutral">superseded</Tag>
                )}
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-ink-faint">
                  {r.url}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
