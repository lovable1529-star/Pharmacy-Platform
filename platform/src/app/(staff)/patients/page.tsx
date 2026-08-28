import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { getPatients } from '@/lib/queries/clinical';
import { PatientsTable } from './patients-table';

export const dynamic = 'force-dynamic';

export default async function PatientsPage() {
  const { actor } = await getStaffContext();
  const patients = await getPatients(actor.organisationId);
  return <PatientsTable rows={patients} canExport={can(actor, 'patients:export')} />;
}
