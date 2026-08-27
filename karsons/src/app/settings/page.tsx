'use client';

/**
 * Settings.
 *
 * Everything the client must be able to change without a developer: staff, GP
 * surgeries, products and branches. These are the tables that make the platform
 * self-serve rather than a bespoke build.
 */

import { useState } from 'react';
import { BATCHES, BRANCHES, COMPANIES, PHARMACISTS, SURGERIES } from '@/lib/demo/data';

type Tab = 'staff' | 'surgeries' | 'products' | 'structure';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('staff');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'staff', label: 'Staff' },
    { id: 'surgeries', label: 'GP surgeries' },
    { id: 'products', label: 'Products & batches' },
    { id: 'structure', label: 'Companies & branches' },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl">Settings</h1>
      <p className="mb-5 text-sm text-ink-soft">
        Everything here is yours to change. No developer needed.
      </p>

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

      {tab === 'staff' && (
        <section className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base">Pharmacists and staff</h2>
            <button type="button" className="rounded-full bg-brand-600 px-4 py-2 text-xs font-bold text-white">
              Add staff member
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left">
              <tr>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">GPhC number</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PHARMACISTS.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-semibold">{p.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{p.role.toLowerCase()}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.gphcNumber}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
            A pharmacist's GPhC number appears on every prescription they issue. Locum access can be
            given an end date so it expires without anyone remembering to revoke it.
          </p>
        </section>
      )}

      {tab === 'surgeries' && (
        <section className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base">GP surgeries ({SURGERIES.length})</h2>
            <button type="button" className="rounded-full bg-brand-600 px-4 py-2 text-xs font-bold text-white">
              Add surgery
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left">
              <tr>
                <th className="px-5 py-3 font-semibold">Surgery</th>
                <th className="px-5 py-3 font-semibold">Notification address</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SURGERIES.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-3 font-semibold">{s.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-soft">{s.email}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
            Get these right. A wrong-but-valid address will not bounce, so a surgery would silently
            never receive notifications.
          </p>
        </section>
      )}

      {tab === 'products' && (
        <section className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base">Products and batches</h2>
            <button type="button" className="rounded-full bg-brand-600 px-4 py-2 text-xs font-bold text-white">
              Add batch
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left">
              <tr>
                <th className="px-5 py-3 font-semibold">Product</th>
                <th className="px-5 py-3 font-semibold">Batch</th>
                <th className="px-5 py-3 font-semibold">Expiry</th>
                <th className="px-5 py-3 font-semibold">Allergens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {BATCHES.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3 font-semibold">{b.productName}</td>
                  <td className="px-5 py-3 font-mono text-xs">{b.batchNumber}</td>
                  <td className="px-5 py-3">{b.expiryDate.toLocaleDateString('en-GB')}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {b.allergens.length > 0 ? b.allergens.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
            Allergens recorded here are what the system cross-checks against a patient's allergies
            before administration.
          </p>
        </section>
      )}

      {tab === 'structure' && (
        <div className="space-y-4">
          {COMPANIES.map((company) => (
            <section key={company.id} className="rounded-card border border-line bg-surface p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base">{company.name}</h2>
                  <p className="text-sm text-ink-soft">GPhC premises {company.gphcNumber}</p>
                </div>
                <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                  Edit
                </button>
              </div>
              <ul className="space-y-1.5">
                {BRANCHES.filter((b) => b.companyId === company.id).map((branch) => (
                  <li key={branch.id}
                    className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="font-semibold">{branch.name}</span>
                    <span className="font-mono text-xs text-ink-soft">{branch.code}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <button type="button"
            className="w-full rounded-card border border-dashed border-brand-300 py-4 text-sm font-semibold text-brand-700">
            + Add another pharmacy company
          </button>

          <p className="rounded-card border border-dashed border-line p-4 text-xs text-ink-soft">
            A new pharmacy business becomes a company. A new shop under an existing business becomes
            a branch. Group settings apply automatically — only override what genuinely differs.
          </p>
        </div>
      )}
    </div>
  );
}
