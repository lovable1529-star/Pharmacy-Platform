'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ServiceDesigner } from '@/components/form-builder/service-designer';
import { SERVICES } from '@/lib/demo/data';
import type { FormSchema } from '@/types/form-schema';

const BLANK: FormSchema = {
  schemaVersion: 1,
  title: 'New service',
  numberQuestions: true,
  steps: [{ id: 'step_1', title: 'About you', fields: [] }],
};

export default function DesignerPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-ink-soft">Loading…</div>}>
      <Designer />
    </Suspense>
  );
}

function Designer() {
  const search = useSearchParams();
  const serviceId = search?.get('service');
  const service = SERVICES.find((s) => s.id === serviceId);

  const [published, setPublished] = useState<number | null>(null);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">{service ? service.name : 'New service'}</h1>
          <p className="text-sm text-ink-soft">
            Build the form your patients fill in. The preview on the right is exactly what they see.
          </p>
        </div>
        {published !== null && (
          <p role="status" className="rounded-full bg-clinical-green-100 px-4 py-2 text-sm font-semibold text-clinical-green-700">
            Published as version {published}
          </p>
        )}
      </div>

      <ServiceDesigner
        initialSchema={service?.patientForm ?? BLANK}
        onPublish={() => setPublished((service?.version ?? 0) + 1)}
      />
    </div>
  );
}
