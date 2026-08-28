import { getStaffContext } from '@/lib/auth/context';
import { getStock } from '@/lib/queries/clinical';
import { can } from '@/lib/tenancy/scope';
import { InventoryTable } from './inventory-table';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const { actor, activeBranch } = await getStaffContext();
  const rows = await getStock(actor.organisationId);

  return (
    <InventoryTable
      rows={rows}
      canExport={can(actor, 'inventory:export')}
      branchId={activeBranch?.id ?? null}
      companyId={activeBranch?.companyId ?? null}
      canRecall={can(
        actor,
        'inventory:disable',
        activeBranch ? { branchId: activeBranch.id, companyId: activeBranch.companyId } : {},
      )}
    />
  );
}
