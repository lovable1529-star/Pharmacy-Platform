'use client';

import Link from 'next/link';
import { useShell } from '@/components/shell/shell-provider';
import { CONSULTATIONS, patientName } from '@/lib/demo/data';

export default function ConsultationsPage() {
  const { branchId, branchName } = useShell();
  const consultations = CONSULTATIONS.filter((c) => c.branchId === branchId).slice(0, 30);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl">Consultations</h1>
      <p className="mb-6 text-sm text-ink-soft">{branchName} · most recent first</p>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Patient</th>
              <th className="px-4 py-3 font-semibold">Service</th>
              <th className="px-4 py-3 font-semibold">Pharmacist</th>
              <th className="px-4 py-3 font-semibold">Batch</th>
              <th className="px-4 py-3 font-semibold">Funding</th>
              <th className="px-4 py-3 font-semibold">GP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {consultations.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <Link href={`/patients/${c.patientId}`} className="font-semibold text-brand-600">
                    {patientName(c.patientId)}
                  </Link>
                  <div className="text-xs text-ink-soft">
                    {c.completedAt.toLocaleDateString('en-GB')} {c.completedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </td>
                <td className="px-4 py-3">{c.serviceName}</td>
                <td className="px-4 py-3">{c.clinicianName}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.batchNumber}</td>
                <td className="px-4 py-3">{c.fundingType}</td>
                <td className="px-4 py-3">
                  {c.gpNotified ? (
                    <span className="text-clinical-green-700">Sent</span>
                  ) : (
                    <span className="text-ink-soft">Tonight</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
