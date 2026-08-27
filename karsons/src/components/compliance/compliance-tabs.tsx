'use client';

/**
 * Compliance centre — interactive shell.
 *
 * The audit chain is sealed and verified on the server, because `sealAuditEntry`
 * uses `node:crypto` and is server-only by design. Both the intact and tampered
 * verification results are computed there and passed in, so the "simulate
 * tampering" demonstration stays instant without shipping hashing to the browser.
 */

import { useState } from 'react';

type Tab = 'audit' | 'consent' | 'dsar' | 'retention';

export interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  hash: string;
}

export interface ConsentRow {
  patientName: string;
  consent: string;
  version: string;
  recordedAt: string;
}

export interface VerificationResult {
  valid: boolean;
  brokenAt: number | null;
  reason?: string;
  entryCount: number;
}

export function ComplianceTabs({
  auditRows,
  consentRows,
  intact,
  tamperedResult,
  patientNames,
}: {
  auditRows: AuditRow[];
  consentRows: ConsentRow[];
  intact: VerificationResult;
  tamperedResult: VerificationResult;
  patientNames: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<Tab>('audit');
  const [tampered, setTampered] = useState(false);

  const verification = tampered ? tamperedResult : intact;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'audit', label: 'Audit trail' },
    { id: 'consent', label: 'Consent register' },
    { id: 'dsar', label: 'Data requests' },
    { id: 'retention', label: 'Retention' },
  ];

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              tab === item.id ? 'bg-brand-600 text-white' : 'border border-line bg-surface'
            }`}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'audit' && (
        <div>
          <div className={`mb-4 rounded-card border p-4 ${
            verification.valid
              ? 'border-clinical-green-600 bg-clinical-green-100'
              : 'border-triage-red-700 bg-triage-red-100'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`font-semibold ${verification.valid ? 'text-clinical-green-700' : 'text-triage-red-700'}`}>
                  {verification.valid
                    ? `Chain intact — ${verification.entryCount} entries verified`
                    : `Chain broken at entry ${verification.brokenAt}`}
                </p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {verification.valid
                    ? 'Every entry matches its hash and links correctly to the one before it.'
                    : verification.reason}
                </p>
              </div>
              <button type="button" onClick={() => setTampered((t) => !t)}
                className="flex-none rounded-full border border-line bg-surface px-4 py-2 text-xs font-semibold">
                {tampered ? 'Restore' : 'Simulate tampering'}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Record</th>
                  <th className="px-4 py-3 font-semibold">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {auditRows.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-soft">{entry.occurredAt}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{entry.action}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {entry.entityType} · {entry.entityId}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-ink-soft">
                      {entry.hash.slice(0, 12)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-ink-soft">
            Entries are append-only and hash-chained. Altering, deleting or reordering history breaks
            the chain and is detected by the nightly verification job.
          </p>
        </div>
      )}

      {tab === 'consent' && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Patient</th>
                <th className="px-4 py-3 font-semibold">Consent</th>
                <th className="px-4 py-3 font-semibold">Version</th>
                <th className="px-4 py-3 font-semibold">Recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {consentRows.map((row, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 font-semibold">{row.patientName}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{row.consent}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.version}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft">{row.recordedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-xs text-ink-soft">
            Consent text is versioned, so you can always prove exactly which wording a patient agreed
            to. Editing the wording creates a new version and never rewrites past records.
          </p>
        </div>
      )}

      {tab === 'dsar' && (
        <div>
          <div className="mb-4 rounded-card border border-line bg-surface p-5">
            <h2 className="mb-1 text-base">Log a data request</h2>
            <p className="mb-4 text-sm text-ink-soft">
              You have one calendar month to respond. The deadline is tracked automatically.
            </p>
            <div className="flex flex-wrap gap-3">
              <select className="flex-1 rounded-lg border border-line px-3 py-2.5" defaultValue="">
                <option value="">Select a patient</option>
                {patientNames.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="rounded-lg border border-line px-3 py-2.5" defaultValue="ACCESS">
                <option value="ACCESS">Access</option>
                <option value="ERASURE">Erasure</option>
                <option value="RECTIFICATION">Rectification</option>
                <option value="PORTABILITY">Portability</option>
              </select>
              <button type="button" className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">
                Log request
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">Requester</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  { name: 'Bridget Kelly', type: 'Access', days: 18, status: 'In progress' },
                  { name: 'Thomas Radcliffe', type: 'Erasure', days: 4, status: 'In progress' },
                  { name: 'Orla Christian', type: 'Access', days: -2, status: 'Completed' },
                ].map((request) => (
                  <tr key={request.name}>
                    <td className="px-4 py-2.5 font-semibold">{request.name}</td>
                    <td className="px-4 py-2.5">{request.type}</td>
                    <td className={`px-4 py-2.5 ${request.days <= 7 && request.days >= 0 ? 'font-semibold text-triage-amber-700' : 'text-ink-soft'}`}>
                      {request.days < 0 ? 'Closed' : `${request.days} days`}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{request.status}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                        Export data
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'retention' && (
        <div className="space-y-3">
          {[
            { entity: 'Consultations', months: 60, action: 'Remove personal details', due: 0 },
            { entity: 'Prescriptions', months: 24, action: 'Remove personal details', due: 0 },
            { entity: 'Form submissions', months: 60, action: 'Remove personal details', due: 0 },
            { entity: 'Message log', months: 24, action: 'Delete', due: 3 },
          ].map((policy) => (
            <div key={policy.entity}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
              <div>
                <p className="font-semibold">{policy.entity}</p>
                <p className="text-sm text-ink-soft">
                  Kept {policy.months} months, then: {policy.action.toLowerCase()}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                policy.due > 0 ? 'bg-triage-amber-100 text-triage-amber-700' : 'bg-canvas text-ink-soft'
              }`}>
                {policy.due > 0 ? `${policy.due} due for purge` : 'Nothing due'}
              </span>
            </div>
          ))}

          <p className="rounded-card border border-dashed border-brand-300 bg-brand-50 p-4 text-sm text-brand-700">
            Purging removes personal details while keeping the pseudonymised clinical record, so
            reporting and audit history survive. Purges run nightly and are themselves audited.
          </p>
        </div>
      )}
    </>
  );
}
