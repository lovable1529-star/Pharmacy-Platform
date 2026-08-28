/**
 * Vaccinations — the pharmacist's home for this service.
 *
 * §26.1 asks for a screen that starts with finding a person, not with
 * navigating a table. The pharmacist has someone standing in front of them and
 * one question: have they filled the form in, or are we doing it now?
 *
 * Built for vaccination generally rather than flu specifically — §28.2 is
 * explicit that the same machinery carries COVID, hepatitis, shingles and the
 * rest, so this lists every service of kind VACCINATION.
 */

import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { getVaccinationCandidates } from '@/lib/queries/vaccinations';
import { VaccinationsView } from './vaccinations-view';

export const dynamic = 'force-dynamic';

export default async function VaccinationsPage() {
  const { actor } = await getStaffContext();
  const candidates = await getVaccinationCandidates(actor.organisationId);

  return (
    <VaccinationsView
      rows={candidates}
      canRecord={can(actor, 'consultations:add')}
    />
  );
}
