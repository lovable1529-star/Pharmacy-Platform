# Administrator Guide

**Managing the Karsons Pharmacy Platform**

---

## How the system is organised

```
Karsons Pharmacy Group        your organisation
   └── Karsons Pharmacy Ltd   a company — its own registration and invoicing
         └── Onchan            a branch
         └── Kirk Michael      a branch
```

Add a new pharmacy business and it becomes a **company**. Add a new shop under an
existing business and it becomes a **branch**.

Settings flow downwards. Set your consent wording once at group level and every
branch uses it, unless a branch overrides it.

---

## Managing staff

**Settings → Staff → Add staff member**

Enter their name and email. They receive a link to sign in — there are no passwords
to set or reset.

### Roles

| Role | Can do |
|---|---|
| **Owner** | Everything, including billing and staff |
| **Administrator** | Everything clinical and configuration, not billing |
| **Pharmacist** | Consultations, prescriptions, patient records |
| **Technician** | Patient records, stock, bookings |
| **Reception** | Bookings, check-in, basic patient details |
| **Read only** | View only |

### Limiting access to a branch

When adding someone, choose which branch or branches they work at. Leave it blank
for group-wide access.

### Locums

Set an **Access until** date. Their access stops automatically on that date. You do
not have to remember.

### Pharmacists

Pharmacists need a GPhC registration number recorded — it goes on every prescription
they issue. **Settings → Staff → [name] → Clinical details**.

---

## GP surgeries

**Settings → GP surgeries**

Each surgery needs a name and the email address notifications go to.

Get these right. If an address is wrong, notifications fail silently at the far end
and you will not know unless you check. The system alerts you to bounces, but a
wrong-but-valid address will not bounce.

---

## Products and stock

**Inventory → Products** to add a product.

Record any allergens. The system uses these to warn a pharmacist if a patient's
recorded allergy conflicts with what is about to be administered.

### Batches

**Inventory → Batches → Add batch.** Enter the batch number, expiry date, quantity
and which branch received it.

Once added, selecting that product during a consultation fills in the batch and
expiry automatically.

---

## Consent wording

**Settings → Consent text**

Edit and save, and a new version is created. Patients who already signed keep the
version they agreed to — you can always prove exactly what wording someone consented
to and when.

---

## Emails and messages

**Settings → Templates** to edit what goes out.

Use merge fields such as `{{patient.firstName}}` to personalise. The editor lists
what is available.

### GP notifications

**Settings → GP notifications** to choose:

- **Immediately** — one email per patient as each consultation completes
- **End of day** — one email per surgery listing everyone seen that day

End of day is usually better. Surgeries prefer one message to twenty.

### Checking messages arrived

**Communications → Sent** shows everything, with delivery status. Anything that
failed is flagged in red. Click to retry.

Worth a glance each morning.

---

## Reports

**Reports** covers uptake by service and branch, revenue, NHS versus private split,
clinician activity and no-show rates.

Everything exports to CSV.

---

## Compliance

**Compliance** holds:

- **Audit trail** — every change ever made, by whom, when
- **Consent register** — who consented to what wording
- **Data requests** — patient requests for their data, with the statutory deadline
  tracked
- **Retention** — how long records are kept before personal details are removed
- **Incidents** — near misses and incidents, for your governance file

### If a patient asks for their data

**Compliance → Data requests → New request.** Record who asked and what for. The
system tracks the one-month deadline and can export everything held about them.

---

## Adding a new pharmacy

**Settings → Companies → Add company.** Add its branches, assign staff, and choose
which services it offers.

Group settings apply automatically. Only override what genuinely differs.
