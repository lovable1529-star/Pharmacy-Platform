'use client';

/**
 * The preview wrapper.
 *
 * Thin on purpose: the preview must be the same renderer as the patient form,
 * not a second implementation that drifts from it. Everything that makes a
 * preview a preview lives in the wizard's `preview` mode.
 */

import { FormWizard } from '@/components/form/wizard';
import type { FormSchema } from '@/types/form-schema';

export function FormPreview({ schema }: { schema: FormSchema }) {
  return <FormWizard schema={schema} preview />;
}
