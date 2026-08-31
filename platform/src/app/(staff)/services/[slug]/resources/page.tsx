/**
 * The material a patient is shown, per service.
 *
 * These are the leaflets, videos and policy links the client wants in front of
 * a patient — how to inject, what to do about nausea, how to dispose of a
 * needle. They sit here rather than in the questionnaire because they change
 * for clinical reasons and change often: editing one should not republish a
 * form and split the answer history of every unrelated question on it.
 *
 * The screen is a server component that reads and hands off; all the editing
 * state lives in the client below it.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getServiceResources } from './actions';
import { ResourcesClient } from './resources-client';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { PageHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function ServiceResourcesPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { actor } = await getStaffContext();
  const view = await getServiceResources(slug);

  if (!view) notFound();

  return (
    <div className="page-shell mx-auto max-w-[calc(940px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/services"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft size={13} strokeWidth={2.2} />
        Services
      </Link>

      <PageHeader
        title="Patient resources"
        subtitle={`Leaflets and links shown to patients using ${view.serviceName}. Changing one takes effect immediately — no form republish, and nothing already answered moves.`}
      />

      <ResourcesClient
        view={view}
        editable={can(actor, 'services:edit')}
        removable={can(actor, 'services:delete')}
      />
    </div>
  );
}
