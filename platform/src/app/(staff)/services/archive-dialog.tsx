'use client';

/**
 * Confirming that a service should be withdrawn.
 *
 * The dialog does three things, in this order, because that is the order the
 * questions occur to somebody about to press it:
 *
 *   1. Says what is stopping it, if anything.
 *   2. Says what will happen if it goes ahead.
 *   3. Asks them to type the name.
 *
 * Typing the name is not ceremony. This list is a column of similar-looking
 * cards, and the difference between withdrawing the service you meant and the
 * one above it is one row of mouse travel. A button that acts on a click alone
 * is the wrong shape for something with an outside effect — the public link
 * stops working the moment it lands.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Archive, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Portal } from '@/components/ui/portal';
import {
  getServiceUsage, archiveService, type ServiceArchivePreview,
} from './archive-actions';

export function ArchiveServiceDialog({
  serviceId, serviceName, onClose,
}: {
  serviceId: string;
  serviceName: string;
  onClose: (archived: boolean) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ServiceArchivePreview | null | 'loading'>('loading');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getServiceUsage(serviceId).then((p) => { if (live) setPreview(p); });
    return () => { live = false; };
  }, [serviceId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const loaded = preview !== 'loading' && preview !== null;
  const blocked = loaded && !preview.can;
  // Compared the way the server compares it, so the button never enables on
  // something the server will then refuse.
  const nameMatches = typed.trim().toLowerCase() === serviceName.trim().toLowerCase();

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await archiveService({ serviceId, confirmation: typed });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onClose(true);
    router.refresh();
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:p-10">
        <div
          className="fixed inset-0 animate-fade bg-ink/30 backdrop-blur-[2px]"
          onClick={() => !busy && onClose(false)}
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Remove ${serviceName}`}
          className="relative w-full max-w-[540px] animate-rise overflow-hidden rounded-modal border border-line bg-surface shadow-pop"
        >
          <div className="flex items-start gap-3 border-b border-line bg-sunk px-5 py-3.5">
            <Archive size={16} strokeWidth={2.1} className="mt-0.5 shrink-0 text-ink-faint" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15.5px] font-semibold text-ink">Remove this service</h2>
              <p className="m-0 truncate text-[12.5px] text-ink-faint">{serviceName}</p>
            </div>
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={busy}
              aria-label="Close"
              className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              <X size={17} strokeWidth={2} />
            </button>
          </div>

          <div className="px-5 py-5">
            {preview === 'loading' ? (
              <p className="text-[13.5px] text-ink-faint">Checking what is using this service…</p>
            ) : preview === null ? (
              <p className="text-[13.5px] text-stop-700">
                That service could not be found. It may already have been removed.
              </p>
            ) : (
              <>
                {/*
                  Work that would be stranded. Shown first and on its own,
                  because merging it with the notes below would let a real
                  obstacle hide among things that are merely worth knowing.
                */}
                {blocked ? (
                  <div className="mb-4 rounded-control border border-stop-200 bg-stop-50 px-3.5 py-3">
                    <p className="m-0 mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-stop-700">
                      <AlertTriangle size={13} strokeWidth={2.4} />
                      This service is still in use
                    </p>
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {preview.blockers.map((b) => (
                        <li key={b} className="text-[13px] leading-relaxed text-stop-900">{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mb-4">
                  <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                    What removing it does
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {preview.consequences.map((c) => (
                      <li key={c} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
                        <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>

                {!blocked ? (
                  <>
                    <label
                      htmlFor="archive-confirm"
                      className="mb-1.5 block text-[12.5px] font-medium text-ink-soft"
                    >
                      Type <strong className="text-ink">{serviceName}</strong> to confirm
                    </label>
                    <input
                      id="archive-confirm"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      autoComplete="off"
                      placeholder={serviceName}
                      className="mb-3 w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)]"
                    />
                  </>
                ) : null}

                {error ? (
                  <p role="alert" className="mb-3 text-[13px] text-stop-700">{error}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {!blocked ? (
                    <button
                      type="button"
                      onClick={confirm}
                      disabled={busy || !nameMatches}
                      className={cn(
                        'flex items-center gap-1.5 rounded-control px-4 py-2 text-[13.5px] font-semibold text-white transition-colors',
                        'bg-stop-600 hover:bg-stop-700 disabled:cursor-not-allowed disabled:opacity-40',
                      )}
                    >
                      {busy
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Archive size={14} strokeWidth={2.4} />}
                      Remove service
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onClose(false)}
                    disabled={busy}
                    className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-60"
                  >
                    {blocked ? 'Close' : 'Cancel'}
                  </button>
                </div>

                <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
                  Removing a service hides it and stops it accepting requests. Nothing answered
                  through it is deleted — the records stay readable, because they are the
                  justification for care that was already given.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
