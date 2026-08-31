'use client';

/**
 * The preview wrapper.
 *
 * Thin on purpose: the preview must be the same renderer as the patient form,
 * not a second implementation that drifts from it. Everything that makes a
 * preview a preview lives in the wizard's `preview` mode.
 */

import { FormWizard, type WizardResource } from '@/components/form/wizard';
import type { FormSchema } from '@/types/form-schema';

export function FormPreview({
  schema, resources = [],
}: {
  schema: FormSchema;
  /** Shown here too, so checking a form shows what the patient actually sees. */
  resources?: WizardResource[];
}) {
  return <FormWizard schema={schema} resources={resources} preview />;
}
