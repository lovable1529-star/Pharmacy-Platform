'use client';

import { useState } from 'react';
import { ServiceDesigner } from '@/components/designer/service-designer';
import type { FormSchema } from '@/types/form-schema';
import { publishFormVersion } from './actions';

export function DesignerClient({
  serviceId, serviceName, currentVersion, schema,
}: {
  serviceId: string;
  serviceName: string;
  currentVersion: number;
  schema: FormSchema;
}) {
  const [error, setError] = useState<string | null>(null);

  async function handlePublish(next: FormSchema) {
    setError(null);
    const result = await publishFormVersion(serviceId, next);
    if (!result.ok) {
      setError(result.error ?? 'Could not publish.');
      throw new Error(result.error);
    }
  }

  return (
    <>
      {error ? (
        <div className="border-b border-stop-200 bg-stop-50 px-5 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}
      <ServiceDesigner
        initialSchema={schema}
        serviceName={`${serviceName} · currently v${currentVersion}`}
        onPublish={handlePublish}
      />
    </>
  );
}
