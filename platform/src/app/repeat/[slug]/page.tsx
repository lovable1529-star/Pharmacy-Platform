/**
 * Start a repeat request — the public entry point for §4.2.
 *
 * Two fields, no account, no password. A patient on repeat care has a Repeat
 * Care ID on their paperwork and the email address we already hold, and that
 * pair is what opens the questionnaire.
 */

import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { service } from '@/lib/db/schema';
import { RepeatAccessForm } from './access-form';

export const dynamic = 'force-dynamic';

export default async function RepeatEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [svc] = await db
    .select({ name: service.name, slug: service.slug, description: service.description })
    .from(service)
    .where(and(eq(service.slug, slug)))
    .limit(1);

  if (!svc) notFound();

  return <RepeatAccessForm slug={svc.slug} serviceName={svc.name} />;
}
