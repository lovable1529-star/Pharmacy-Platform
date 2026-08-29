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

  /*
   * Two stages, reported separately.
   *
   * Without this the route threw straight into the platform and the browser got
   * a bare 500 with nothing on it. Diagnosing the last one meant pulling Vercel
   * runtime logs to find a MODULE_NOT_FOUND for a pdfkit font that file tracing
   * had never included — a one-line cause that took a log dive to see.
   *
   * The stage matters because the two fail for completely different reasons:
   * `build` is data, `render` is the PDF engine and what it can reach on disk.
   * Knowing which one it was is most of the diagnosis.
   */
  let data;
  try {
    data = await buildPrescriptionData(actor.organisationId, id);
  } catch (error) {
    console.error(`consultation pdf: building data failed for ${id}`, error);
    return NextResponse.json(
      { error: 'Could not assemble this consultation.', stage: 'build' },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: 'Consultation not found.' }, { status: 404 });
  }

  let buffer;
  try {
    buffer = await renderToBuffer(PrescriptionDocument({ data }));
  } catch (error) {
    console.error(`consultation pdf: rendering failed for ${id}`, error);
    return NextResponse.json(
      { error: 'Could not produce the PDF.', stage: 'render' },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.prescriptionNumber}.pdf"`,
      // Never cached — it contains patient data and shared caches must not hold it.
      'Cache-Control': 'private, no-store',
    },
  });
}
