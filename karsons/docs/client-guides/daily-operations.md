# Daily Operations

**A short guide to running the system day to day**

---

## Opening the pharmacy

Two things are worth thirty seconds each morning.

**Check your dashboard.** It shows today's appointments, anyone in the walk-in
queue, requests waiting for review, and stock running low or nearing expiry.

**Check yesterday's messages.** Go to **Communications → Sent**. Anything that
failed to deliver is flagged in red. A bounced GP notification means a surgery
has no record of something that happened to their patient — worth catching the
same day rather than a month later.

---

## Through the day

### A booked patient arrives

Find them on the dashboard, click **Arrived**, then **Start consultation**.

### A walk-in arrives

Search for them. If they are not in the system, add them. Either way they join
the walk-in queue, and the dashboard shows how long each person has waited.

### Someone rings to book

**Appointments → New booking.** Pick the service, the branch and a slot.

### Someone rings to change a booking

Find the appointment, click **Reschedule**. The patient is notified
automatically, and the old slot is released for someone else.

---

## Closing the pharmacy

Most of this happens on its own.

**At 6pm** each GP surgery receives one email listing every patient of theirs you
saw that day. You do not need to do anything.

**At 6:30pm** your team receives a summary of the day — how many consultations,
which services, NHS versus private, split by branch.

**Before you leave**, glance at anything still sitting in **Needs review**.
Requests waiting overnight are patients waiting overnight.

---

## Weekly

**Check expiring stock.** **Inventory → Expiry.** The system shows how much you
are likely to still be holding when a batch expires, based on your current usage
rate. That is your cue to run a clinic or move stock between branches.

**Check your numbers.** **Reports** shows uptake by service and branch. Useful
for spotting a service that is not being offered as often as you think it is.

---

## When something goes wrong

### A patient says they never got their confirmation

Open their record and look at **Messages**. You can see exactly what was sent,
when, and whether it arrived. If it bounced, correct their email and resend.

### A GP says they never received a notification

**Communications → Sent**, filter by that surgery. If it shows as delivered, the
message reached their mail server. If it bounced, check the address under
**Settings → GP surgeries**.

### A batch is recalled

**Inventory → Batches → [batch] → Recall.**

The system immediately lists every patient who received it, tells you how many
you can contact by email or text, and how many will need a phone call. Review the
list, then send.

The batch is blocked from further use straight away.

### You made a mistake on a record

Open it and click **Edit**. Your correction is saved alongside the original with
your name and the time.

**Issued prescriptions cannot be edited.** Issue a replacement — the system links
the two together.

---

## Things that surprise people

**A patient seen at Onchan shows up at Kirk Michael.** That is deliberate. Their
full history follows them, which means you can see if they collected something at
the other branch last week.

**Nothing is ever deleted.** If a record seems to have vanished it has been
archived. Ask an administrator.

**Green does not mean automatic.** A green repeat request means nothing was
flagged. A pharmacist still confirms every supply. That is the design, not a
missing feature.

**Some questions only you see.** Questions marked for the pharmacist — the fever
check, for instance — never appear to the patient. They sit in the right place in
the form so the clinical order makes sense, and appear on your screen at the
appointment.
