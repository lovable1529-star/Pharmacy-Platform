/**
 * What a service costs, and how it looks to a patient.
 *
 * Neither could be changed without a database script before this. The price
 * was the one that mattered: both weight-management services had none, and a
 * prescription raised from a priceless service stranded at PENDING_PAYMENT
 * forever because there was nothing to charge and so nothing ever settled it.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getServiceSettings } from './actions';
import { SettingsClient } from './settings-client';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { PageHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function ServiceSettingsPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { actor } = await getStaffContext();
  const view = await getServiceSettings(slug);

  if (!view) notFound();

  return (
    <div className="page-shell mx-auto max-w-[calc(880px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <Link
        href="/services"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft size={13} strokeWidth={2.2} />
        Services
      </Link>

      <PageHeader
        title="Service settings"
        subtitle={`What ${view.serviceName} costs, and how it looks to a patient.`}
      />

      <SettingsClient view={view} editable={can(actor, 'services:edit')} slug={slug} />
    </div>
  );
}
