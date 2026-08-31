'use client';

import { useState } from 'react';
import {
  ServiceDesigner, type DesignerResource,
} from '@/components/designer/service-designer';
import type { FormSchema } from '@/types/form-schema';
import { publishFormVersion } from './actions';

export function DesignerClient({
  serviceId, serviceName, currentVersion, slug, schema, resources = [],
}: {
  serviceId: string;
  serviceName: string;
  currentVersion: number;
  slug: string;
  schema: FormSchema;
  /** What a "Links and leaflets" block can choose between. */
  resources?: DesignerResource[];
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
        <div role="alert" className="border-b border-stop-200 bg-stop-50 px-5 py-2.5 text-[13.5px] text-stop-700">
          {error}
        </div>
      ) : null}
      {/*
        The version used to be glued onto the name — "Flu Vaccination ·
        currently v4" — which read as part of the service's title. It is now a
        separate chip, so the heading is the service and the version is state.
      */}
      <ServiceDesigner
        initialSchema={schema}
        serviceName={serviceName}
        currentVersion={currentVersion}
        previewHref={`/services/${slug}/preview`}
        resources={resources}
        resourcesHref={`/services/${slug}/resources`}
        onPublish={handlePublish}
      />
    </>
  );
}
