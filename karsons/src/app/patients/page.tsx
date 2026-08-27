'use client';

/**
 * Patient search page.
 *
 * The clinical workspace entry point. Wraps the tested search component and
 * runs it against the demo store — in production this calls a server action
 * that filters in Postgres first, then ranks with the same scoring code.
 */

import { useRouter } from 'next/navigation';
import { PatientSearch } from '@/components/clinical/patient-search';
import { searchPatients } from '@/lib/patients/search';
import { PATIENTS } from '@/lib/demo/data';

export default function PatientsPage() {
  const router = useRouter();

  return (
    <PatientSearch
      onSearch={async (query) => searchPatients(PATIENTS, query)}
      onSelect={(id) => router.push(`/patients/${id}`)}
      onCreateNew={(query) => router.push(`/patients/new?q=${encodeURIComponent(query)}`)}
    />
  );
}
