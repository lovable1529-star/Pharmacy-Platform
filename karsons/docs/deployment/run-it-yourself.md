# Run It Yourself

Getting the system running locally and checking everything works, before it goes
in front of the client.

---

## Requirements

Node 20 or later. Nothing else — **no database, no Supabase account, no
environment variables**.

The application boots in demo mode against an in-memory store. Every screen
below works without any external service.

```bash
pnpm install
pnpm dev
```

Open **http://localhost:3000**. It redirects to the dashboard.

---

## Verify the build first

```bash
pnpm verify
```

Runs typecheck, all 290 tests, and the documentation build. If this passes, the
system is sound. If it fails, stop and fix before demoing.

To check the production build specifically:

```bash
pnpm build && pnpm start
```

---

## Walkthrough — 15 minutes

Follow this in order. It is also the demo script.

### 1. The dashboard (1 min)

You land on **Today at Onchan**.

**Check:** the red banner near the top says a repeat request is blocked on safety
grounds, naming Callum Quayle and Thomas Radcliffe. That banner is not
hard-coded — the decision engine triaged those requests when the page rendered.

**Try:** switch branch to **Kirk Michael** in the sidebar. Appointments, the
walk-in queue and stock all change. Patient records will not, because patients
are organisation-scoped by design.

### 2. Find a patient (2 min)

**Patients** in the sidebar.

- Type `Kelly` — several results.
- Type `Kelly 05/03/1974` — the matching patient jumps to the top, with badges
  showing which fields matched.
- Type `Kermodee` (deliberate misspelling) — Kermode is still found.
- Type `IM3 1AR` — postcode search works despite being two words.

**Check:** searching does not fire until three characters. That is
`shouldSearch()` keeping the query volume, and the hosting bill, down.

### 3. A patient record (1 min)

Open any patient. Roughly one in seven has a recorded egg allergy — try a few
until you find one.

**Check:** the allergy sits in a red banner above everything else. History
merges consultations, appointments, repeat requests and messages into one
timeline rather than separate tabs.

### 4. Run a consultation (3 min)

Click **Start consultation**.

**Try, in this order:**

1. Leave "verify identity" unticked. The submit button is disabled and the
   safety panel says why. It is genuinely disabled, not styled to look it.
2. Tick identity. Answer the fever question **Yes** — a red warning appears and
   submission stays blocked.
3. Change fever to **No**.
4. Change the vaccine to **Fluenz Tetra Nasal Spray**. If the patient has an egg
   allergy, a BLOCK appears immediately — Fluenz contains egg, and the check
   matches through synonyms.
5. Switch back to a compatible vaccine, sign all declarations, submit.

**Check:** the confirmation lists stock decremented, record generated, GP
notification queued, audit written.

**Also check:** selecting a pharmacist auto-fills their GPhC number, and
selecting a vaccine auto-fills batch and expiry. That is the hidden-metadata
feature the client asked for, working as configuration.

### 5. Build a service (4 min) — the important one

**Services → New service**.

This is what Zoho could not do.

1. Click **Yes / No** in the left palette. A question appears.
2. In the right panel, change the text to *"Have you travelled outside the
   British Isles in the last 12 months?"*
3. Click **+ Add a follow-up when they answer Yes**. A detail box appears,
   nested under the question.
4. Look at the preview on the right. Answer **No** — the follow-up stays hidden.
   Answer **Yes** — it appears.
5. Tick **Pharmacist answers this** on a question. It vanishes from the patient
   preview but stays in place in the editor.
6. Add a **Dropdown**, add options, and watch the preview update live.
7. Click **Publish this version**.

**Check:** the preview is the same component the real patient form uses. There is
no separate patient build.

**Then:** open **http://localhost:3000/f/flu-vaccination** in a separate tab, or
on your phone. That is a patient completing a form. Answer "Yes" to allergies —
the detail box appears. Change to "No" — it disappears, and the typed text is
discarded so the record cannot contradict itself.

### 6. Clinical rules and the simulator (3 min) — the centrepiece

**Repeat care → Clinical rules**.

Twenty-two rules, each showing how often it fired across 40 historical cases.

**Try:** toggle off **"Two or more doses missed in past 4 weeks"**.

The simulation panel updates instantly:
- The RED / AMBER / GREEN counts shift
- A red box appears listing cases that *would now pass without being flagged*

**Check:** that red box is the point. A rule change that quietly stops flagging a
safety concern is the dangerous kind, and it is impossible to miss here.

**Try:** toggle it back on. Everything returns to zero changes.

### 7. Review a repeat request (2 min)

**Repeat care**. Requests are sorted worst-first.

Open **Callum Quayle** — RED. He requested 2.5mg → 10mg, a three-step jump.

Click **Why?**. You see every rule evaluated, which fired, and the derived values
used — including `doseStepChange: 3`.

Open **Bridget Kelly** — GREEN. Note the wording: *"No concerns flagged"*, never
"approved", and there is still a **Confirm and issue** button. Nothing is ever
supplied automatically. That is what keeps the product outside medical device
regulation.

Open **Fiona Kneale** — AMBER, with her question surfaced in an amber box so the
dispensing pharmacist catches it at collection.

### 8. Recall a batch (1 min)

**Inventory**. Click **Recall** on any batch.

**Check:** the dialog shows how many patients received it, how much stock is
still on shelves and where, and — importantly — how many patients have **no
contact details** and will need a phone call.

The client never asked for this.

### 9. Write a clinical rule (2 min)

Still on **Clinical rules**, click **+ Write a new rule**.

1. Set the field to **BMI**, the comparison to **is less than**, the value to
   **21**.
2. Click **+ Add a condition** and set **Dose request** **is** **Increase**.
3. Choose **RED**.
4. Read the plain-English line at the bottom — it should say roughly *"If BMI is
   less than 21 and Dose request is Increase, mark this request RED."*
5. Save. The simulation updates immediately with the new rule included.

**Check:** the client is authoring clinical logic, not choosing from a menu. That
is both the product claim and the regulatory position — the pharmacy is the
clinical author.

### 10. Add a patient (1 min)

**Patients**, search for something that returns nothing, click **Add new
patient**.

Enter `Bridget` / `Kelly` and date of birth `10/05/1980`.

**Check:** before creating anything, an amber notice appears saying existing
records look similar. Click through and you get the duplicate list with reasons,
and the option to use an existing record instead.

### 11. Book an appointment (1 min)

**Appointments**. Click any free slot, pick a patient and a service, confirm.

**Check:** slots already booked and slots in the past are not offered.

### 12. Compliance (1 min)

**Compliance → Audit trail**. The chain verifies 75 entries.

**Try:** click **Simulate tampering**. The banner turns red and names the exact
entry where the chain breaks. Click **Restore**.

That is `verifyChain()` — the same tested function that runs nightly.

### 13. Communications (1 min)

**Communications**. One notification per surgery, with delivery status.

**Check:** one has bounced, and a red alert says the address is likely wrong.
Every GP is a `@gov.im` government mailbox, and a silent bounce means a practice
has no record of something that happened to their patient.

---

## Things to test that should fail

Worth trying, because the failures are the safety features working:

| Try this | Expected |
|---|---|
| Submit a consultation without verifying identity | Blocked |
| Give Fluenz to an egg-allergic patient | Blocked |
| Submit with the fever answer as Yes | Blocked |
| Submit without signing all declarations | Blocked |
| Answer Yes to allergies, then change to No | Typed detail discarded |
| Search with two characters | No query fires |

---

## What is not wired yet

Be clear about this when demoing.

| Not connected | Consequence |
|---|---|
| Database | Changes reset on reload |
| Auth | No login — you are the owner |
| Email | Nothing actually sends |
| Payments | Stripe not connected |
| PDF | Template exists; no download route |
| Cron | The four scheduled jobs have no handlers |
| Server actions | Nothing persists between page loads |

None of these change the domain layer, because none of it touches a database by
design. Wiring them is mechanical.

---

## Before the client sees it

Two placeholders must be replaced:

1. **GPhC registration numbers** in `src/lib/demo/data.ts` — correctly formatted
   but invented.
2. **GP surgery email addresses** — right `@gov.im` format, not the real
   mailboxes.

Both are commented in the file. Seeing his own pharmacists and surgeries in the
dropdowns is a large part of the effect.

Also confirm the **GPhC premises number** — `9012896` was taken from an Ashcroft
screenshot and is their registration, not his.

---

## Deploying to Vercel for the demo

Demo mode needs no environment variables at all.

```bash
npx vercel --prod
```

Set **Settings → Functions → Region: London (lhr1)**.

For the full setup with Supabase, email and payments, see the Deployment
runbook.
