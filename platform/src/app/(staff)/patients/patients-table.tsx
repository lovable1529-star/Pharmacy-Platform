'use client';

/**
 * Every patient in the organisation — not filtered by branch.
 *
 * That is deliberate and it is the whole point: a patient who normally attends
 * Onchan must be findable at Kirk Michael. The legacy system modelled branches
 * as separate tenants, so this list could not exist.
 */

import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { ActionLink, DataTable, PageHeader, type Column } from '@/components/ui/data-table';
import { formatDate } from '@/lib/units';
import { ageInYears } from '@/lib/patients/search';
import type { PatientRow } from '@/lib/queries/clinical';

export function PatientsTable({ rows }: { rows: PatientRow[] }) {
  const router = useRouter();

  const columns: Column<PatientRow>[] = [
    {
      key: 'name',
      header: 'Patient',
      value: (r) => `${r.lastName}, ${r.firstName}`,
      render: (r) => (
        <span className="font-medium">{r.firstName} {r.lastName}</span>
      ),
    },
    {
      key: 'dateOfBirth',
      header: 'Date of birth',
      numeric: true,
      value: (r) => r.dateOfBirth,
      render: (r) => `${formatDate(r.dateOfBirth)} (${ageInYears(r.dateOfBirth)})`,
    },
    { key: 'postcode', header: 'Postcode', numeric: true, value: (r) => r.postcode },
    { key: 'phone', header: 'Phone', numeric: true, value: (r) => r.phone },
    { key: 'gpSurgeryName', header: 'GP surgery', value: (r) => r.gpSurgeryName },
    { key: 'registeredBranchName', header: 'Registered', value: (r) => r.registeredBranchName },
  ];

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-8">
      <PageHeader
        title="Patients"
        subtitle="Everyone registered with the group, findable from either branch."
        actions={
          <ActionLink href="/patients/new" icon={<UserPlus size={14} strokeWidth={2.4} />}>
            Add patient
          </ActionLink>
        }
      />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchPlaceholder="Filter by name, postcode, GP…"
        emptyTitle="No patients yet"
        emptyBody="Records appear here once patients complete a form or are added by staff."
        onRowClick={(r) => router.push(`/patients/${r.id}`)}
        exportName="karsons-patients"
      />
    </div>
  );
}
