/**
 * Services.
 *
 * The object that makes the platform generic. A service is a name, a price, a
 * published form version and — optionally — a published ruleset. Adding COVID
 * vaccination or travel health is configuration from here, not a development
 * project.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * Each service is now a card that lifts on hover, because the whole row is a
 * destination — this is a chooser, not a table of facts. The local `Tag` this
 * file used to define was one of four near-identical copies scattered across
 * the app; it now uses the shared one, which is why the tag colours here match
 * the ones on Inventory and Repeat care for the first time.
 */

import Link from 'next/link';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { PencilLine, Scale, Eye } from 'lucide-react';
import { NewServiceButton } from './new-service-button';
import { ServiceActionsMenu } from './service-actions-menu';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import { service, formVersion, rulesetVersion } from '@/lib/db/schema';
import { formatMoney } from '@/lib/units';
import type { FormSchema } from '@/types/form-schema';
import { EmptyState, PageHeader, Panel, Tag } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const { actor } = await getStaffContext();
  const editable = can(actor, 'services:edit');
  // Separate from editing on purpose. Authoring a form and withdrawing a
  // service are different acts, and the permission grid already distinguishes
  // them — a technician who may edit wording should not be able to take a
  // service off the shelf.
  const removable = can(actor, 'services:delete');

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
    <div className="page-shell mx-auto max-w-[calc(1000px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Services"
        subtitle="Each one is a form you control. Editing publishes a new version and leaves everything already answered untouched."
        actions={
          editable ? (
            <NewServiceButton
              services={rows.map((r) => ({
                id: r.id,
                name: r.name,
                hasRules: r.rulesetVersion !== null,
              }))}
            />
          ) : null
        }
      />

      <div className="grid gap-3">
        {rows.map((row) => {
          const schema = row.formSchema as unknown as FormSchema | null;
          const steps = schema?.steps.length ?? 0;
          const questions = schema?.steps.reduce((n, s) => n + s.fields.length, 0) ?? 0;

          return (
            <Panel
              key={row.id}
              className="px-5 py-[17px] transition-[border-color,box-shadow] hover:border-brand-200 hover:shadow-lift"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] font-semibold text-ink">{row.name}</h2>
                  {row.description ? (
                    <p className="mt-0.5 text-[13.5px] text-ink-faint">{row.description}</p>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Tag tone="neutral">{row.kind.toLowerCase().replace('_', ' ')}</Tag>
                    {row.formVersion !== null ? (
                      <Tag tone="neutral">form v{row.formVersion}</Tag>
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
                  {/* Preview, not the live form. Checking the wording should not
                      mean completing every mandatory field and leaving a real
                      submission behind. */}
                  <Link
                    href={`/services/${row.slug}/preview`}
                    className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-[7px] text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
                  >
                    <Eye size={13} strokeWidth={2} />
                    Preview
                  </Link>
                  {editable ? (
                    <Link
                      href={`/services/${row.slug}/designer`}
                      className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      <PencilLine size={13} strokeWidth={2.2} />
                      Edit form
                    </Link>
                  ) : null}
                  {removable ? (
                    <ServiceActionsMenu serviceId={row.id} serviceName={row.name} />
                  ) : null}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            title="No services yet"
            body="Run the seed scripts to load the flu and weight management services."
          />
        </Panel>
      ) : null}
    </div>
  );
}
