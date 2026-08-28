'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Loader2, AlertTriangle, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import { duplicateService } from './actions';

export interface DuplicableService {
  id: string;
  name: string;
  hasRules: boolean;
}

export function NewServiceButton({ services }: { services: DuplicableService[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState(services[0]?.id ?? '');
  const [name, setName] = useState('');
  const [copyRules, setCopyRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = services.find((s) => s.id === sourceId);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await duplicateService({ sourceServiceId: sourceId, name, copyRules });
    setBusy(false);

    if (result.ok) {
      setOpen(false);
      router.push(`/services/${result.slug}/designer`);
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={services.length === 0}
        className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        <Plus size={15} strokeWidth={2.2} />
        New service
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} aria-hidden="true" />

          <div
            role="dialog"
            aria-label="New service"
            className="relative w-full max-w-[460px] overflow-hidden rounded-panel bg-surface shadow-pop"
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <Copy size={17} strokeWidth={2} className="mt-0.5 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[17px] font-semibold text-ink">New service</h2>
                <p className="text-[12.5px] text-ink-faint">
                  Start from an existing one — you keep the consent wording and declarations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
              >
                <X size={17} strokeWidth={2} />
              </button>
            </div>

            <div className="px-5 py-4">
              <label htmlFor="source" className="mb-1.5 block text-[13px] font-medium text-ink">
                Copy from
              </label>
              <div className="mb-4">
                <SearchSelect
                  id="source"
                  value={sourceId}
                  onChange={(next) => { setSourceId(next); setCopyRules(false); }}
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>

              <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-ink">
                Name the new service
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. COVID-19 Vaccination"
                className="mb-4 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
              />

              {source?.hasRules ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={copyRules}
                  onClick={() => setCopyRules((v) => !v)}
                  className="mb-4 flex items-start gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
                      copyRules ? 'border-brand-600 bg-brand-600' : 'border-line',
                    )}
                  >
                    {copyRules ? <Plus size={11} strokeWidth={3} className="rotate-45 text-white" /> : null}
                  </span>
                  <span>
                    <span className="block text-[13px] font-medium text-ink">
                      Copy the clinical rules too
                    </span>
                    <span className="block text-[11.5px] leading-tight text-ink-faint">
                      Only sensible if the new service is clinically similar.
                    </span>
                  </span>
                </button>
              ) : null}

              {error ? (
                <p role="alert" className="mb-3 flex items-start gap-1.5 text-[13px] text-stop-700">
                  <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={create}
                disabled={busy || !name.trim()}
                className={cn(
                  'flex items-center gap-1.5 rounded-control px-4 py-2 text-[13.5px] font-semibold text-white transition-colors',
                  busy || !name.trim() ? 'cursor-not-allowed bg-ink-faint' : 'bg-brand-600 hover:bg-brand-700',
                )}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Create and edit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
