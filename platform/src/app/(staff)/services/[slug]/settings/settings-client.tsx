'use client';

/**
 * Two independent panels, saved separately.
 *
 * Price and branding have nothing to do with each other, and one Save for both
 * would mean a typo in a colour blocking a price correction — which is exactly
 * the change somebody is most likely to be in a hurry to make.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Banknote, Palette } from 'lucide-react';
import {
  setServicePrice, setServiceProfile, type ServiceSettingsView,
} from './actions';
import {
  parsePrice, priceProblems, publicProfileProblems, type PublicProfileDraft,
} from '@/lib/services/settings';
import { formatMoney } from '@/lib/units';
import { Notice, Panel, Tag } from '@/components/ui/primitives';

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[13.5px] text-ink '
  + 'outline-none transition-colors placeholder:text-ink-faint focus:border-brand-400';

const labelClass = 'block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint';

function poundsFrom(priceMinor: number | null): string {
  return priceMinor === null ? '' : (priceMinor / 100).toFixed(2);
}

export function SettingsClient({
  view, editable, slug,
}: {
  view: ServiceSettingsView;
  editable: boolean;
  slug: string;
}) {
  const router = useRouter();

  /* ── Price ──────────────────────────────────────────────────────────── */
  const [price, setPrice] = useState(poundsFrom(view.priceMinor));
  const [priceBusy, setPriceBusy] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceSaved, setPriceSaved] = useState(false);

  const parsed = parsePrice(price);
  const priceFaults = Number.isNaN(parsed)
    ? ['That is not an amount. Enter a number of pounds, like 190 or 190.00.']
    : priceProblems(parsed);

  const priceDirty = price.trim() !== poundsFrom(view.priceMinor).trim();

  async function savePrice() {
    if (priceFaults.length > 0) { setPriceError(priceFaults.join(' ')); return; }

    setPriceBusy(true);
    setPriceError(null);
    setPriceSaved(false);

    const result = await setServicePrice({
      serviceId: view.serviceId,
      priceMinor: Number.isNaN(parsed) ? null : parsed,
    });

    setPriceBusy(false);
    if (!result.ok) { setPriceError(result.error); return; }

    setPriceSaved(true);
    router.refresh();
  }

  /* ── Branding ───────────────────────────────────────────────────────── */
  const [profile, setProfile] = useState<PublicProfileDraft>(view.profile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const profileFaults = publicProfileProblems(profile);

  function field(key: keyof PublicProfileDraft) {
    return {
      value: profile[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setProfile({ ...profile, [key]: e.target.value });
        setProfileSaved(false);
      },
    };
  }

  async function saveProfile() {
    if (profileFaults.length > 0) { setProfileError(profileFaults.join(' ')); return; }

    setProfileBusy(true);
    setProfileError(null);
    setProfileSaved(false);

    const result = await setServiceProfile({ serviceId: view.serviceId, ...profile });

    setProfileBusy(false);
    if (!result.ok) { setProfileError(result.error); return; }

    setProfileSaved(true);
    router.refresh();
  }

  return (
    <div className="grid gap-3.5">
      {/* ── Price ────────────────────────────────────────────────────── */}
      <Panel className="px-5 py-[17px]">
        <div className="flex items-start gap-2.5">
          <Banknote size={15} strokeWidth={2} className="mt-[3px] shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">What it costs</h2>
            <p className="mt-0.5 max-w-[68ch] text-[13px] leading-[1.5] text-ink-faint">
              Read when a prescription is raised and copied onto the payment then,
              so changing it never re-prices anything already issued. A service
              with no price at all cannot be paid for — its prescriptions sit
              awaiting payment with nothing to settle.
            </p>

            {editable ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13.5px] text-ink-faint">
                      £
                    </span>
                    <input
                      className={`${inputClass} tabular w-[150px] pl-6`}
                      value={price}
                      onChange={(e) => { setPrice(e.target.value); setPriceSaved(false); }}
                      placeholder="190.00"
                      inputMode="decimal"
                      aria-label="Price in pounds"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={savePrice}
                    disabled={priceBusy || !priceDirty || priceFaults.length > 0}
                    className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-[8px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check size={13} strokeWidth={2.4} />
                    {priceBusy ? 'Saving…' : 'Save'}
                  </button>
                  <span className="text-[12px] text-ink-faint">
                    Leave empty for a service with no charge.
                  </span>
                </div>

                {price.trim().length > 0 && priceFaults.length > 0 ? (
                  <div className="mt-2.5"><Notice tone="review">{priceFaults.join(' ')}</Notice></div>
                ) : null}
                {priceError ? (
                  <div className="mt-2.5"><Notice tone="stop">{priceError}</Notice></div>
                ) : null}
              </>
            ) : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {view.priceMinor === null ? (
                <Tag tone="review">no price — prescriptions cannot be paid for</Tag>
              ) : (
                <Tag tone="neutral">currently {formatMoney(view.priceMinor)}</Tag>
              )}
              {priceSaved && !priceDirty ? (
                <span className="text-[11.5px] text-safe-700">Saved.</span>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Branding ─────────────────────────────────────────────────── */}
      <Panel className="px-5 py-[17px]">
        <div className="flex items-start gap-2.5">
          <Palette size={15} strokeWidth={2} className="mt-[3px] shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">How it looks to a patient</h2>
            <p className="mt-0.5 max-w-[68ch] text-[13px] leading-[1.5] text-ink-faint">
              Applies to the public form and the repeat request, so this service can
              read as its own clinic. Leave a field empty and the patient sees{' '}
              {view.organisationName} as they do today.
            </p>

            {/*
              Said before the fields rather than after, because it is the
              constraint somebody needs to know BEFORE they start typing a
              different pharmacy name into every box.
            */}
            <p className="mt-2 max-w-[68ch] rounded-control border border-line bg-sunk px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-ink-faint">
              This is the patient-facing name only. Who prescribed and who
              dispensed is recorded as it actually happened, on the prescription,
              the label and the GP notification — none of that is renamed here.
            </p>

            {editable ? (
              <>
                <div className="mt-3.5 grid gap-3.5">
                  <div>
                    <label className={labelClass} htmlFor="brand">Clinic name</label>
                    <input id="brand" className={`${inputClass} mt-1`} placeholder={view.organisationName} {...field('publicBrandName')} />
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor="primary">Primary colour</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input id="primary" className={`${inputClass} font-mono text-[12.5px]`} placeholder="#5B3FA8" {...field('primaryColour')} />
                        <span
                          aria-hidden="true"
                          className="h-[34px] w-[34px] shrink-0 rounded-control border border-line"
                          style={{ background: /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(profile.primaryColour.trim()) ? profile.primaryColour.trim() : 'transparent' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="secondary">Secondary colour</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input id="secondary" className={`${inputClass} font-mono text-[12.5px]`} placeholder="#0F766E" {...field('secondaryColour')} />
                        <span
                          aria-hidden="true"
                          className="h-[34px] w-[34px] shrink-0 rounded-control border border-line"
                          style={{ background: /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(profile.secondaryColour.trim()) ? profile.secondaryColour.trim() : 'transparent' }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor="email">Support email</label>
                      <input id="email" className={`${inputClass} mt-1`} placeholder="clinic@example.co.uk" {...field('supportEmail')} />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="phone">Support phone</label>
                      <input id="phone" className={`${inputClass} mt-1`} placeholder="01624 000000" {...field('supportPhone')} />
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor="privacy">Privacy policy link</label>
                      <input id="privacy" className={`${inputClass} mt-1 font-mono text-[12.5px]`} placeholder="https://" {...field('privacyUrl')} />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="terms">Terms link</label>
                      <input id="terms" className={`${inputClass} mt-1 font-mono text-[12.5px]`} placeholder="https://" {...field('termsUrl')} />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="fulfilment">Who dispenses</label>
                    <input id="fulfilment" className={`${inputClass} mt-1`} placeholder={view.organisationName} {...field('fulfilmentName')} />
                    <p className="mt-1 text-[11.5px] text-ink-faint">
                      Shown to the patient alongside the clinic name, so it is clear
                      who is actually supplying the medicine.
                    </p>
                  </div>
                </div>

                {profileFaults.length > 0 ? (
                  <div className="mt-3"><Notice tone="review">{profileFaults.join(' ')}</Notice></div>
                ) : null}
                {profileError ? (
                  <div className="mt-3"><Notice tone="stop">{profileError}</Notice></div>
                ) : null}

                <div className="mt-3.5 flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={profileBusy || profileFaults.length > 0}
                    className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-[8px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check size={13} strokeWidth={2.4} />
                    {profileBusy ? 'Saving…' : 'Save branding'}
                  </button>
                  {profileSaved ? (
                    <span className="text-[11.5px] text-safe-700">Saved.</span>
                  ) : null}
                  <a
                    href={`/f/${slug}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto text-[12px] font-medium text-brand-700 underline underline-offset-2"
                  >
                    See the patient form
                  </a>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}
