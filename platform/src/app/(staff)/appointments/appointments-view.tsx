'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, Loader2, FileText, UserCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { markArrived } from './actions';

export interface AppointmentRow {
  id: string;
  reference: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  bookedName: string;
  bookedEmail: string | null;
  bookedPhone: string | null;
  serviceName: string;
  submissionId: string | null;
  patientFirstName: string | null;
  patientLastName: string | null;
}

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}

function time(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}

export function AppointmentsView({
  rows, branchName,
}: { rows: AppointmentRow[]; branchName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const days = rows.reduce<Map<string, AppointmentRow[]>>((map, row) => {
    const key = dayKey(row.startsAt);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
    return map;
  }, new Map());

  async function arrive(id: string) {
    setBusy(id);
    await markArrived(id);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight text-ink">Appointments</h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          The next two weeks at {branchName}. One calendar across every service.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-14 text-center">
          <Calendar size={26} strokeWidth={1.6} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-[15px] font-medium text-ink">Nothing booked</p>
          <p className="mt-1 text-[13.5px] text-ink-faint">
            Bookings made at{' '}
            <Link href="/book" className="text-brand-700 underline">/book</Link>{' '}
            appear here. If patients cannot find a slot, add opening hours in Settings.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {[...days.entries()].map(([day, list]) => (
            <section
              key={day}
              className="overflow-hidden rounded-[10px] border border-line bg-surface"
            >
              <div className="border-b border-line bg-sunk px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                {day} · {list.length} appointment{list.length === 1 ? '' : 's'}
              </div>

              {list.map((row) => {
                const name = row.patientFirstName
                  ? `${row.patientFirstName} ${row.patientLastName}`
                  : row.bookedName;

                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0"
                  >
                    <span className="tabular w-[46px] shrink-0 font-mono text-[13px] font-medium text-ink-soft">
                      {time(row.startsAt)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-ink">
                        {name}
                      </span>
                      <span className="block truncate text-[12.5px] text-ink-faint">
                        {row.serviceName} · {row.reference}
                        {row.submissionId ? ' · form completed' : ' · form not completed'}
                      </span>
                    </span>

                    {row.status === 'COMPLETED' ? (
                      <span className="rounded-[5px] bg-safe-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-safe-700">
                        Done
                      </span>
                    ) : row.status === 'ARRIVED' ? (
                      row.submissionId ? (
                        <Link
                          href={`/consultations/${row.submissionId}`}
                          className="rounded-[6px] bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
                        >
                          Start
                        </Link>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-[6px] bg-review-100 px-2.5 py-1 font-mono text-[10.5px] uppercase text-review-700">
                          <FileText size={11} strokeWidth={2.2} /> No form yet
                        </span>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => arrive(row.id)}
                        disabled={busy === row.id}
                        className={cn(
                          'flex items-center gap-1.5 rounded-[6px] border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink',
                          busy === row.id && 'opacity-60',
                        )}
                      >
                        {busy === row.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <UserCheck size={12} strokeWidth={2.2} />
                        )}
                        Arrived
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
