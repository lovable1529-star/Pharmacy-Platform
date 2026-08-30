'use client';

/**
 * Taking a delivery into stock.
 *
 * This lived in Settings → Stock, behind a menu a pharmacist opens perhaps once
 * a month, while the thing it changes — the stock list — lived somewhere else
 * entirely. Muka asked for quantity, batch number and expiry to go "into
 * inventory", and he was describing where the job actually happens.
 *
 * It is a dialog rather than a permanent form because receiving is occasional
 * and reading the stock list is constant; a form pinned to the page would push
 * the list down every day to serve a task done every few weeks.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, PackagePlus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Portal } from '@/components/ui/portal';
import { SearchSelect } from '@/components/ui/search-select';
import { receiptProblem } from '@/lib/inventory/receipts';
import { receiveBatch } from './actions';

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)]';
const labelClass = 'mb-1.5 block text-[12.5px] font-medium text-ink-soft';

export function ReceiveDialog({
  products, branchId, companyId, branchName, onClose,
}: {
  products: { id: string; name: string }[];
  branchId: string;
  companyId: string;
  branchName: string;
  onClose: (received: boolean) => void;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<string | null>(null);

  const firstField = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose(received !== null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, received, onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const draft = { productId, batchNumber, expiryDate, quantity: Number(quantity) };

    /*
     * Checked here as well as on the server, using the same function, so the
     * pharmacist gets the answer without a round trip to Seoul — and gets the
     * same answer either way.
     */
    const problem = receiptProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    const result = await receiveBatch({ ...draft, branchId, companyId });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Kept open, cleared and ready. A delivery is rarely one batch, and closing
    // after each one turns a five-line job into five trips through the menu.
    const name = products.find((p) => p.id === productId)?.name ?? 'Batch';
    setReceived(`${name} — ${batchNumber.trim()} added to ${branchName}.`);
    setBatchNumber(''); setExpiryDate(''); setQuantity('');
    router.refresh();
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <div
          className="fixed inset-0 animate-fade bg-ink/25 backdrop-blur-[2px]"
          onClick={() => !busy && onClose(received !== null)}
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Receive stock at ${branchName}`}
          className="relative w-full max-w-[520px] animate-rise overflow-hidden rounded-modal border border-line bg-surface shadow-pop"
        >
          <div className="flex items-start gap-3 border-b border-line bg-sunk px-5 py-3.5">
            <PackagePlus size={16} strokeWidth={2.1} className="mt-0.5 shrink-0 text-brand-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15.5px] font-semibold text-ink">Receive stock</h2>
              <p className="m-0 text-[12.5px] text-ink-faint">Into {branchName}</p>
            </div>
            <button
              type="button"
              onClick={() => onClose(received !== null)}
              disabled={busy}
              aria-label="Close"
              className="shrink-0 rounded-[6px] p-1.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              <X size={17} strokeWidth={2} />
            </button>
          </div>

          <form onSubmit={submit} className="px-5 py-5">
            <div className="mb-4" ref={firstField}>
              <label className={labelClass} htmlFor="receive-product">Product</label>
              <SearchSelect
                value={productId}
                onChange={setProductId}
                placeholder="Search products…"
                aria-label="Product"
                options={products.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className={labelClass} htmlFor="receive-batch">Batch number</label>
                <input
                  id="receive-batch"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  placeholder="e.g. FLU24-881"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="receive-expiry">Expiry date</label>
                <input
                  id="receive-expiry"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="receive-quantity">Doses</label>
                <input
                  id="receive-quantity"
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className={cn(inputClass, 'tabular')}
                />
              </div>
            </div>

            {error ? (
              <p role="alert" className="mb-3 flex items-start gap-1.5 text-[13px] text-stop-700">
                <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />
                {error}
              </p>
            ) : null}

            {received && !error ? (
              <p className="mb-3 rounded-control bg-safe-50 px-3 py-2 text-[13px] text-safe-700">
                {received} Add another, or close.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-1.5 rounded-control bg-brand-600 px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
              >
                {busy
                  ? <Loader2 size={14} className="animate-spin" />
                  : <PackagePlus size={14} strokeWidth={2.2} />}
                Receive batch
              </button>
              <button
                type="button"
                onClick={() => onClose(received !== null)}
                disabled={busy}
                className="rounded-control border border-line px-3.5 py-2 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-60"
              >
                {received ? 'Done' : 'Cancel'}
              </button>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
              The batch number is what a recall is traced through, so it is worth typing
              carefully. Stock is received into {branchName} — switch branch in the header to
              receive somewhere else.
            </p>
          </form>
        </div>
      </div>
    </Portal>
  );
}
