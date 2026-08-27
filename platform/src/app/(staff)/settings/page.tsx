/**
 * Settings — the reference data the client owns.
 *
 * Branches, pharmacists, GP surgeries, products and batches. All of it editable
 * by him rather than by a developer, because the alternative is a phone call
 * every time a new vaccine batch arrives.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import {
  branch, company, clinician, gpSurgery, product, batch, stockLevel, appUser, roleAssignment, role,
} from '@/lib/db/schema';
import { SettingsView } from './settings-view';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { actor, activeBranch, branches } = await getStaffContext();

  if (!can(actor, 'users:edit')) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">Settings needs administrator access.</p>
      </div>
    );
  }

  const org = actor.organisationId;

  const [companies, branchRows, clinicians, surgeries, products, batches, staff] =
    await Promise.all([
      db.select().from(company).where(eq(company.organisationId, org)),
      db
        .select({
          id: branch.id, name: branch.name, code: branch.code, phone: branch.phone,
          inboxEmail: branch.inboxEmail, town: branch.town, postcode: branch.postcode,
          companyName: company.name,
        })
        .from(branch)
        .innerJoin(company, eq(branch.companyId, company.id))
        .where(and(eq(branch.organisationId, org), isNull(branch.archivedAt))),
      db
        .select({ id: clinician.id, fullName: clinician.fullName, gphcNumber: clinician.gphcNumber })
        .from(clinician)
        .where(and(eq(clinician.organisationId, org), isNull(clinician.archivedAt))),
      db
        .select({ id: gpSurgery.id, name: gpSurgery.name, email: gpSurgery.email })
        .from(gpSurgery)
        .where(and(eq(gpSurgery.organisationId, org), isNull(gpSurgery.archivedAt))),
      db
        .select({ id: product.id, name: product.name, category: product.category })
        .from(product)
        .where(and(eq(product.organisationId, org), isNull(product.archivedAt))),
      db
        .select({
          id: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate,
          productName: product.name, recalledAt: batch.recalledAt,
          quantity: stockLevel.quantity, branchName: branch.name,
        })
        .from(batch)
        .innerJoin(product, eq(batch.productId, product.id))
        .leftJoin(stockLevel, eq(stockLevel.batchId, batch.id))
        .leftJoin(branch, eq(stockLevel.branchId, branch.id))
        .where(eq(batch.organisationId, org)),
      db
        .select({
          id: appUser.id, fullName: appUser.fullName, email: appUser.email,
          role: role.name, branchId: roleAssignment.branchId,
          validTo: roleAssignment.validTo,
        })
        .from(appUser)
        .leftJoin(roleAssignment, eq(roleAssignment.userId, appUser.id))
        .leftJoin(role, eq(roleAssignment.roleId, role.id))
        .where(and(eq(appUser.organisationId, org), isNull(appUser.archivedAt))),
    ]);

  return (
    <SettingsView
      companies={companies.map((c) => ({
        id: c.id, name: c.name, tradingName: c.tradingName, gphcNumber: c.gphcNumber,
      }))}
      branches={branchRows}
      clinicians={clinicians}
      surgeries={surgeries}
      products={products}
      batches={batches}
      staff={staff.map((s) => ({
        ...s,
        branchName: branches.find((b) => b.id === s.branchId)?.name ?? null,
      }))}
      activeBranch={
        activeBranch
          ? { id: activeBranch.id, name: activeBranch.name, companyId: activeBranch.companyId }
          : null
      }
    />
  );
}
