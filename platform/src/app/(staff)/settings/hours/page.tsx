import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getOpeningHours } from './actions';
import { OpeningHoursEditor } from './hours-editor';

export const dynamic = 'force-dynamic';

export default async function OpeningHoursPage() {
  const data = await getOpeningHours();

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} /> Settings
      </Link>

      <h1 className="text-[28px] leading-tight text-ink">Opening hours</h1>
      <p className="mb-6 mt-1 text-[14px] text-ink-faint">
        Every bookable slot comes from these windows. Times are Isle of Man local
        and stay correct through the clock change.
      </p>

      {!data.ok || !data.windows || !data.branches || !data.services ? (
        <div className="rounded-[10px] border border-stop-200 bg-stop-50 px-4 py-3 text-[13.5px] text-stop-700">
          {data.error ?? 'Could not load opening hours.'}
        </div>
      ) : (
        <OpeningHoursEditor
          windows={data.windows}
          branches={data.branches}
          services={data.services}
        />
      )}
    </div>
  );
}
