/**
 * Seeing a form without filling one in.
 *
 * "Patient view" used to open the live public form, which meant a colleague
 * checking whether the questions read correctly had to answer every mandatory
 * field and submit a real record to reach the end. That is not a preview, it is
 * a data-entry exercise that leaves rubbish in the database.
 *
 * This renders the same component the patient sees, in preview mode: every step
 * reachable in any order, nothing required, nothing saved — and the controls
 * still live, so the conditional questions that only appear when you answer
 * "yes" can actually be seen.
 */

import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Eye, ExternalLink, PencilLine } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { service, formVersion } from '@/lib/db/schema';
import type { FormSchema } from '@/types/form-schema';
import { FormPreview } from './form-preview';

export const dynamic = 'force-dynamic';

export default async function ServicePreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { actor } = await getStaffContext();

  const [row] = await db
    .select({
      name: service.name,
      slug: service.slug,
      description: service.description,
      schema: formVersion.schema,
      version: formVersion.version,
    })
    .from(service)
    .innerJoin(formVersion, eq(service.publishedFormVersionId, formVersion.id))
    .where(
      and(
        eq(service.slug, slug),
        eq(service.organisationId, actor.organisationId),
      ),
    )
    .limit(1);

  if (!row) {
    return (
      <div className="mx-auto max-w-[620px] px-6 py-20 text-center">
        <h1 className="mb-2 font-display text-[21px] text-ink">
          Nothing published yet
        </h1>
        <p className="text-[14.5px] text-ink-soft">
          This service has no published form, so there is nothing for a patient
          to see.{' '}
          <Link href={`/services/${slug}/designer`} className="text-brand-700 underline">
            Open the designer
          </Link>{' '}
          to build one.
        </p>
      </div>
    );
  }

  const schema = row.schema as unknown as FormSchema;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center gap-3 px-5 py-3.5">
          <Link
            href="/services"
            className="flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Services
          </Link>

          <span className="flex items-center gap-1.5 rounded-[6px] bg-brand-100 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-700">
            <Eye size={11} strokeWidth={2.4} />
            Preview
          </span>

          <span className="text-[14px] font-medium text-ink">{row.name}</span>
          <span className="font-mono text-[11.5px] text-ink-faint">v{row.version}</span>

          <div className="ml-auto flex gap-2">
            <Link
              href={`/services/${row.slug}/designer`}
              className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
            >
              <PencilLine size={13} strokeWidth={2.2} />
              Edit form
            </Link>
            <Link
              href={`/f/${row.slug}`}
              target="_blank"
              className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
            >
              <ExternalLink size={13} strokeWidth={2} />
              Open the live form
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1000px] px-5 pt-5">
        <p className="rounded-[9px] border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13.5px] text-brand-700">
          Every step is clickable and nothing is required. Answer anything you
          like to see the follow-up questions it opens — none of it is saved.
        </p>
      </div>

      <FormPreview schema={schema} />
    </div>
  );
}
