'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CloudOff, Loader2 } from 'lucide-react';
import { FormWizard } from '@/components/form/wizard';
import { UploadTargetProvider } from '@/components/fields/upload-context';
import type { Answers, FormSchema } from '@/types/form-schema';
import { saveFormDraft, submitPublicForm, type SubmitResult } from './actions';

/** Long enough that typing a sentence is one save, short enough to feel safe. */
const AUTOSAVE_DELAY_MS = 1200;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function PublicForm({
  slug,
  schema,
  token,
  savedAnswers,
}: {
  slug: string;
  schema: FormSchema;
  token: string | null;
  savedAnswers: Answers | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Answers | null>(null);
  // Once submitted, a late-firing autosave must not write over the submission.
  const stopped = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleChange = useCallback(
    (answers: Answers) => {
      if (!token || stopped.current) return;

      pending.current = answers;
      setSaveState('saving');

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const snapshot = pending.current;
        if (!snapshot || stopped.current) return;

        // Files cannot cross the wire as JSON; they are uploaded separately.
        const payload = Object.fromEntries(
          Object.entries(snapshot).filter(([, v]) => !(v instanceof File)),
        ) as Answers;

        const result = await saveFormDraft(token, payload);
        if (stopped.current) return;
        setSaveState(result.ok ? 'saved' : 'failed');
      }, AUTOSAVE_DELAY_MS);
    },
    [token],
  );

  async function handleSubmit(answers: Answers) {
    setError(null);

    // Cancel any in-flight autosave first. Otherwise a debounce timer that fires
    // a moment after submit writes DRAFT answers over a submitted form.
    stopped.current = true;
    if (timer.current) clearTimeout(timer.current);

    const payload: Answers = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => !(v instanceof File)),
    );

    const result: SubmitResult = await submitPublicForm(slug, payload, token);
    if (!result.ok) {
      // Let them keep editing — the form is not lost because the send failed.
      stopped.current = false;
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

      {token ? (
        <div className="mx-auto max-w-[1000px] px-5 pt-4">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-faint">
            {saveState === 'saving' ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving…
              </>
            ) : saveState === 'saved' ? (
              <>
                <Check size={12} strokeWidth={2.4} className="text-safe-600" />
                Answers saved — you can close this and come back to it later.
              </>
            ) : saveState === 'failed' ? (
              <span className="flex items-center gap-1.5 text-review-700">
                <CloudOff size={12} strokeWidth={2.2} />
                We could not save just now. Keep going — we will try again as you type.
              </span>
            ) : (
              'Your answers save automatically as you go.'
            )}
          </div>
        </div>
      ) : null}

      <UploadTargetProvider value={{ token }}>
        <FormWizard
          schema={schema}
          initialAnswers={savedAnswers ?? {}}
          onAnswersChange={handleChange}
          onSubmit={handleSubmit}
          submitLabel="Submit my answers"
        />
      </UploadTargetProvider>
    </>
  );
}
