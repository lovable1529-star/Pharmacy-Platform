/**
 * Inventory.
 *
 * Stock is a **ledger**, not a counter. `StockLevel.quantity` is a cached
 * projection of `StockMovement` rows, kept for fast reads. The movements are the
 * truth.
 *
 * That matters for two reasons. A regulator asking "where did these 120 doses
 * go?" needs a trail, not a number. And when a cached level drifts from its
 * movements, that is a signal worth investigating rather than a figure to
 * quietly correct.
 */

export type MovementType =
  | 'RECEIPT'
  | 'ADMINISTRATION'
  | 'WASTAGE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT';

/** Movements that reduce stock. Quantities are always stored positive. */
const OUTBOUND: readonly MovementType[] = ['ADMINISTRATION', 'WASTAGE', 'TRANSFER_OUT'];

export interface StockMovementRecord {
  type: MovementType;
  quantity: number;
  createdAt: Date;
}

export function signedQuantity(movement: StockMovementRecord): number {
  return OUTBOUND.includes(movement.type) ? -movement.quantity : movement.quantity;
}

/** Recomputes a level from its movements. Used by the nightly drift check. */
export function projectStockLevel(movements: StockMovementRecord[]): number {
  return movements.reduce((total, m) => total + signedQuantity(m), 0);
}

export interface DriftReport {
  hasDrift: boolean;
  cached: number;
  projected: number;
  difference: number;
}

export function detectDrift(cached: number, movements: StockMovementRecord[]): DriftReport {
  const projected = projectStockLevel(movements);
  return {
    hasDrift: cached !== projected,
    cached,
    projected,
    difference: projected - cached,
  };
}

// ─────────────────────────────────────────────────────────────
// Batch selection
// ─────────────────────────────────────────────────────────────

export interface BatchStock {
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  quantity: number;
  recalledAt?: Date | null;
}

/**
 * Chooses which batch to use next: first-expiring, first-out.
 *
 * Skips recalled batches, expired batches and anything with no stock. Returns
 * null when nothing is usable — the caller surfaces that as a BLOCK rather than
 * falling back to an unsafe batch.
 */
export function selectBatch(batches: BatchStock[], now = new Date()): BatchStock | null {
  const usable = batches
    .filter((b) => !b.recalledAt && b.expiryDate > now && b.quantity > 0)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());

  return usable[0] ?? null;
}

// ─────────────────────────────────────────────────────────────
// Expiry forecasting
// ─────────────────────────────────────────────────────────────

export interface ExpiryAlert {
  batchId: string;
  batchNumber: string;
  productName: string;
  branchName: string;
  quantity: number;
  expiryDate: Date;
  daysRemaining: number;
  severity: 'EXPIRED' | 'URGENT' | 'SOON';
  /** At current usage, how many doses will still be on the shelf at expiry. */
  projectedWaste: number | null;
}

export interface BatchForForecast extends BatchStock {
  productName: string;
  branchName: string;
  /** Mean doses used per day at this branch, over a recent window. */
  dailyUsageRate?: number;
}

/**
 * Batches needing attention, with projected waste where a usage rate is known.
 *
 * "Expires in 40 days" is not actionable on its own. "Expires in 40 days and at
 * your current rate you will still be holding 62 doses" is — that is a decision
 * to run a clinic or transfer stock.
 */
export function forecastExpiry(
  batches: BatchForForecast[],
  now = new Date(),
  horizonDays = 90,
): ExpiryAlert[] {
  const alerts: ExpiryAlert[] = [];

  for (const batch of batches) {
    if (batch.recalledAt || batch.quantity <= 0) continue;

    const daysRemaining = Math.floor((batch.expiryDate.getTime() - now.getTime()) / 86_400_000);
    if (daysRemaining > horizonDays) continue;

    const severity: ExpiryAlert['severity'] =
      daysRemaining < 0 ? 'EXPIRED' : daysRemaining <= 30 ? 'URGENT' : 'SOON';

    let projectedWaste: number | null = null;
    if (batch.dailyUsageRate !== undefined && daysRemaining > 0) {
      const projectedUse = Math.floor(batch.dailyUsageRate * daysRemaining);
      projectedWaste = Math.max(0, batch.quantity - projectedUse);
    }

    alerts.push({
      batchId: batch.batchId,
      batchNumber: batch.batchNumber,
      productName: batch.productName,
      branchName: batch.branchName,
      quantity: batch.quantity,
      expiryDate: batch.expiryDate,
      daysRemaining,
      severity,
      projectedWaste,
    });
  }

  const order = { EXPIRED: 0, URGENT: 1, SOON: 2 };
  return alerts.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.daysRemaining - b.daysRemaining,
  );
}

// ─────────────────────────────────────────────────────────────
// Recall
// ─────────────────────────────────────────────────────────────

export interface AdministrationRecord {
  patientId: string;
  patientName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  administeredAt: Date;
  branchName: string;
  batchId: string;
}

export interface RecallImpact {
  batchNumber: string;
  affectedPatients: AdministrationRecord[];
  remainingStock: { branchName: string; quantity: number }[];
  totalAdministered: number;
  totalRemaining: number;
  contactable: number;
  uncontactable: number;
}

/**
 * Everything a recall needs, in one call.
 *
 * The client never asked for this. It is what makes batch tracking worth having:
 * a manufacturer withdrawal turns from a day of spreadsheet archaeology into a
 * list and a send button.
 *
 * `uncontactable` is surfaced deliberately — those patients need a phone call,
 * and the number should be visible rather than discovered later.
 */
export function assessRecallImpact(
  batchNumber: string,
  administrations: AdministrationRecord[],
  stockByBranch: { branchName: string; quantity: number }[],
): RecallImpact {
  const contactable = administrations.filter((a) => a.patientEmail || a.patientPhone).length;

  return {
    batchNumber,
    affectedPatients: [...administrations].sort(
      (a, b) => b.administeredAt.getTime() - a.administeredAt.getTime(),
    ),
    remainingStock: stockByBranch.filter((s) => s.quantity > 0),
    totalAdministered: administrations.length,
    totalRemaining: stockByBranch.reduce((sum, s) => sum + s.quantity, 0),
    contactable,
    uncontactable: administrations.length - contactable,
  };
}

/**
 * Mean daily usage over a window, for the expiry forecast.
 * Returns 0 rather than dividing by zero on an empty window.
 */
export function calculateUsageRate(
  movements: StockMovementRecord[],
  windowDays: number,
  now = new Date(),
): number {
  if (windowDays <= 0) return 0;

  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  const used = movements
    .filter((m) => m.type === 'ADMINISTRATION' && m.createdAt >= cutoff)
    .reduce((sum, m) => sum + m.quantity, 0);

  return used / windowDays;
}
