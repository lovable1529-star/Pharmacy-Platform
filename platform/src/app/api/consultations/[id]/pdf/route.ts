/**
 * Consultation PDF.
 *
 * He asked for this directly: "Do we have the ability to print/save PDF, a copy
 * of the completed consultation form, so we can give/email it to the patient,
 * only if they request it?"
 *
 * Rendered with @react-pdf/renderer rather than HTML-to-PDF. Puppeteer does not
 * fit in a serverless function, and finding that out after building the whole
 * thing means standing up a separate service.
 *
 * Scope-checked before a byte is produced — this is a document containing a
 * patient's identifiers and clinical detail.
 */

import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getActorOrNull } from '@/lib/auth/actor';
import { can } from '@/lib/tenancy/scope';
import { buildPrescriptionData } from '@/lib/pdf/build';
import { PrescriptionDocument } from '@/lib/pdf/prescription';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActorOrNull();
  if (!actor) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!can(actor, 'consultations:view')) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }

  const { id } = await params;
  const data = await buildPrescriptionData(actor.organisationId, id);

  if (!data) {
    return NextResponse.json({ error: 'Consultation not found.' }, { status: 404 });
  }

  const buffer = await renderToBuffer(PrescriptionDocument({ data }));

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.prescriptionNumber}.pdf"`,
      // Never cached — it contains patient data and shared caches must not hold it.
      'Cache-Control': 'private, no-store',
    },
  });
}
