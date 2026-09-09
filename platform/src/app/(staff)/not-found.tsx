/**
 * A staff screen that asked for something that is not there.
 *
 * Ten pages call notFound() — a consultation id that does not exist, a service
 * slug that was archived, a patient another branch removed. Without this they
 * all produced Next.js's bare 404, rendered outside the shell with no
 * navigation on it, which reads like the application has fallen over rather
 * than like a record having moved.
 *
 * Inside the (staff) group, so the shell stays and the person can carry on.
 */

import Link from 'next/link';
import { FileQuestion, ArrowLeft } from 'lucide-react';

export default function StaffNotFound() {
  return (
    <div className="page-shell mx-auto max-w-[620px] animate-rise px-7 pb-11 pt-16">
      <div className="rounded-panel border border-line bg-surface p-7 shadow-panel">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <FileQuestion size={19} strokeWidth={1.9} />
        </div>

        <h1 className="mb-2 text-[21px] leading-tight text-ink">That record is not here</h1>
        <p className="text-[14px] leading-relaxed text-ink-soft">
          It may have been archived, or it may belong to another organisation.
          Nothing has been deleted — clinical records are never removed, only
          archived, so if you expected to find something here it is worth asking
          an administrator rather than re-entering it.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <ArrowLeft size={14} strokeWidth={2.2} />
            Back to Today
          </Link>
          <Link
            href="/patients"
            className="rounded-control border border-line px-4 py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:border-brand-200 hover:text-brand-700"
          >
            Find a patient
          </Link>
        </div>
      </div>
    </div>
  );
}
