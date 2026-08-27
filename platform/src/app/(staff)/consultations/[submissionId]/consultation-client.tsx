'use client';

import {
  ConsultationForm, type BatchOption, type ClinicianOption,
} from '@/components/clinical/consultation-form';
import type { Answers, FormSchema } from '@/types/form-schema';
import { completeConsultation } from '../actions';

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
}) {
  return (
    <ConsultationForm
      patient={props.patient}
      schema={props.schema}
      patientAnswers={props.patientAnswers}
      clinicians={props.clinicians}
      batches={props.batches}
      branchName={props.branchName}
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
  );
}
