# Building Your Own Services

**A guide for Karsons Pharmacy administrators**

---

## What this lets you do

You can create a whole new clinical service yourself — the questions patients
answer, the form your pharmacist fills in, the documents that get produced and the
emails that get sent. No developer, no waiting, no cost.

If you decide on a Tuesday to start offering travel vaccinations, you can have it
live by Tuesday afternoon.

---

## Before you start

Have these ready:

- The questions you want to ask patients, in the order you want them asked
- Which questions must be answered and which are optional
- What your pharmacist needs to record at the appointment
- What the patient pays, if anything
- Which branches will offer it

You do not need to have it perfect. You can change everything later.

---

## Step 1 — Create the service

Go to **Services → New Service**.

Give it a name patients will recognise. "Travel Vaccination Clinic" is better than
"TVC Phase 1".

Set the price. Leave it at £0 if the service is free or NHS-funded.

Choose which branches offer it. You can add branches later.

---

## Step 2 — Build the patient form

This is where you add your questions. Drag a question type from the left onto the
form.

### Choosing a question type

| You want to ask | Use |
|---|---|
| A short answer, like a name | **Text** |
| A longer explanation | **Long text** |
| Yes or no | **Yes/No** |
| One choice from a list | **Dropdown** |
| Several choices from a list | **Multiple choice** |
| A date | **Date** |
| Their weight or height | **Measurement** |
| A photo of ID, or a selfie | **Upload** or **Take photo** |
| Their signature | **Signature** |
| Just to tell them something | **Information** |

**Measurement** is worth knowing about. Patients can enter their weight in stones
and pounds or in kilograms — whichever they prefer — and the system converts it
automatically. You never have to think about it.

### Making a question required

Tick **Required** on any question the patient must answer. They cannot move to the
next page until they have.

Only make a question required if you genuinely need the answer. Every required
question is another reason someone abandons the form halfway through.

---

## Step 3 — Questions that appear based on other answers

This is the part people find most useful.

### Follow-up questions

Say you ask *"Do you have any allergies?"*

If they answer **No**, you do not want to show them an empty box asking for
details. If they answer **Yes**, you do.

Click the question, choose **Add follow-up**, and set it to appear when the answer
is **Yes**. Add your detail box there.

The follow-up only appears when it is relevant. If the patient changes their mind
and switches to **No**, anything they typed in the follow-up is removed — so your
records never end up contradicting themselves.

### Whole pages that appear conditionally

You can do the same with an entire page. If you have pregnancy questions, set the
page to appear only when the patient's answer to the gender question makes it
relevant.

Click the page heading, choose **Show this page when…**, and pick the condition.

---

## Step 4 — Questions your pharmacist answers

Some questions cannot be answered in advance. *"Have you had a fever in the last
24 hours?"* has to be asked on the day.

Tick **Pharmacist answers this** on any such question.

The question still sits in the right place in the form, so the clinical order makes
sense — but the patient never sees it, and it will not stop them submitting. It
appears on your pharmacist's screen at the appointment instead.

---

## Step 5 — Dropdowns that fill in hidden information

When a patient picks their GP surgery from a list, you need that surgery's email
address so the system can notify them — but the patient should not see it.

Add a **Dropdown**, then for each option fill in the **Hidden information** fields.

The patient sees "Ramsey Group Practice". The system quietly captures the email
address behind it.

This works for anything. Select a vaccine and the batch number and expiry date fill
in automatically. Select a pharmacist and their registration number fills in.

---

## Step 6 — The pharmacist's form

Switch to the **Pharmacist form** tab.

This is what your team completes at the appointment. Typically: which product was
used, which batch, where it was administered, whether it was NHS or private, and
any notes.

---

## Step 7 — Declarations

Under **Declarations**, list the statements your pharmacist confirms before
submitting. For example:

- I have verified the patient's identity
- I have checked the batch number and expiry date
- The patient has given informed consent

These are recorded permanently against the consultation and appear on the GP
notification.

---

## Step 8 — What happens afterwards

Under **Outputs**, choose what the system does when a consultation is completed:

- **Documents** — produce a vaccination record or receipt for the patient
- **Emails** — notify the GP, confirm with the patient
- **Stock** — reduce the stock count for the product used

For GP notifications you can choose **immediately** or **end-of-day batch**. The
batch option is usually better: each surgery receives one email at the end of the
day listing every patient, rather than a stream of separate messages.

---

## Step 9 — Preview and publish

Click **Preview** to see exactly what the patient sees. Switch between phone,
tablet and desktop views.

Walk through it as though you were a patient. Answer questions the wrong way on
purpose and check the right follow-ups appear.

When you are happy, click **Publish**.

---

## Changing a service later

Open the service and click **Edit**. Make your changes and publish again.

**Anyone who has already filled in the form keeps the version they answered.**
Their answers are never rewritten by your edits. This matters — a form you change
next year must not alter what a patient told you last year.

You can see every version under **History**, and what changed between them.

---

## Tips from experience

**Ask fewer questions.** Every question you add costs you completions. If you would
not chase the answer when it is missing, do not ask for it.

**Put the important questions first.** People are most engaged on the first page.

**Write questions the way you would say them.** "Do you take any blood-thinning
medication, such as warfarin?" beats "Anticoagulant therapy status".

**Use follow-ups instead of long forms.** A short form that expands when needed
feels far quicker than a long one where most questions do not apply.

**Test it on a phone.** Most patients will complete it on their phone.

---

## Getting help

Every question you create is numbered. If you need to ask us about one, quote the
number — "question 14 on the travel vaccine form" — and we will know exactly which
one you mean.
