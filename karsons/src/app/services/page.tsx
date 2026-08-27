'use client';

/**
 * Services list.
 *
 * The Service Designer is reachable from here. This is the screen that proves
 * the platform is configurable rather than hard-coded — the client creates a
 * service, and it appears alongside the ones we shipped, with no distinction
 * between them.
 */

import Link from 'next/link';
import { SERVICES } from '@/lib/demo/data';
import { formatMoney } from '@/lib/units';

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl">Services</h1>
          <p className="text-sm text-ink-soft">
            Build and edit your own clinical services. No developer needed.
          </p>
        </div>
        <Link href="/services/designer"
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">
          New service
        </Link>
      </div>

      <ul className="space-y-3">
        {SERVICES.map((service) => (
          <li key={service.id}>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base">{service.name}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    service.active
                      ? 'bg-clinical-green-100 text-clinical-green-700'
                      : 'bg-canvas text-ink-soft'
                  }`}>
                    {service.active ? 'Live' : 'Draft'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {service.category}
                  {' · '}{service.priceMinor === 0 ? 'No charge' : formatMoney(service.priceMinor)}
                  {' · '}version {service.version}
                  {service.hasRuleset && ' · has clinical rules'}
                </p>
              </div>
              <div className="flex flex-none gap-2">
                {service.hasRuleset && (
                  <Link href="/repeat-care/rules"
                    className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
                    Rules
                  </Link>
                )}
                <Link href={`/services/designer?service=${service.id}`}
                  className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
                  Edit form
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-card border border-dashed border-brand-300 bg-brand-50 p-4 text-sm text-brand-700">
        Editing a form creates a new version. Anyone who has already filled it in keeps the version
        they answered, so your changes never rewrite history.
      </p>
    </div>
  );
}
