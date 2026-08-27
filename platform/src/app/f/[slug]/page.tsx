/**
 * The public patient form.
 *
 * This is the page a patient reaches from a link on the pharmacy website, a QR
 * code on the counter, or a tablet in the consultation room. No account, no
 * password — a health questionnaire should not require registration.
 *
 * The schema is read from the PUBLISHED version, so editing a form in the
 * Service Designer never changes what a patient is currently filling in.
 */

import { eq, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { service, formVersion, organisation } from '@/lib/db/schema';
import type { FormSchema } from '@/types/form-schema';
import { PublicForm } from './form-client';

export const dynamic = 'force-dynamic';

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const rows = await db
    .select({
      serviceName: service.name,
      description: service.description,
      organisationName: organisation.name,
      schema: formVersion.schema,
      version: formVersion.version,
    })
    .from(service)
    .innerJoin(organisation, eq(service.organisationId, organisation.id))
    .innerJoin(formVersion, eq(service.publishedFormVersionId, formVersion.id))
    .where(and(eq(service.slug, slug)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const schema = row.schema as unknown as FormSchema;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1000px] items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-brand-600 font-display text-[14px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-ink">
              {row.organisationName}
            </div>
            <div className="text-[12.5px] text-ink-faint">{row.serviceName}</div>
          </div>
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
            v{row.version}
          </span>
        </div>
      </header>

      <PublicForm slug={slug} schema={schema} />

      <footer className="mx-auto max-w-[1000px] px-5 pb-12 text-center">
        <p className="text-[12.5px] text-ink-faint">
          Your answers are stored securely and shared only with your GP practice, in line with
          data protection law.
        </p>
      </footer>
    </div>
  );
}
