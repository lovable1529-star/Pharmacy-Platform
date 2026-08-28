/**
 * Viewing a patient's uploaded file.
 *
 * Staff only, and never a public URL. The bucket is private; this issues a
 * signed link that lives about five minutes and redirects to it, so a URL
 * copied out of the address bar and pasted into an email stops working almost
 * immediately.
 *
 * The path is checked against a submission the caller's organisation actually
 * owns before anything is signed. Without that, a path is just a string, and
 * signing whatever arrives would hand out every patient's documents to anyone
 * who could guess a UUID.
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { submission } from '@/lib/db/schema';
import { signDownload } from '@/lib/storage/uploads';
import { getActorOrNull } from '@/lib/auth/actor';
import { can } from '@/lib/tenancy/scope';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const actor = await getActorOrNull();
  if (!actor || !can(actor, 'consultations:view')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }

  const path = new URL(request.url).searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'No file requested.' }, { status: 400 });

  // Every object lives at `<submissionId>/<fieldId>/<name>`. Anything else is
  // not ours, and `..` never survives this shape.
  const segments = path.split('/');
  if (
    segments.length !== 3 ||
    segments.some((s) => s.length === 0 || s === '.' || s === '..')
  ) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }

  const [submissionId] = segments as [string, string, string];

  const [row] = await db
    .select({ id: submission.id })
    .from(submission)
    .where(
      and(
        eq(submission.id, submissionId),
        eq(submission.organisationId, actor.organisationId),
      ),
    )
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });

  const signed = await signDownload(path);
  if (!signed) {
    return NextResponse.json({ error: 'That file could not be opened.' }, { status: 502 });
  }

  return NextResponse.redirect(signed);
}
