/**
 * Is email actually going to work?
 *
 * Run this after changing anything about email, and before believing an
 * invitation will arrive.
 *
 * The failure this exists to catch is the quiet one. Resend will accept an API
 * key, report a healthy account, and still refuse every message — because the
 * domain in EMAIL_FROM was never verified, or because an unverified account may
 * only write to the address that owns it. Nothing about that is visible until a
 * colleague says they never got their invitation, days later.
 *
 *   pnpm check:email                 — check the configuration
 *   pnpm check:email you@work.com    — and send one real message there
 *
 * Read-only unless a recipient is given, so it is safe to run against
 * production configuration.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? 'clinic@karsonspharmacy.co.uk';

const ok = (m: string) => console.log(`  \x1b[32mOK\x1b[0m    ${m}`);
const bad = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
const warn = (m: string) => console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);

interface Domain { name: string; status: string }

async function main(): Promise<number> {
  const recipient = process.argv[2];
  console.log('\nEmail configuration\n');

  if (!KEY) {
    bad('RESEND_API_KEY is not set in .env.local.');
    console.log('\n  Nothing will be sent. The app logs and carries on, so this is');
    console.log('  easy to miss — that is the point of this check.\n');
    return 1;
  }
  ok(`RESEND_API_KEY is set (${KEY.length} characters).`);

  if (!KEY.startsWith('re_')) {
    warn('That does not look like a Resend key — they normally start "re_".');
  }

  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${KEY}` },
  });

  /*
   * A sending-only key cannot list domains, and Resend reports that as a 401 —
   * the same status as a key that is simply wrong.
   *
   * Reading only the status made this check call a perfectly good key invalid
   * and send somebody off to re-copy it. Sending-only is the better kind of key
   * to deploy: it can post a message and nothing else, so a leak cannot be used
   * to read the account or mint more keys. The check has to work with it.
   */
  let restricted = false;

  if (res.status === 401) {
    const detail = (await res.clone().json().catch(() => ({}))) as { name?: string };
    if (detail.name === 'restricted_api_key') {
      restricted = true;
      ok('Resend accepted the key. It is a sending-only key — the safer kind.');
    } else {
      bad('Resend rejected the key. Check it was copied whole, with no quotes.');
      return 1;
    }
  } else if (!res.ok) {
    bad(`Resend answered ${res.status}. Try again shortly.`);
    return 1;
  } else {
    ok('Resend accepted the key.');
  }

  const domain = FROM.includes('<') ? FROM.split('<')[1]!.replace('>', '') : FROM;
  const host = domain.split('@')[1]?.trim().toLowerCase() ?? '';
  console.log(`\n  Sending as: ${FROM}`);

  if (restricted) {
    /*
     * Nothing more can be checked without sending. That is not a gap worth
     * closing by demanding a full-access key — a real send is stronger proof
     * than a domain list anyway, because it exercises the whole path.
     */
    console.log(`  From domain: ${host}`);
    warn('This key cannot list domains, so the domain is not checked here.');
    if (!recipient) {
      console.log('\n  Prove it by sending, which is the better test regardless:');
      console.log('    pnpm check:email you@yourdomain.com\n');
      return 0;
    }
    return sendTest(recipient);
  }

  // The shape has moved between SDK versions; accept either.
  const body = (await res.json()) as { data?: Domain[] | { data?: Domain[] } };
  const list = Array.isArray(body.data) ? body.data : (body.data?.data ?? []);

  if (list.length === 0) {
    bad('No domains are verified on this Resend account.');
    console.log('\n  Until one is, Resend will only deliver to the address that owns');
    console.log('  the account. Every invitation to anybody else fails.');
    console.log('  Add one at https://resend.com/domains\n');
    return 1;
  }

  console.log('\n  Domains on this account:');
  for (const d of list) {
    const verified = d.status === 'verified';
    console.log(`    ${verified ? '\x1b[32m✓\x1b[0m' : '\x1b[33m…\x1b[0m'} ${d.name} (${d.status})`);
  }
  console.log('');

  const match = list.find((d) => d.name.toLowerCase() === host);
  if (!match) {
    bad(`"${host}" is not on this account, so nothing can be sent from ${FROM}.`);
    console.log('  Either verify that domain, or point EMAIL_FROM at one above.\n');
    return 1;
  }
  if (match.status !== 'verified') {
    bad(`"${host}" is on the account but its status is "${match.status}".`);
    console.log('  Finish the DNS records before relying on this.\n');
    return 1;
  }
  ok(`"${host}" is verified, so mail can be sent from ${FROM}.`);

  if (!recipient) {
    console.log('\n  Configuration looks right. To prove delivery end to end:');
    console.log('    pnpm check:email you@yourdomain.com\n');
    return 0;
  }

  return sendTest(recipient);
}

async function sendTest(recipient: string): Promise<number> {
  console.log(`\n  Sending a test message to ${recipient} ...`);
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: recipient,
      subject: 'Karsons — email delivery test',
      html: '<p>If you are reading this, Resend is configured correctly.</p>'
        + '<p style="color:#7C7594;font-size:12px">Sent by pnpm check:email.</p>',
    }),
  });

  const sent = (await send.json()) as { id?: string; message?: string };
  if (!send.ok) {
    bad(`Resend refused it: ${sent.message ?? send.status}`);
    const why = sent.message ?? '';
    if (why.includes('domain is not verified')) {
      console.log('\n  EMAIL_FROM is on a domain this account has not verified.');
      console.log('  Point it at the verified one, or verify that domain.');
    }
    if (why.includes('only send testing emails')) {
      console.log('\n  No domain is verified, so Resend will only deliver to the');
      console.log('  address that owns the account.');
    }
    console.log('');
    return 1;
  }
  ok(`Accepted by Resend (id ${sent.id}).`);
  console.log('\n  Check the inbox, and the spam folder. Delivery to @gov.im');
  console.log('  needs SPF, DKIM and DMARC all aligned on the sending domain.\n');
  return 0;
}

main().then((code) => process.exit(code)).catch((e: unknown) => {
  console.error('\n  Check failed to run:', e instanceof Error ? e.message : e, '\n');
  process.exit(1);
});
