import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { getConsultations } from '@/lib/queries/clinical';
import { ConsultationsTable } from './consultations-table';

export const dynamic = 'force-dynamic';

export default async function ConsultationsPage() {
  const { actor } = await getStaffContext();
  const rows = await getConsultations(actor.organisationId);
  return <ConsultationsTable rows={rows} canExport={can(actor, 'consultations:export')} />;
}
