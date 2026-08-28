'use client';

import { useRouter } from 'next/navigation';
import { UploadTargetProvider } from '@/components/fields/upload-context';

import {
  ConsultationForm, type BatchOption, type ClinicianOption,
} from '@/components/clinical/consultation-form';
import type { Answers, FormSchema } from '@/types/form-schema';
import { completeConsultation } from '../actions';
import { amendSubmission } from './amend-actions';

export function ConsultationClient(props: {
  submissionId: string;
  serviceId: string;
  branchId: string;
  companyId: string;
  branchName: string;
  patient: { id: string; fullName: string; dateOfBirth: string; addressLine1: string | null; postcode: string | null };
  schema: FormSchema;
  patientAnswers: Answers;
  clinicians: ClinicianOption[];
  batches: BatchOption[];
  patientAllergies: string[];
}) {
  const router = useRouter();

  return (
    <UploadTargetProvider value={{ submissionId: props.submissionId }}>
    <ConsultationForm
      patient={props.patient}
      schema={props.schema}
      patientAnswers={props.patientAnswers}
      clinicians={props.clinicians}
      batches={props.batches}
      patientAllergies={props.patientAllergies}
      branchName={props.branchName}
      onAmend={async (answers, reason) => {
        const result = await amendSubmission({
          submissionId: props.submissionId,
          answers,
          reason,
        });
        // Pull the corrected answers — and any re-triaged outcome — back down,
        // so the panel shows what is now on the record rather than what the
        // clinician typed.
        if (result.ok) router.refresh();
        return result;
      }}
      onComplete={async (input) =>
        completeConsultation({
          submissionId: props.submissionId,
          patientId: props.patient.id,
          serviceId: props.serviceId,
          branchId: props.branchId,
          companyId: props.companyId,
          ...input,
        })
      }
    />
    </UploadTargetProvider>
  );
}
