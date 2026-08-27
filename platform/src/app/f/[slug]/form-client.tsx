'use client';

import { useState } from 'react';
import { FormWizard } from '@/components/form/wizard';
import type { Answers, FormSchema } from '@/types/form-schema';
import { submitPublicForm, type SubmitResult } from './actions';

export function PublicForm({ slug, schema }: { slug: string; schema: FormSchema }) {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(answers: Answers) {
    setError(null);
    // Files are not JSON-serialisable; upload handling is a separate step.
    const payload: Answers = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => !(v instanceof File)),
    );

    const result: SubmitResult = await submitPublicForm(slug, payload);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      throw new Error(result.error);
    }
  }

  return (
    <>
      {error ? (
        <div className="mx-auto max-w-[1000px] px-5 pt-6">
          <div className="rounded-[9px] border border-stop-200 bg-stop-50 px-4 py-3 text-[14px] text-stop-700">
            {error}
          </div>
        </div>
      ) : null}
      <FormWizard schema={schema} onSubmit={handleSubmit} submitLabel="Submit my answers" />
    </>
  );
}
