import { and, eq, isNull } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { getStock } from '@/lib/queries/clinical';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import { product } from '@/lib/db/schema';
import { InventoryTable } from './inventory-table';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const { actor, activeBranch } = await getStaffContext();

  // The catalogue is needed for the receive dialog's product picker. Read
  // alongside the stock rather than after it — two sequential round trips to
  // Seoul is most of this page's load time.
  const [rows, products] = await Promise.all([
    getStock(actor.organisationId),
    db
      .select({ id: product.id, name: product.name })
      .from(product)
      .where(and(eq(product.organisationId, actor.organisationId), isNull(product.archivedAt)))
      .orderBy(product.name),
  ]);

  return (
    <InventoryTable
      rows={rows}
      products={products}
      branchName={activeBranch?.name ?? null}
      canExport={can(actor, 'inventory:export')}
      branchId={activeBranch?.id ?? null}
      companyId={activeBranch?.companyId ?? null}
      canEdit={can(
        actor,
        'inventory:edit',
        activeBranch ? { branchId: activeBranch.id, companyId: activeBranch.companyId } : {},
      )}
      canRecall={can(
        actor,
        'inventory:disable',
        activeBranch ? { branchId: activeBranch.id, companyId: activeBranch.companyId } : {},
      )}
    />
  );
}
