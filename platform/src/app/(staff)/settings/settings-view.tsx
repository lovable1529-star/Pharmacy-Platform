'use client';

import Link from 'next/link';

import { useState } from 'react';
import { Plus, Loader2, AlertTriangle, Clock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/units';
import { addBatch, addSurgery } from './actions';

interface Props {
  companies: { id: string; name: string; tradingName: string | null; gphcNumber: string | null }[];
  branches: {
    id: string; name: string; code: string; phone: string | null; inboxEmail: string | null;
    town: string | null; postcode: string | null; companyName: string;
  }[];
  clinicians: { id: string; fullName: string; gphcNumber: string }[];
  surgeries: { id: string; name: string; email: string }[];
  products: { id: string; name: string; category: string | null }[];
  batches: {
    id: string; batchNumber: string; expiryDate: string; productName: string;
    recalledAt: Date | null; quantity: number | null; branchName: string | null;
  }[];
  staff: {
    id: string; fullName: string; email: string; role: string | null;
    branchName: string | null; validTo: Date | null;
  }[];
  activeBranch: { id: string; name: string; companyId: string } | null;
}

const TABS = ['Locations', 'Pharmacists', 'GP surgeries', 'Stock', 'Staff'] as const;
type Tab = (typeof TABS)[number];

export function SettingsView(props: Props) {
  const [tab, setTab] = useState<Tab>('Locations');

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight text-ink">Settings</h1>
        <p className="mt-1 text-[14px] text-ink-faint">
          The reference data behind every dropdown in the system. Yours to maintain.
        </p>
      </div>

      <Link
        href="/settings/hours"
        className="mb-5 flex items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand-300"
      >
        <Clock size={17} strokeWidth={2} className="shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium text-ink">Opening hours</span>
          <span className="block text-[13px] text-ink-faint">
            When each branch takes appointments. Every bookable slot comes from here.
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-ink-faint" />
      </Link>

      <div className="mb-5 flex flex-wrap gap-1 rounded-[9px] bg-sunk p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-[6px] px-3.5 py-2 text-[13.5px] font-medium transition-colors',
              tab === t
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(25,20,40,0.10)]'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Locations' ? (
        <Card title="Companies and branches">
          {props.companies.map((c) => (
            <Row
              key={c.id}
              primary={c.tradingName ? `${c.name} (trading as ${c.tradingName})` : c.name}
              secondary={c.gphcNumber ? `GPhC premises ${c.gphcNumber}` : 'No GPhC premises number recorded'}
              tone={c.gphcNumber ? undefined : 'review'}
            />
          ))}
          {props.branches.map((b) => (
            <Row
              key={b.id}
              primary={`${b.name} (${b.code})`}
              secondary={[
                [b.town, b.postcode].filter(Boolean).join(' '),
                b.phone,
                b.inboxEmail,
              ].filter(Boolean).join(' · ')}
              tone={b.inboxEmail?.endsWith('gmail.com') ? 'review' : undefined}
              note={
                b.inboxEmail?.endsWith('gmail.com')
                  ? 'Clinical mail should not go out from a personal address — this needs one on the pharmacy domain.'
                  : undefined
              }
            />
          ))}
        </Card>
      ) : null}

      {tab === 'Pharmacists' ? (
        <Card title={`${props.clinicians.length} registered pharmacists`}>
          {props.clinicians.map((c) => (
            <Row key={c.id} primary={c.fullName} secondary={`GPhC ${c.gphcNumber}`} />
          ))}
        </Card>
      ) : null}

      {tab === 'GP surgeries' ? (
        <>
          <Card title={`${props.surgeries.length} practices`}>
            {props.surgeries.map((s) => (
              <Row key={s.id} primary={s.name} secondary={s.email} />
            ))}
          </Card>
          <AddSurgeryForm />
        </>
      ) : null}

      {tab === 'Stock' ? (
        <>
          <Card title={`${props.batches.length} batches`}>
            {props.batches.map((b) => (
              <Row
                key={`${b.id}-${b.branchName}`}
                primary={`${b.productName} — ${b.batchNumber}`}
                secondary={[
                  `expires ${formatDate(b.expiryDate)}`,
                  b.branchName,
                  b.quantity !== null ? `${b.quantity} in stock` : null,
                  b.recalledAt ? 'RECALLED' : null,
                ].filter(Boolean).join(' · ')}
                tone={b.recalledAt ? 'stop' : undefined}
              />
            ))}
          </Card>
          <AddBatchForm products={props.products} activeBranch={props.activeBranch} />
        </>
      ) : null}

      {tab === 'Staff' ? (
        <Card title={`${props.staff.length} accounts`}>
          {props.staff.map((s) => (
            <Row
              key={`${s.id}-${s.role}`}
              primary={s.fullName}
              secondary={[
                s.email,
                s.role,
                s.branchName ?? 'all branches',
                s.validTo ? `until ${formatDate(s.validTo)}` : null,
              ].filter(Boolean).join(' · ')}
            />
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="border-b border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        {title}
      </div>
      {children}
    </section>
  );
}

function Row({
  primary, secondary, tone, note,
}: {
  primary: string;
  secondary?: string;
  tone?: 'review' | 'stop';
  note?: string;
}) {
  return (
    <div className="border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="text-[14px] font-medium text-ink">{primary}</div>
      {secondary ? (
        <div
          className={cn(
            'mt-0.5 font-mono text-[11.5px]',
            tone === 'stop' ? 'text-stop-700' : tone === 'review' ? 'text-review-700' : 'text-ink-faint',
          )}
        >
          {secondary}
        </div>
      ) : null}
      {note ? <div className="mt-1 text-[12.5px] text-review-700">{note}</div> : null}
    </div>
  );
}

const input =
  'w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink focus:border-brand-400 focus:outline-none';

function AddBatchForm({
  products, activeBranch,
}: {
  products: { id: string; name: string }[];
  activeBranch: { id: string; name: string; companyId: string } | null;
}) {
  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!activeBranch) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);

    const result = await addBatch({
      productId,
      batchNumber,
      expiryDate,
      branchId: activeBranch!.id,
      companyId: activeBranch!.companyId,
      quantity: Number(quantity),
    });

    setBusy(false);
    if (result.ok) {
      setMessage({ ok: true, text: `Batch added to ${activeBranch!.name}.` });
      setBatchNumber(''); setExpiryDate(''); setQuantity('');
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[10px] border border-line bg-surface px-4 py-4">
      <h3 className="mb-3 text-[14px] font-semibold text-ink">
        Receive a new batch at {activeBranch.name}
      </h3>

      <div className="grid gap-3 sm:grid-cols-4">
        <select value={productId} onChange={(e) => setProductId(e.target.value)} required className={input}>
          <option value="">Product…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)}
          placeholder="Batch number" required className={input} />
        <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
          required aria-label="Expiry date" className={input} />
        <input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)}
          placeholder="Quantity" required className={input} />
      </div>

      {message ? (
        <p className={cn('mt-3 flex items-start gap-1.5 text-[13px]', message.ok ? 'text-safe-700' : 'text-stop-700')}>
          {message.ok ? null : <AlertTriangle size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" />}
          {message.text}
        </p>
      ) : null}

      <button type="submit" disabled={busy}
        className="mt-3 flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={2.2} />}
        Add batch
      </button>
    </form>
  );
}

function AddSurgeryForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await addSurgery({ name, email });
    setBusy(false);
    if (result.ok) {
      setMessage({ ok: true, text: 'Practice added.' });
      setName(''); setEmail('');
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[10px] border border-line bg-surface px-4 py-4">
      <h3 className="mb-3 text-[14px] font-semibold text-ink">Add a practice</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Practice name" required className={input} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Prescription mailbox" required className={input} />
      </div>

      {message ? (
        <p className={cn('mt-3 text-[13px]', message.ok ? 'text-safe-700' : 'text-stop-700')}>
          {message.text}
        </p>
      ) : null}

      <button type="submit" disabled={busy}
        className="mt-3 flex items-center gap-1.5 rounded-[7px] bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={2.2} />}
        Add practice
      </button>
    </form>
  );
}
