'use client';

/**
 * Where an upload is allowed to go.
 *
 * Supplied by whoever is rendering the form rather than threaded through every
 * field, because a control three levels deep should not have to know how the
 * page authenticated.
 *
 * Two shapes, matching the two ways a form gets filled in:
 *
 *   token         a patient on their own device, holding the resume link
 *   submissionId  a member of staff on the counter tablet, already signed in
 *
 * Neither is trusted by the endpoint. The token is re-checked against the
 * database and the staff session against the actor's permissions — this only
 * decides which credential the browser presents.
 */

import { createContext, useContext } from 'react';
import type { StoredFileRef } from './stored-file';

interface UploadTarget {
  token?: string | null;
  submissionId?: string | null;
  /**
   * Open a draft and return its token, for a form that does not have one yet.
   *
   * A patient arriving cold at the public form has no token until they have
   * typed something. If their first act is to attach a photo of their ID, the
   * upload has to be able to ask for one rather than refuse.
   */
  onNeedToken?: () => Promise<string | null>;
}

const UploadContext = createContext<UploadTarget>({});

export function UploadTargetProvider({
  value,
  children,
}: {
  value: UploadTarget;
  children: React.ReactNode;
}) {
  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUploadTarget(): UploadTarget {
  return useContext(UploadContext);
}

/**
 * Whether uploading is possible at all here.
 *
 * True where a draft can be opened on demand as well as where one already
 * exists — otherwise the control refuses before it has tried.
 */
export function canUpload(target: UploadTarget): boolean {
  return Boolean(target.token || target.submissionId || target.onNeedToken);
}

export async function uploadFile(
  target: UploadTarget,
  fieldId: string,
  file: File,
): Promise<{ ok: true; file: StoredFileRef } | { ok: false; error: string }> {
  /*
   * Open a draft first where there is not one yet. A patient whose first act
   * on the public form is attaching a photo of their ID must not be told the
   * form cannot take attachments.
   */
  let token = target.token ?? null;
  if (!token && !target.submissionId && target.onNeedToken) {
    token = await target.onNeedToken();
    if (!token) {
      return { ok: false, error: 'We could not start your form. Please reload and try again.' };
    }
  }

  const body = new FormData();
  body.append('file', file);
  body.append('fieldId', fieldId);
  if (token) body.append('token', token);
  else if (target.submissionId) body.append('submissionId', target.submissionId);

  let response: Response;
  try {
    response = await fetch('/api/uploads', { method: 'POST', body });
  } catch {
    return { ok: false, error: 'No connection. Check your signal and try again.' };
  }

  let payload: { file?: StoredFileRef; error?: string } = {};
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: 'That upload did not complete. Please try again.' };
  }

  if (!response.ok || !payload.file) {
    return { ok: false, error: payload.error ?? 'That upload did not complete.' };
  }

  return { ok: true, file: payload.file };
}
