'use client';

/**
 * The per-service actions that need browser state.
 *
 * Only Remove for now. It lives in its own client component so the services
 * list itself stays a server component — the page is a read of four tables and
 * has no business shipping a bundle just to hold one dialog open.
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ArchiveServiceDialog } from './archive-dialog';

export function ServiceActionsMenu({
  serviceId, serviceName,
}: {
  serviceId: string;
  serviceName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      {/*
        Quiet until hovered. Removing a service is rare and irreversible from
        the list's point of view, so it should not compete for attention with
        Edit form — which is what somebody is almost always here to do.
      */}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${serviceName}`}
        title="Remove this service"
        className="flex h-[32px] w-[32px] items-center justify-center rounded-control border border-line text-ink-faint transition-colors hover:border-stop-200 hover:text-stop-700"
      >
        <Trash2 size={13} strokeWidth={2} />
      </button>

      {confirming ? (
        <ArchiveServiceDialog
          serviceId={serviceId}
          serviceName={serviceName}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
