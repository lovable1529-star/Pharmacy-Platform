'use client';

/**
 * Patient-facing form.
 *
 * The same `FormRenderer` the Service Designer previews. There is no separate
 * patient build — what the client sees while editing is literally what a patient
 * gets.
 */

import { use, useState } from 'react';
import { FormRenderer } from '@/components/form-runtime/form-renderer';
import { SERVICES } from '@/lib/demo/data';

export default function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const service = SERVICES.find((s) => s.slug === slug);
  const [done, setDone] = useState(false);

  if (!service) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="mb-2 text-xl">Form not found</h1>
        <p className="text-sm text-ink-soft">Check the link and try again.</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-brand-900 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-clinical-green-600 to-brand-600 font-display text-sm font-bold">
            K
          </div>
          <div>
            <div className="font-display text-sm font-bold">Karsons Pharmacy</div>
            <div className="text-[11px] text-brand-300">{service.name}</div>
          </div>
        </div>
      </header>

      <main className="px-4 py-8">
        {done ? (
          <div className="mx-auto max-w-lg rounded-card border border-line bg-surface p-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-clinical-green-100 text-clinical-green-700">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="mb-2 text-xl">Thank you</h1>
            <p className="text-sm text-ink-soft">
              Your answers have been sent to the pharmacy. Your clinician will review them before
              your appointment. Please bring photo ID with you.
            </p>
          </div>
        ) : (
          <FormRenderer schema={service.patientForm} onSubmit={() => setDone(true)} />
        )}
      </main>
    </div>
  );
}
