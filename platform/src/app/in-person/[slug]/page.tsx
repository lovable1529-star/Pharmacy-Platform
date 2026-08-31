/**
 * The face-to-face placeholder.
 *
 * A patient who says they would rather be seen in person is stopped on the
 * online form, and until now the form stopped them without telling them where
 * to go. This is where that link lands.
 *
 * Everything below is placeholder copy, and says so on the page. Karsons runs
 * the in-person weight management programme themselves and will either give us
 * their own page to point at or ask for this one to be written properly; a
 * page that invented opening hours and prices would be worse than one that
 * admits it is a stand-in.
 *
 * The pharmacy can repoint this at their own site at any time from
 * Services → Resources, and the form follows without a deployment. This page
 * stays as the fallback for a service that has not set one.
 */

import Link from 'next/link';
import { eq, and, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ArrowLeft, Phone, MapPin, CalendarDays } from 'lucide-react';
import { db } from '@/lib/db/client';
import { service, organisation } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function InPersonPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const [row] = await db
    .select({
      serviceName: service.name,
      organisationName: organisation.name,
    })
    .from(service)
    .innerJoin(organisation, eq(service.organisationId, organisation.id))
    .where(and(eq(service.slug, slug), isNull(service.archivedAt)))
    .limit(1);

  if (!row) notFound();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[720px] items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 font-display text-[14px] font-bold text-white">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-ink">
              {row.organisationName}
            </div>
            <div className="text-[12.5px] text-ink-faint">Seen in person</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-5 py-10">
        {/*
          Said first, plainly, and not dressed up as a finished page. Somebody
          testing this needs to know at a glance that the details below are not
          real, and a patient who somehow reaches it should not ring a number
          that nobody answers.
        */}
        <div className="mb-7 rounded-panel border border-review-200 bg-review-50 px-4 py-3.5 text-[13.5px] leading-[1.5] text-review-700">
          <strong className="font-semibold">This is a placeholder page.</strong>{' '}
          The pharmacy has not yet given us the details of its face-to-face
          programme, so nothing below is real. Once they do, this link points at
          their own page instead and nobody sees this.
        </div>

        <h1 className="text-[30px] leading-[1.15] text-ink">
          Weight management, in person
        </h1>

        <p className="mt-3 max-w-[62ch] text-[15.5px] leading-[1.6] text-ink-soft">
          You told us you would rather be seen face to face. {row.organisationName}{' '}
          runs an in-person weight management programme alongside the online
          service you were filling in, and you can join that instead.
        </p>

        <p className="mt-3 max-w-[62ch] text-[15.5px] leading-[1.6] text-ink-soft">
          It is a different programme from the online one: you are seen at the
          pharmacy, weighed and measured there, and reviewed in person at each
          visit. The medicines available and the price may differ.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { icon: CalendarDays, label: 'Appointments', value: 'Placeholder — days and times to be confirmed' },
            { icon: MapPin, label: 'Where', value: 'Placeholder — branch to be confirmed' },
            { icon: Phone, label: 'To book', value: 'Placeholder — number to be confirmed' },
          ].map((card) => (
            <div key={card.label} className="rounded-panel border border-line bg-surface px-4 py-3.5">
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                <card.icon size={12} strokeWidth={2} />
                {card.label}
              </div>
              <p className="mt-1.5 text-[13.5px] leading-[1.45] text-ink-soft">{card.value}</p>
            </div>
          ))}
        </div>

        {/*
          A way back. Somebody who clicked this to read about the alternative
          and decided against it should not have to use the browser's back
          button to find the form they had half filled in — their answers are
          still saved against it.
        */}
        <div className="mt-9 border-t border-line pt-6">
          <Link
            href={`/f/${slug}`}
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brand-700 transition-colors hover:text-brand-800"
          >
            <ArrowLeft size={15} strokeWidth={2.2} />
            Back to the online form
          </Link>
          <p className="mt-1.5 text-[13px] text-ink-faint">
            Your answers were saved as you went, so nothing is lost.
          </p>
        </div>
      </main>
    </div>
  );
}
