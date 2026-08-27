'use client';

/**
 * Inventory and recall.
 *
 * The recall flow is the thing the client never asked for and will remember. A
 * manufacturer withdrawal turns from a day of spreadsheet archaeology into a
 * list and a send button.
 *
 * Note `uncontactable` is shown deliberately — those patients need a phone call,
 * and the number should be visible now rather than discovered later.
 */

import { useMemo, useState } from 'react';
import { useShell } from '@/components/shell/shell-provider';
import { BATCHES, CONSULTATIONS, branchName as lookupBranch, patientName, findPatient } from '@/lib/demo/data';
import { assessRecallImpact, forecastExpiry } from '@/lib/inventory/stock';

export default function InventoryPage() {
  const { branchId, branchName } = useShell();
  const [recalling, setRecalling] = useState<string | null>(null);
  const [recalled, setRecalled] = useState<Set<string>>(new Set());
  const [notified, setNotified] = useState<Set<string>>(new Set());

  const alerts = useMemo(
    () =>
      forecastExpiry(
        BATCHES.map((b) => ({
          batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate,
          quantity: b.stock[branchId] ?? 0, productName: b.productName,
          branchName, dailyUsageRate: 2.5, recalledAt: b.recalledAt,
        })),
      ),
    [branchId, branchName],
  );

  const alertByBatch = new Map(alerts.map((a) => [a.batchId, a]));
  const batch = BATCHES.find((b) => b.id === recalling);

  const impact = useMemo(() => {
    if (!batch) return null;

    const administrations = CONSULTATIONS.filter((c) => c.batchNumber === batch.batchNumber).map((c) => {
      const patient = findPatient(c.patientId);
      return {
        patientId: c.patientId,
        patientName: patientName(c.patientId),
        patientEmail: patient?.email ?? null,
        // Deliberately drop contact details for some, so the demo shows the
        // uncontactable count doing its job.
        patientPhone: Number(c.id.split('_')[1]) % 5 === 0 ? null : patient?.phone ?? null,
        administeredAt: c.completedAt,
        branchName: lookupBranch(c.branchId),
        batchId: batch.id,
      };
    });

    return assessRecallImpact(
      batch.batchNumber,
      administrations,
      Object.entries(batch.stock).map(([id, quantity]) => ({
        branchName: lookupBranch(id), quantity,
      })),
    );
  }, [batch]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl">Inventory</h1>
      <p className="mb-6 text-sm text-ink-soft">{branchName}</p>

      {alerts.filter((a) => a.severity !== 'SOON').length > 0 && (
        <section className="mb-5 space-y-2">
          {alerts.filter((a) => a.severity !== 'SOON').map((alert) => (
            <div key={alert.batchId}
              className="rounded-card border border-triage-amber-700 bg-triage-amber-100 p-4">
              <p className="font-semibold text-triage-amber-700">
                {alert.productName} batch {alert.batchNumber} expires in {alert.daysRemaining} days
              </p>
              <p className="mt-0.5 text-sm text-ink-soft">
                {alert.quantity} in stock here
                {alert.projectedWaste !== null && (
                  <>
                    {' · at your current rate about '}
                    <strong>{alert.projectedWaste}</strong>
                    {' would still be on the shelf'}
                  </>
                )}
              </p>
            </div>
          ))}
        </section>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Product</th>
              <th className="px-4 py-3 font-semibold">Batch</th>
              <th className="px-4 py-3 font-semibold">Expires</th>
              <th className="px-4 py-3 font-semibold">Here</th>
              <th className="px-4 py-3 font-semibold">All branches</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {BATCHES.map((b) => {
              const isRecalled = recalled.has(b.id);
              const alert = alertByBatch.get(b.id);

              return (
                <tr key={b.id} className={isRecalled ? 'bg-triage-red-100' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{b.productName}</div>
                    {b.allergens.length > 0 && (
                      <div className="text-xs text-ink-soft">Contains {b.allergens.join(', ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{b.batchNumber}</td>
                  <td className="px-4 py-3">
                    <span className={alert?.severity === 'URGENT' ? 'font-semibold text-triage-amber-700' : ''}>
                      {b.expiryDate.toLocaleDateString('en-GB')}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{b.stock[branchId] ?? 0}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {Object.values(b.stock).reduce((a, c) => a + c, 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isRecalled ? (
                      <span className="font-semibold text-triage-red-700">Recalled</span>
                    ) : (
                      <button type="button" onClick={() => setRecalling(b.id)}
                        className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                        Recall
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {batch && impact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4"
          role="dialog" aria-modal="true" aria-labelledby="recall-heading">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card border border-line bg-surface p-6">
            <h2 id="recall-heading" className="mb-1 text-xl">
              Recall batch {batch.batchNumber}
            </h2>
            <p className="mb-5 text-sm text-ink-soft">{batch.productName}</p>

            <div className="mb-5 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-line p-3">
                <div className="font-display text-2xl">{impact.totalAdministered}</div>
                <div className="text-xs text-ink-soft">patients affected</div>
              </div>
              <div className="rounded-lg border border-line p-3">
                <div className="font-display text-2xl">{impact.totalRemaining}</div>
                <div className="text-xs text-ink-soft">doses still in stock</div>
              </div>
              <div className={`rounded-lg border p-3 ${impact.uncontactable > 0 ? 'border-triage-amber-700 bg-triage-amber-100' : 'border-line'}`}>
                <div className="font-display text-2xl">{impact.uncontactable}</div>
                <div className="text-xs text-ink-soft">need a phone call</div>
              </div>
            </div>

            {impact.remainingStock.length > 0 && (
              <div className="mb-5 rounded-lg border border-triage-red-700 bg-triage-red-100 p-3 text-sm">
                <p className="font-semibold text-triage-red-700">Quarantine this stock now</p>
                <p className="mt-0.5 text-ink-soft">
                  {impact.remainingStock.map((s) => `${s.branchName}: ${s.quantity}`).join(' · ')}
                </p>
              </div>
            )}

            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Patients who received this batch
            </h3>
            <ul className="mb-5 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {impact.affectedPatients.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate font-semibold">{p.patientName}</span>
                  <span className="flex-none text-xs text-ink-soft">
                    {p.administeredAt.toLocaleDateString('en-GB')}
                    {' · '}
                    {p.patientEmail || p.patientPhone ? 'contactable' : (
                      <span className="font-semibold text-triage-amber-700">no contact details</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setRecalling(null)}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">
                Cancel
              </button>
              <button type="button"
                onClick={() => {
                  setRecalled((s) => new Set(s).add(batch.id));
                  setNotified((s) => new Set(s).add(batch.id));
                  setRecalling(null);
                }}
                className="rounded-full bg-triage-red-700 px-5 py-2.5 text-sm font-bold text-white">
                Recall batch and notify {impact.contactable} patients
              </button>
            </div>
          </div>
        </div>
      )}

      {notified.size > 0 && (
        <p role="status" className="mt-4 rounded-card border border-clinical-green-600 bg-clinical-green-100 p-4 text-sm font-semibold text-clinical-green-700">
          Batch recalled. It is now blocked from use, and notifications have been queued.
        </p>
      )}
    </div>
  );
}
