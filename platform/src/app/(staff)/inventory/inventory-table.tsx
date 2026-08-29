'use client';

/**
 * Stock across every branch.
 *
 * Quantities here are the cached projection of the movement ledger, so they can
 * always be reconciled against what actually happened. In the legacy system the
 * Issued Items table was empty — stock never moved, and the numbers on screen
 * were fiction.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/primitives';
import { formatDate } from '@/lib/units';
import type { StockRow } from '@/lib/queries/clinical';
import { RecallDialog } from './recall-dialog';
import { MovementDialog } from './movement-dialog';

function expiryTone(days: number): string {
  if (days <= 0) return 'bg-stop-100 text-stop-700';
  if (days <= 30) return 'bg-stop-100 text-stop-700';
  if (days <= 90) return 'bg-review-100 text-review-700';
  return 'bg-sunk text-ink-faint';
}

export function InventoryTable({
  rows, branchId, companyId, canRecall, canEdit, canExport,
}: {
  rows: StockRow[];
  branchId: string | null;
  companyId: string | null;
  canRecall: boolean;
  canEdit: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const [recalling, setRecalling] = useState<string | null>(null);
  const [moving, setMoving] = useState<StockRow | null>(null);

  const total = rows.reduce((n, r) => n + r.quantity, 0);
  const expiring = rows.filter((r) => r.daysToExpiry <= 90 && r.quantity > 0).length;

  const columns: Column<StockRow>[] = [
    { key: 'productName', header: 'Product', value: (r) => r.productName },
    { key: 'batchNumber', header: 'Batch', numeric: true, value: (r) => r.batchNumber },
    {
      key: 'expiryDate',
      header: 'Expires',
      numeric: true,
      value: (r) => r.expiryDate,
      render: (r) => (
        <span className="flex items-center gap-2">
          {formatDate(r.expiryDate)}
          <span className={`rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${expiryTone(r.daysToExpiry)}`}>
            {r.daysToExpiry <= 0 ? 'expired' : `${r.daysToExpiry}d`}
          </span>
        </span>
      ),
    },
    { key: 'branchName', header: 'Branch', value: (r) => r.branchName },
    {
      key: 'quantity',
      header: 'In stock',
      numeric: true,
      align: 'right',
      value: (r) => r.quantity,
      render: (r) => (
        <span className={r.quantity <= 10 ? 'font-semibold text-review-700' : ''}>{r.quantity}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      value: (r) => (r.recalledAt ? 'Recalled' : r.daysToExpiry <= 0 ? 'Expired' : 'Available'),
      render: (r) =>
        r.recalledAt ? (
          <span className="rounded-[5px] bg-stop-100 px-2 py-0.5 font-mono text-[10px] uppercase text-stop-700">
            Recalled
          </span>
        ) : r.daysToExpiry <= 0 ? (
          <span className="rounded-[5px] bg-stop-100 px-2 py-0.5 font-mono text-[10px] uppercase text-stop-700">
            Expired
          </span>
        ) : (
          <span className="rounded-[5px] bg-safe-100 px-2 py-0.5 font-mono text-[10px] uppercase text-safe-700">
            Available
          </span>
        ),
    },
  ];

  if (canEdit && branchId) {
    columns.push({
      key: 'move',
      header: '',
      align: 'right',
      value: () => null,
      // Only the branch you are working from: stock is per branch, and moving
      // it somewhere you are not standing is how a count drifts.
      render: (r) =>
        r.branchId !== branchId ? null : (
          <button
            type="button"
            onClick={() => setMoving(r)}
            className="rounded-[6px] border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            Move
          </button>
        ),
    });
  }

  if (canRecall && branchId && companyId) {
    columns.push({
      key: 'recall',
      header: '',
      align: 'right',
      value: () => null,
      render: (r) =>
        r.recalledAt ? null : (
          <button
            type="button"
            onClick={() => setRecalling(r.batchId)}
            className="rounded-[6px] border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-stop-200 hover:text-stop-700"
          >
            Recall
          </button>
        ),
    });
  }

  return (
    <div className="page-shell mx-auto max-w-[calc(1080px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Inventory"
        subtitle={`${total} doses in stock across the group. Stock decrements automatically when a consultation is recorded.`}
      />

      {expiring > 0 ? (
        <div className="mb-5 rounded-[9px] border border-review-200 bg-review-50 px-4 py-3 text-[13.5px] text-review-700">
          {expiring} batch{expiring === 1 ? '' : 'es'} expiring within 90 days. Use these first —
          the consultation screen offers them in expiry order.
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.batchId}-${r.branchId}`}
        searchPlaceholder="Filter by product or batch — showing all branches…"
        emptyTitle="No stock recorded"
        emptyBody="Add products and batches in Settings, then record a receipt."
        exportName="karsons-inventory"
        canExport={canExport}
      />

      {moving && branchId ? (
        <MovementDialog
          batchId={moving.batchId}
          branchId={branchId}
          companyId={companyId}
          productName={moving.productName}
          batchNumber={moving.batchNumber}
          currentQuantity={moving.quantity}
          recalled={moving.recalledAt !== null}
          onClose={() => setMoving(null)}
        />
      ) : null}

      {recalling && branchId && companyId ? (
        <RecallDialog
          batchId={recalling}
          branchId={branchId}
          companyId={companyId}
          onClose={(recalled) => {
            setRecalling(null);
            if (recalled) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
