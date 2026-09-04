'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CloudOff, Loader2 } from 'lucide-react';
import { FormWizard, type WizardResource } from '@/components/form/wizard';
import { UploadTargetProvider } from '@/components/fields/upload-context';
import type { Answers, FormSchema } from '@/types/form-schema';
import { saveFormDraft, startFormDraft, submitPublicForm, type SubmitResult } from './actions';

/** Long enough that typing a sentence is one save, short enough to feel safe. */
const AUTOSAVE_DELAY_MS = 1200;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function PublicForm({
  slug,
  schema,
  token,
  savedAnswers,
  resources = [],
  referralUrl = null,
}: {
  slug: string;
  schema: FormSchema;
  token: string | null;
  savedAnswers: Answers | null;
  /** Leaflets shown immediately before the signature. */
  resources?: WizardResource[];
  /** Where a patient who would rather be seen in person is sent. */
  referralUrl?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  /*
   * The token is what autosave writes against and what authorises an upload.
   *
   * A patient reaching a booked questionnaire arrives holding one. A patient
   * arriving cold at the public form — which is now the front door of the
   * entire new-patient service — did not, so nothing they typed was saved and
   * every upload was refused with "this form cannot take attachments, please
   * bring the document with you". Three of those uploads are required, which
   * made the form impossible to submit.
   *
   * One is now opened on their first interaction. Not on page load: a draft
   * per visitor leaves a row for every bot and everybody who opened the page
   * and thought better of it, whereas a draft on the first keystroke belongs
   * to somebody who has actually started.
   */
  const [liveToken, setLiveToken] = useState<string | null>(token);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Answers | null>(null);
  // Once submitted, a late-firing autosave must not write over the submission.
  const stopped = useRef(false);
  // Guards against two quick keystrokes each opening their own draft.
  const starting = useRef<Promise<string | null> | null>(null);

  const ensureToken = useCallback(async (): Promise<string | null> => {
    if (liveToken) return liveToken;
    if (starting.current) return starting.current;

    starting.current = startFormDraft(slug).then((result) => {
      const issued = result.ok && result.token ? result.token : null;
      if (issued) setLiveToken(issued);
      return issued;
    });

    return starting.current;
  }, [liveToken, slug]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleChange = useCallback(
    (answers: Answers) => {
      if (stopped.current) return;

      pending.current = answers;
      setSaveState('saving');

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const snapshot = pending.current;
        if (!snapshot || stopped.current) return;

        // Opened here rather than on load, so the row belongs to somebody who
        // has actually typed something.
        const active = await ensureToken();
        if (!active || stopped.current) {
          setSaveState('failed');
          return;
        }

        // Files cannot cross the wire as JSON; they are uploaded separately.
        const payload = Object.fromEntries(
          Object.entries(snapshot).filter(([, v]) => !(v instanceof File)),
        ) as Answers;

        const result = await saveFormDraft(active, payload);
        if (stopped.current) return;
        setSaveState(result.ok ? 'saved' : 'failed');
      }, AUTOSAVE_DELAY_MS);
    },
    [ensureToken],
  );

  async function handleSubmit(answers: Answers, acknowledgedResourceIds: string[]) {
    setError(null);

    // Cancel any in-flight autosave first. Otherwise a debounce timer that fires
    // a moment after submit writes DRAFT answers over a submitted form.
    stopped.current = true;
    if (timer.current) clearTimeout(timer.current);

    const payload: Answers = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => !(v instanceof File)),
    );

    const result: SubmitResult = await submitPublicForm(
      slug, payload, token, acknowledgedResourceIds,
    );
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

      {liveToken ? (
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

      <UploadTargetProvider value={{ token: liveToken, onNeedToken: ensureToken }}>
        <FormWizard
          schema={schema}
          initialAnswers={savedAnswers ?? {}}
          onAnswersChange={handleChange}
          onSubmit={handleSubmit}
          resources={resources}
          referralUrl={referralUrl}
          /*
            The resume token doubles as the tracking credential — unguessable,
            already issued, and the same model the payment link uses. Null only
            for somebody who submitted without one ever being opened, who has
            nothing to track with.
          */
          completionHref={liveToken ? `/track/${liveToken}` : null}
          submitLabel="Submit my answers"
        />
      </UploadTargetProvider>
    </>
  );
}
