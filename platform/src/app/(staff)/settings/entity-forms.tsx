'use client';

/**
 * Adding the things the system could not create.
 *
 * Kept to the same shape as the GP practice form already on this page — one
 * card, inline fields, a single primary action. A settings screen where each
 * section invents its own layout is how software starts to feel assembled
 * rather than designed.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SearchSelect } from '@/components/ui/search-select';
import {
  saveClinician, saveProduct, saveBranch, archiveClinician,
} from './entity-actions';

const label = 'mb-1.5 block text-[12.5px] font-medium text-ink-soft';
const input =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand-400';

function Shell({
  title, hint, children, onSubmit, busy, error, disabled,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  disabled?: boolean;
}) {
  return (
    <section className="mt-4 rounded-panel border border-line bg-surface shadow-panel p-5">
      <h3 className="font-display text-[15px] font-semibold text-ink">{title}</h3>
      {hint ? <p className="mb-3 mt-0.5 text-[13px] text-ink-faint">{hint}</p> : <div className="mb-3" />}

      {error ? (
        <p className="mb-3 rounded-control border border-stop-200 bg-stop-50 px-3 py-2 text-[13px] text-stop-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">{children}</div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onSubmit}
          className={cn(
            'flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700',
            (busy || disabled) && 'cursor-not-allowed opacity-40 hover:bg-brand-600',
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.6} />}
          Add
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────

export function AddPharmacistForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [gphcNumber, setGphcNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await saveClinician({ id: null, fullName, gphcNumber });
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not add that pharmacist.');
    else {
      setFullName('');
      setGphcNumber('');
      router.refresh();
    }
  }

  return (
    <Shell
      title="Add a pharmacist"
      hint="They appear in the dropdown on the consultation screen, and their GPhC number fills in automatically."
      onSubmit={submit}
      busy={busy}
      error={error}
      disabled={!fullName.trim() || !gphcNumber.trim()}
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1">
          <label className={label} htmlFor="ph-name">Full name</label>
          <input
            id="ph-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={input}
            placeholder="Mukunda Measuria"
          />
        </div>
        <div className="min-w-[160px]">
          <label className={label} htmlFor="ph-gphc">GPhC number</label>
          <input
            id="ph-gphc"
            value={gphcNumber}
            onChange={(e) => setGphcNumber(e.target.value.replace(/\D/g, '').slice(0, 7))}
            inputMode="numeric"
            className={cn(input, 'tabular font-mono')}
            placeholder="2077837"
          />
        </div>
      </div>
    </Shell>
  );
}

export function PharmacistRowActions({ id, fullName }: { id: string; fullName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (!window.confirm(`Remove ${fullName} from the pharmacist list?`)) return;
    setBusy(true);
    await archiveClinician(id);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={archive}
      disabled={busy}
      className="rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-faint transition-colors hover:border-stop-200 hover:text-stop-700"
    >
      {busy ? '…' : 'Remove'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────

export function AddProductForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [allergens, setAllergens] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await saveProduct({
      id: null,
      name,
      category: category || null,
      allergens: allergens.split(',').map((a) => a.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not add that product.');
    else {
      setName('');
      setCategory('');
      setAllergens('');
      router.refresh();
    }
  }

  return (
    <Shell
      title="Add a vaccine or medicine"
      hint="Batches are recorded against a product, so this comes first."
      onSubmit={submit}
      busy={busy}
      error={error}
      disabled={!name.trim()}
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1">
          <label className={label} htmlFor="pr-name">Name</label>
          <input
            id="pr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
            placeholder="Cell Based TIV"
          />
        </div>
        <div className="min-w-[170px]">
          <label className={label} htmlFor="pr-cat">Category</label>
          <input
            id="pr-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={input}
            placeholder="Influenza"
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="pr-allergens">Allergens</label>
        <input
          id="pr-allergens"
          value={allergens}
          onChange={(e) => setAllergens(e.target.value)}
          className={input}
          placeholder="egg, gentamicin, latex"
        />
        <p className="mt-1 text-[12.5px] text-ink-faint">
          Comma separated. These are matched against what the patient declared —
          a product added with none will never raise an allergy warning.
        </p>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────

export function AddBranchForm({
  companies,
}: {
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [inboxEmail, setInboxEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [town, setTown] = useState('');
  const [postcode, setPostcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await saveBranch({
      id: null,
      companyId,
      name,
      code,
      phone: phone || null,
      inboxEmail: inboxEmail || null,
      addressLine1: addressLine1 || null,
      town: town || null,
      postcode: postcode || null,
    });
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Could not add that branch.');
    else {
      setName(''); setCode(''); setPhone(''); setInboxEmail('');
      setAddressLine1(''); setTown(''); setPostcode('');
      router.refresh();
    }
  }

  return (
    <Shell
      title="Add a branch"
      hint="A new site under one of the group's companies. Set its opening hours afterwards, or nothing can be booked there."
      onSubmit={submit}
      busy={busy}
      error={error}
      disabled={!name.trim() || !code.trim() || !companyId}
    >
      <div>
        <label className={label} htmlFor="br-company">Operated by</label>
        <SearchSelect
          id="br-company"
          value={companyId}
          onChange={setCompanyId}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1">
          <label className={label} htmlFor="br-name">Branch name</label>
          <input
            id="br-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
            placeholder="Peel"
          />
        </div>
        <div className="min-w-[120px]">
          <label className={label} htmlFor="br-code">Code</label>
          <input
            id="br-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))}
            className={cn(input, 'font-mono')}
            placeholder="PEE"
          />
          <p className="mt-1 text-[12px] text-ink-faint">Prefixes references</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[200px] flex-1">
          <label className={label} htmlFor="br-address">Address</label>
          <input
            id="br-address"
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            className={input}
          />
        </div>
        <div className="min-w-[130px]">
          <label className={label} htmlFor="br-town">Town</label>
          <input id="br-town" value={town} onChange={(e) => setTown(e.target.value)} className={input} />
        </div>
        <div className="min-w-[110px]">
          <label className={label} htmlFor="br-postcode">Postcode</label>
          <input
            id="br-postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            className={cn(input, 'font-mono')}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[180px] flex-1">
          <label className={label} htmlFor="br-phone">Phone</label>
          <input id="br-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className={label} htmlFor="br-inbox">Prescription mailbox</label>
          <input
            id="br-inbox"
            type="email"
            value={inboxEmail}
            onChange={(e) => setInboxEmail(e.target.value)}
            className={input}
            placeholder="clinic@karsonspharmacy.co.uk"
          />
          <p className="mt-1 text-[12.5px] text-ink-faint">
            Clinical mail should go out from the pharmacy domain, not a personal address.
          </p>
        </div>
      </div>
    </Shell>
  );
}
