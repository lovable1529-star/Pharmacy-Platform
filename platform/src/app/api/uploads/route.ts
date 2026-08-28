/**
 * Patient file uploads.
 *
 * Necessarily public, because a patient filling in a health questionnaire has
 * no account. That makes the authorisation rule the whole design:
 *
 *   · a resume token, which already scopes to exactly one submission — so an
 *     upload can only ever attach to that patient's own form, and holding a
 *     token gives you nothing you did not already have; or
 *   · an authenticated member of staff with `consultations:edit`, for a photo
 *     taken on the counter tablet.
 *
 * Everything else — size, real file type, generated object name — is enforced
 * in `storeUpload`, deliberately server-side, because every constraint a
 * browser applies is one the uploader can simply not apply.
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { submission } from '@/lib/db/schema';
import { isExpired } from '@/lib/forms/draft';
import { storeUpload, MAX_UPLOAD_BYTES } from '@/lib/storage/uploads';
import { getActorOrNull } from '@/lib/auth/actor';
import { can } from '@/lib/tenancy/scope';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const fieldId = form.get('fieldId');
  const token = form.get('token');
  const submissionIdRaw = form.get('submissionId');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
  }
  if (typeof fieldId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(fieldId)) {
    // The field id becomes part of the object path, so it is constrained to a
    // safe character set rather than sanitised after the fact.
    return NextResponse.json({ error: 'Unknown field.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That file is too large.' }, { status: 413 });
  }

  // ── Resolve which submission this belongs to ────────────
  let submissionId: string | null = null;

  if (typeof token === 'string' && token.length > 0) {
    const [draft] = await db
      .select({
        id: submission.id,
        status: submission.status,
        expiresAt: submission.resumeExpiresAt,
      })
      .from(submission)
      .where(eq(submission.resumeToken, token))
      .limit(1);

    // Deliberately one message for every failure. Distinguishing "no such
    // token" from "expired" would turn this into an oracle for guessing them.
    if (!draft || draft.status !== 'DRAFT' || isExpired(draft.expiresAt)) {
      return NextResponse.json({ error: 'That link is no longer valid.' }, { status: 403 });
    }
    submissionId = draft.id;
  } else if (typeof submissionIdRaw === 'string' && submissionIdRaw.length > 0) {
    const actor = await getActorOrNull();
    if (!actor || !can(actor, 'consultations:edit')) {
      return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
    }

    // Scoped to the actor's organisation, so a submission id from another
    // tenant is rejected rather than written to.
    const [row] = await db
      .select({ id: submission.id })
      .from(submission)
      .where(
        and(
          eq(submission.id, submissionIdRaw),
          eq(submission.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
    submissionId = row.id;
  }

  if (!submissionId) {
    return NextResponse.json({ error: 'That link is no longer valid.' }, { status: 403 });
  }

  const result = await storeUpload({ submissionId, fieldId, file });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ file: result.file });
}
