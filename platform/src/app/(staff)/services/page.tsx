/**
 * Services.
 *
 * The object that makes the platform generic. A service is a name, a price, a
 * published form version and — optionally — a published ruleset. Adding COVID
 * vaccination or travel health is configuration from here, not a development
 * project.
 */

import Link from 'next/link';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { PencilLine, ExternalLink, Scale } from 'lucide-react';
import { NewServiceButton } from './new-service-button';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import { service, formVersion, rulesetVersion } from '@/lib/db/schema';
import { formatMoney } from '@/lib/units';
import type { FormSchema } from '@/types/form-schema';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const { actor } = await getStaffContext();
  const editable = can(actor, 'services:edit');

  const rows = await db
    .select({
      id: service.id,
      name: service.name,
      slug: service.slug,
      kind: service.kind,
      description: service.description,
      priceMinor: service.priceMinor,
      formVersion: formVersion.version,
      formSchema: formVersion.schema,
      rulesetVersion: rulesetVersion.version,
    })
    .from(service)
    .leftJoin(formVersion, eq(service.publishedFormVersionId, formVersion.id))
    .leftJoin(rulesetVersion, eq(service.publishedRulesetVersionId, rulesetVersion.id))
    .where(and(eq(service.organisationId, actor.organisationId), isNull(service.archivedAt)))
    .orderBy(desc(service.createdAt));

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight text-ink">Services</h1>
          <p className="mt-1 text-[14px] text-ink-faint">
            Each one is a form you control. Editing publishes a new version and leaves everything
            already answered untouched.
          </p>
        </div>
        {editable ? (
          <NewServiceButton
            services={rows.map((r) => ({
              id: r.id,
              name: r.name,
              hasRules: r.rulesetVersion !== null,
            }))}
          />
        ) : null}
      </div>

      <div className="grid gap-3">
        {rows.map((row) => {
          const schema = row.formSchema as unknown as FormSchema | null;
          const steps = schema?.steps.length ?? 0;
          const questions = schema?.steps.reduce((n, s) => n + s.fields.length, 0) ?? 0;

          return (
            <div key={row.id} className="rounded-[10px] border border-line bg-surface px-5 py-4">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] font-semibold text-ink">{row.name}</h2>
                  {row.description ? (
                    <p className="mt-0.5 text-[13.5px] text-ink-faint">{row.description}</p>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Tag>{row.kind.toLowerCase().replace('_', ' ')}</Tag>
                    {row.formVersion !== null ? (
                      <Tag>form v{row.formVersion}</Tag>
                    ) : (
                      <Tag tone="review">no published form</Tag>
                    )}
                    {row.rulesetVersion !== null ? (
                      <Tag tone="brand">
                        <Scale size={10} strokeWidth={2.2} /> rules v{row.rulesetVersion}
                      </Tag>
                    ) : null}
                    <span className="tabular font-mono text-[11.5px] text-ink-faint">
                      {steps} steps · {questions} questions
                    </span>
                    {row.priceMinor !== null ? (
                      <span className="tabular font-mono text-[11.5px] text-ink-faint">
                        {formatMoney(row.priceMinor)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/f/${row.slug}`}
                    target="_blank"
                    className="flex items-center gap-1.5 rounded-[7px] border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
                  >
                    <ExternalLink size={13} strokeWidth={2} />
                    Patient view
                  </Link>
                  {editable ? (
                    <Link
                      href={`/services/${row.slug}/designer`}
                      className="flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      <PencilLine size={13} strokeWidth={2.2} />
                      Edit form
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-ink">No services yet</p>
          <p className="mt-1 text-[13.5px] text-ink-faint">
            Run the seed scripts to load the flu and weight management services.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Tag({
  children, tone,
}: { children: React.ReactNode; tone?: 'review' | 'brand' }) {
  const styles =
    tone === 'review'
      ? 'bg-review-100 text-review-700'
      : tone === 'brand'
        ? 'bg-brand-100 text-brand-700'
        : 'bg-sunk text-ink-faint';

  return (
    <span
      className={`flex items-center gap-1 rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${styles}`}
    >
      {children}
    </span>
  );
}
