/**
 * Personalising a repeat questionnaire before the patient sees it.
 *
 * Two things in §4.3 are properties of the person filling the form in, not of
 * the form itself, so they cannot live in the published schema:
 *
 *   the dose dropdown offers only the same strength or one step either way
 *   a read-only recommendation is shown BEFORE they choose
 *
 * Both are computed from the previous supply and injected into a COPY of the
 * schema at render time. The published version is untouched — a patient's
 * answers stay bound to it, and two patients on different strengths must not
 * cause two different published versions to exist.
 *
 * The safety rules do not depend on any of this. `dose-skip` still fires on the
 * server, because a narrowed dropdown is a courtesy and the ruleset is the
 * guarantee.
 */

import type { FormSchema, FormField, FieldOption } from '@/types/form-schema';
import { allowedDoseOptions, systemRecommendation, type RecommendationInput } from './repeat-request';
import type { DoseLadders } from './derived';

/** The field ids §4.3 describes, as this project names them. */
const DOSE_FIELD = 'requestedMedicine';
const RECOMMENDATION_FIELD = 'systemRecommendation';

export interface PersonalisationInput {
  schema: FormSchema;
  /** `mounjaro_7.5mg`, from the enrolment. Null before a first supply. */
  currentMedicineValue: string | null;
  ladders?: DoseLadders;
  recommendation?: RecommendationInput | null;
}

function mapFields(
  fields: FormField[],
  transform: (field: FormField) => FormField,
): FormField[] {
  return fields.map((field) => {
    const next = transform(field);
    if (!next.reveals) return next;

    // Revealed fields are fields too — the dose question could reasonably sit
    // behind "do you want to change your dose?".
    return {
      ...next,
      reveals: next.reveals.map((reveal) => ({
        ...reveal,
        fields: mapFields(reveal.fields, transform),
      })),
    };
  });
}

/**
 * Return a schema tailored to this patient.
 *
 * Returns the original object unchanged when there is nothing to personalise,
 * so a first consultation or a service with no dose ladder costs nothing.
 */
export function personaliseRepeatSchema(input: PersonalisationInput): FormSchema {
  const options = input.currentMedicineValue
    ? allowedDoseOptions(input.currentMedicineValue, input.ladders)
    : [];

  const advice = input.recommendation ? systemRecommendation(input.recommendation) : null;

  if (options.length === 0 && !advice) return input.schema;

  const doseOptions: FieldOption[] = options.map((o) => ({
    value: o.value,
    label: o.label,
    metadata: { direction: o.direction },
  }));

  const transform = (field: FormField): FormField => {
    if (field.id === DOSE_FIELD && doseOptions.length > 0) {
      return {
        ...field,
        options: doseOptions,
        helpText:
          'You can stay on your current strength or move one step. Bigger changes '
          + 'need a conversation with a pharmacist first.',
      };
    }

    if (field.id === RECOMMENDATION_FIELD && advice) {
      // An information block, not an answerable question: §4.3 calls it a
      // read-only result. Making it answerable would invite a patient to
      // "agree" with advice, which is not what is being asked of them.
      return {
        ...field,
        type: 'infoBlock',
        label: 'What we would suggest',
        helpText: advice.reason,
        required: false,
      };
    }

    return field;
  };

  return {
    ...input.schema,
    steps: input.schema.steps.map((step) => ({
      ...step,
      fields: mapFields(step.fields, transform),
    })),
  };
}
