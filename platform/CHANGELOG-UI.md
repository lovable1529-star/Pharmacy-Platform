# UI change log — Claude Design implementation

**Date:** 28 August 2026
**Source of truth:** `Data-driven communications banner.zip` → `Karsons Platform.dc.html`
(the Claude Design canvas: 10 artboards — Sign in, Today, List, Patient record,
Repeat care, Appointments, Services, Communications, Users and roles, Settings)

**Scope:** presentation only. No query, mutation, server action, route, permission
check, validation rule or clinical decision was changed. Verification at the
bottom.

---

## Why this was mostly a small diff

The design canvas was built on top of the palette this codebase already had —
identical hex values for the whole brand ramp, the clinical greens/ambers/reds
and the violet-biased neutrals. So this was not a reskin. It was:

1. a set of **token additions** (a dark theme, a navigation surface, motion),
2. a **consolidation** of patterns that had been hand-written slightly
   differently on each screen, and
3. **per-screen refinements** where the design genuinely moved something.

Most screens changed because the tokens under them changed, not because the
screen was edited.

---

## 1 · Foundation

### `src/styles/globals.css`

| Change | Why |
| --- | --- |
| Added `--color-nav` (`#FCFBFE`) | The sidebar and the content cards were both pure `#FFFFFF`, separated only by a 1px line. Giving the rail its own half-step surface makes chrome and content read as two planes. |
| `--radius-control` 7px → **8px**, `--radius-panel` 10px → **12px**, added `--radius-modal` 14px | The design's values. More importantly they are now *named*: see §2. |
| Added `--shadow-lift` | For cards that are themselves a link or button and lift on hover (Services, Settings). |
| Added `--wash` and `--skel` gradients + `.bg-wash` / `.bg-skel` | Gradients cannot be `@theme` colours, so they are plain custom properties with a utility each. `--wash` is the Today hero; `--skel` is for loading skeletons. |
| Added 8 keyframes: `rise`, `fade`, `pop`, `slidein`, `toastin`, `shimmer`, `pulsedot`, `draw` | The design's motion vocabulary, exposed as `animate-*` utilities. |
| Headings: `text-wrap: balance` → **`pretty`** | `balance` evens out line lengths, which flatters a short marketing headline but actively re-wraps long ones — and these headings carry patient and service names of wildly varying length. `pretty` only prevents a single-word last line, which was the actual problem. |

### Dark theme (new)

A complete second palette under `:root[data-theme='dark']`. **Only token values
change** — not one utility class, layout rule or component knows a dark theme
exists. That is the entire payoff of having expressed the palette as tokens.

Two things are deliberately *not* straight inversions:

- **The brand ramp flips direction.** In light, `brand-700` is a dark purple for
  text on pale fills; in dark it must be a *pale* purple for the same job. So
  50↔800 swap roles, and `text-brand-700 on bg-brand-100` keeps working in both
  themes with no component touched.
- **Clinical colours stay unmistakably green / amber / red.** Lightened for
  contrast against a dark ground, never hue-shifted toward the brand. A
  pharmacist has to read RED as *stop* at a glance in either theme, and that
  outranks visual harmony.

Shadows are rebuilt rather than reused — a translucent-black shadow is invisible
on a near-black canvas — and `color-scheme` is set so native date pickers,
selects and scrollbars follow.

### `src/app/layout.tsx`

- **Blocking inline theme script.** Resolves the theme *before first paint*, from
  the saved preference or (first visit only) the OS setting. This cannot be a
  React effect: an effect runs after hydration, which is hundreds of
  milliseconds after paint — long enough for a full-brightness white flash on
  every navigation for anyone on dark. Wrapped in `try/catch` because private
  windows and storage-blocking browsers *throw* rather than returning null.
- **Deliberately not a `prefers-color-scheme` media query.** If the CSS also
  reacted to the OS, someone who explicitly chose light would be flipped to dark
  the moment their laptop dimmed at dusk. The OS is read once, as a default;
  after that the person's own choice wins.
- Added `suppressHydrationWarning` on `<html>` — scoped to that element's own
  attributes, because the script legitimately sets one before React hydrates.
- Added **Archivo 400** to the font request, for the large display numerals.

### `src/components/ui/theme-toggle.tsx` (new)

Writes one attribute and one `localStorage` key. No server call, nothing on the
user record — so two people sharing a counter terminal each keep their own
preference without it being something an administrator has to manage. Renders at
its final size immediately with the icon appearing a frame later, so the top bar
never reflows.

---

## 2 · Radius consolidation (mechanical, no visual change beyond the new values)

Swept **~190 hard-coded literals across 44 files**:

- `rounded-[7px]` (96) and `rounded-[8px]` (30) → `rounded-control`
- `rounded-[10px]` (67) and `rounded-[12px]` (13) → `rounded-panel`

The corner radius of the entire product is now two numbers in one file rather
than 190 literals that drift apart the moment anyone adds a screen. The smaller
ornament radii (`4/5/6/9px` — tags, pills, hero buttons) were left as literals;
they match the design and are not a system value.

---

## 3 · `src/components/ui/primitives.tsx` (new)

Every one of these already existed — hand-written, slightly differently, on each
screen that needed it. The panel on Today had a 10px radius and no shadow; the
one on Communications had 12px and a border-only header; **four separate files
had each invented their own amber pill.** That is precisely what makes software
look assembled rather than designed, and it is invisible until you put two
screens side by side.

`Panel` · `PanelHeader` · `PanelRow` · `SectionLabel` · `Tag` · `StatCard` ·
`Notice` · `EmptyState` — plus `PageHeader` and `ActionLink`, moved here (see
below). None of them fetches, computes or decides anything.

**One prop is strict on purpose.** `tone` carries clinical meaning:
`neutral` / `brand` are categories; `safe` / `review` / `stop` mean clinically
safe, needs-a-human, and unsafe. They are documented in the file as *not* free
colours.

**`PageHeader` and `ActionLink` moved out of `data-table.tsx`.** That file
carries `'use client'` because the table sorts and paginates in the browser.
These two render text and a link. Left where they were, every server-rendered
page that wanted a heading was pulling a client boundary and the whole table
module into its bundle to get one `<h1>`. Ten import sites rewired.

---

## 4 · `src/components/shell/app-shell.tsx`

| Change | Why |
| --- | --- |
| Rail moved to `bg-nav` | See `--color-nav` above. |
| **Nav grouped into Clinical / Operations / Administration** | Thirteen destinations in one flat list was a wall. This is the split a pharmacist already has in their head: patients in front of you, running the shop, governing the system. Order *within* each group is unchanged — a regrouping, not a re-prioritisation. |
| Groups with no permitted items disappear **with their heading** | A receptionist holds no Administration permissions, and a heading with nothing under it looks like a rendering bug rather than a boundary. |
| Active item gains a **3px bar on the leading edge** | Collapsed to a 72px rail the tinted fill alone reads as a hover state. A bar pinned to the edge still says "you are here". |
| Rail widths 236/60 → **248/72px** | The design's values. |
| Labels now **fade** instead of unmounting | Removing them from the DOM made the width transition jump, because content reflowed mid-animation. They stay in the accessibility tree throughout. |
| **Collapse control moved to the foot of the rail** | Per the design. The original objection to putting it on the sidebar — "a control that moves when you use it is a control people stop reaching for" — is addressed by pinning it to a corner rather than leaving it in the flow. |
| Header now **sticky**, breadcrumb gains the **branch name** | The branch you are recording against is the one piece of context that must never scroll out of sight. |
| Added **theme toggle** and **notifications bell** | The bell is a `Link` to the existing `/communications` outbox, shown only to those holding `communications:view`. Its pip is driven by the badge counts the shell **already receives** — nothing new is fetched, so it can never claim attention the navigation is not also claiming. |
| Badge still collapses to a **dot** at 72px | The design simply fades the badge out. Kept the dot from the previous build: a count nobody can read still says "something is waiting", which is the part that matters on an icon rail. |
| Search box restyled but left **inert and `aria-hidden`** | It has always been non-functional (no `onClick`, no handler) — the command palette behind it is not built. Rather than make a dead control look *more* inviting, it is explicitly non-interactive so nobody discovers it by tabbing. |

---

## 5 · Per-screen

### Today (`src/app/(staff)/page.tsx`)
Greeting, date and search became **one raised hero panel** on the `--wash`
gradient with a single corner bloom, so the screen opens with one obvious place
to put your hands. Counters went from 3 to **4**, in the design's larger form.
Blocked-safety and day panels rebuilt on the shared primitives, with staggered
`rise` entrances.

Greeting is time-of-day aware and computed **in `Europe/Isle_of_Man`** — the
server may well run in UTC, which is enough to wish somebody good morning at one
in the afternoon.

### `src/app/(staff)/patient-search.tsx`
Moved **inside** the hero. "New patient" moved out of the search field and up
into the hero's action row: a primary button inside a search input made the
field read as a form to be submitted, when it actually filters as you type. The
"keep typing" hint moved **inline**, because below the field it pushed the whole
page down by a line on every single search.

### Sign in
The one screen that gets real staging — two brand blooms and a `rise` on the
card, since it is the only thing most people see before they trust the product
with a patient list. Card 400→412px, radius 14px, gradient primary button.

### Services
Each service is now a card that **lifts on hover**, because the whole row is a
destination. Its local `Tag` — one of the four duplicates — now uses the shared
one, which is why its colours match Inventory and Repeat care for the first time.

### Patient record
Header gains the patient's **initials in a 52px disc**. On a screen that looks
identical for every patient, a recognisable shape confirms you have the right
record open before you have finished reading the name.

### Repeat care
The "Why?" drawer now **slides in from the edge it is anchored to** over a
blurred scrim. Not decoration: a drawer that simply appears reads as a new page,
and the pharmacist needs to feel the queue is still there behind it. The blur
also softens a list of patient names while a decision is made at the counter.

### Appointments
Header/notice/empty states onto the shared primitives; day sections gain
elevation. **Deliberately not converted to `Panel`** — that clips its overflow,
and each row opens an action menu that must escape the section's bounds.

### Communications
Local `Stat` and the unroutable warning replaced with `StatCard` and `Notice`.
The warning stays **above** the counters: it is the one thing on the screen that
means a practice will never learn their patient was seen.

### Users & Roles · Settings
Page furniture onto the shared components. Settings' tab strip became a proper
segmented control (`role="tablist"`, `aria-selected`) — the sunk trough is what
says these are alternatives rather than four separate actions.

### `src/components/ui/data-table.tsx`
Panel elevation; whole search field lights on focus rather than just the input;
cells `align-top` → **`align-middle`** (rows mixing a pill or button with plain
text looked top-heavy); rows are single-line by default with a documented `wrap`
escape hatch — every column in the product today is a name, date, code or count.

**Sort arrows now show which column is actually in force.** Previously all six
looked identical and nothing indicated the current sort.

---

## 6 · Accessibility fix found on the way

**14 files** styled their inputs with `focus:border-brand-400 focus:outline-none`.
That `outline-none` applies on `:focus` — which *includes* `:focus-visible` — so
those fields were **cancelling the global focus outline** and leaving only a
subtle border-colour change as the entire keyboard-focus indicator.

All now carry the design's focus ring in addition to the border change. Keyboard
focus is visible on every field in the product again. (The comment in
`globals.css` was already explicit that this is a legal exposure, not a
preference.)

---

## 7 · In the design, deliberately NOT built

These are behaviour or data, not styling. Faking them on a clinical dashboard is
indefensible, so they are recorded here instead.

| Item | Why not | Unblocked by |
| --- | --- | --- |
| **"Clinic open" live pill** (Today) | Opening hours exist in Settings but are not read by this screen. A badge asserting the clinic is open when it is closed is worse than no badge. | Reading branch hours in `getTodaySnapshot`. |
| **Sparklines and "+18% vs last Friday"** (Today) | There is **no historical series** behind this screen — only today's figures. Any trend line would be decoration drawn over invented data. | A daily rollup table. |
| **"Book appointment" / "Start consultation"** (Patient record) | Booking would need the booking screen to accept a pre-selected patient; there is **no route at all** that starts a consultation from a patient — they begin from an arrived appointment. | Both are new flows. |
| **⌘K command palette** | Not built, and never was. The trigger has always been inert; it is now explicitly non-interactive rather than merely dead. | A real palette. |
| **Toasts** | The design includes a toast stack. Screens currently report success and failure inline, which is *not* worse — an inline message stays on screen next to the thing it refers to. Converting them is a behaviour change across ~15 files. | A decision that toasts are wanted. |
| **Loading skeletons** | `--skel` / `.bg-skel` / `shimmer` are all in place, but wiring them needs `loading.tsx` files per route — new files that change perceived behaviour. | Say the word; it is now a small job. |

---

## 8 · Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Clean |
| `vitest run` | **291 / 291 passing** — unchanged, which is the evidence no behaviour moved |
| Route compilation, all 20 staff + public routes | No 500s. Staff routes return 307 **from their own `getStaffContext()` redirect** — middleware only refreshes the session, so each page module genuinely compiled and executed |
| Dark theme token flip | Verified live in the browser: every ground, ink, brand and clinical token swaps; `color-scheme` follows |
| Hardcoded colours | Swept: **zero** `bg-white`, `text-black` or hex literals in any `className` — which is why dark mode works everywhere without per-screen work |
| Sign-in, `/book` rendered | Correct in both themes |

### Not done

**A production `next build` was not run.** Another Claude Code session has a dev
server running on port 3100 against this same folder, and a build writes to the
shared `.next` directory — which broke that server once already in a previous
session. `tsc` plus live route compilation covers the same ground; run
`pnpm build` once that server is stopped.

**Nothing was deleted.** No folder, file or route was removed. `karsons/` is
untouched.

### What route compilation does *not* cover

`app-shell.tsx` is a client component, so on the server it is only a reference —
its render runs in the browser. Route compilation therefore proves it *compiles*
and is imported correctly, not that it *renders*. Since it is also the single
most-rewritten file in this change set, and everything behind sign-in is framed
by it, it is the first thing to look at.

Worth your own eyes, in order:

1. **Any signed-in page** — the shell: grouped navigation, the active-item bar,
   the sticky top bar, the theme toggle. Then collapse the rail to 72px.
2. The **form designer** (`Services → Edit form`) — the screen he will judge
   hardest, and the most complex layout in the app.
3. **Dark mode**, on a clinical screen — Repeat care is the best test, since it
   is where the green/amber/red have to stay unmistakable.

---

# Part 2 — Form Designer rebuild

**Date:** 28 August 2026
**Design doc:** `design-drafts/form-designer/` → three artboards (editing a
question, a brand-new form, adding a question)
**Direction chosen:** B — outline beside the form

## The problem

The old layout had four regions: a palette rail, a step tab bar, an outline, and
an inspector — with the outline stacked *above* the live preview inside one
scroll container. The two things that mattered most, the question being edited
and the effect of editing it, were the two furthest apart. On a form of any
length the preview had scrolled out of sight before you finished typing.

## What it is now

Three columns, and only three:

| Column | Holds |
| --- | --- |
| **Steps** (180px) | Which part of the form you are in, with per-step counts and whole-form totals |
| **Outline** (468px) | The questions — edited **in place**. Selecting one expands the row into its own editor |
| **Preview** (rest) | The real `FormWizard`, pinned, always visible |

### Three changes worth naming

**The palette is a search field, not a rail of eighteen.** It sits at the top of
the outline, so a question is added where questions live. Typing filters on both
the label *and* the hint — which is why "weight" finds Measurement — and Enter
takes the best match. Browsed rather than typed, the eighteen types are grouped
into five headings. The hints were rewritten for a pharmacist rather than a
developer: "Weight, height or waist — metric or imperial", not "measurement".

**Follow-ups appear twice, deliberately.** As a branch of the outline tree, one
level indented on a connector line under a chip naming the answer that triggers
it (`if Other`) — and inside the parent's editor, arranged by answer. The tree
is for *seeing* the logic; the editor is for *changing* it. The chip reads the
answer's own wording, so a branch says "if Other" rather than "if option_3".

**The inspector is gone**, so there is nothing to collapse on the right. The
outline folds away instead, which is the case that actually arises — checking
the whole form at patient width before publishing.

### Also

- Branch children are now real, selectable rows. Previously they were flat
  indented text you could look at but not click.
- The version moved out of the heading. It used to be glued onto the name
  (`Flu Vaccination · currently v4`), which read as part of the service's title;
  it is now a `live: v4` chip, and the heading is just the service.
- Added an "Open as patient" link to the existing preview route, and a
  branch count per step.

## What did not change

Every mutation is the same function it was, called from a different place:
`addField`, `updateSelected`, `removeSelected`, `moveSelected`, `addStep`,
`publish`, `newFieldId`, `collectIds`. `RevealsEditor`, `OptionEditor` and
`Toggle` are untouched. The preview is still the real `FormWizard`, so nothing
can drift between what he builds and what a patient sees.

Two optional presentation props were added to `ServiceDesigner`
(`currentVersion`, `previewHref`) and wired through `designer-client.tsx` and
the route.

## Drawn but not built

- **Drag-to-reorder.** The grip handles are rendered and reordering works via
  the up/down controls in the editor, but dragging is behaviour, not styling.
- **"Copy a step from another service"** on the empty state — needs a picker
  that does not exist.
- **Duplicate a question** — would be new functionality; move and delete are
  what exist.

## Verification

`tsc` clean · **291/291 tests passing** · `/services`,
`/services/flu-vaccination/designer`, `/services/weight-management-first/designer`
and `/services/flu-vaccination/preview` all compile and run (307 from their own
auth redirect, no 500s) · sign-in renders with no console errors.

**Not verified by me:** the designer's rendered output. It is a client component
behind staff auth, so route compilation proves it compiles, not that it renders,
and I do not handle your login. This is the screen to click first.

---

# Part 3 — Collapsing the sidebar actually gives the space back

**Date:** 28 August 2026

## 1 · The freed width now reaches the content

**The problem.** Collapsing the rail moved 176px of screen (248 → 72) into the
left and right margins. Every page kept its own `max-width`, so the content was
exactly as wide as before. Which is a fair description of nothing happening.

**The fix.** The shell sets `--nav-freed` on the content column — `0px` open,
`176px` collapsed — and each page adds it to its own cap:

```
max-width: calc(1080px + var(--nav-freed, 0px));
```

Additive rather than one shared maximum, because the caps are not arbitrary: a
patient record should not become as wide as an inventory table just because
there is room. Twenty page containers were swept onto this.

The `0px` fallback is load-bearing. These containers also render in the
patient-facing layouts, which have no sidebar and never set the variable —
without a fallback the whole `calc()` would be invalid and the cap would vanish
entirely.

A `.page-shell` class carries a 260ms `max-width` transition matching the rail's
own, so the content grows into the space as the rail vacates it rather than
snapping once it has gone. Disabled under `prefers-reduced-motion`.

## 2 · The logo is the collapse control

The separate "Collapse" button at the foot of the rail is gone. The **K** mark
toggles it, and cross-fades to a chevron on hover — pointing left to collapse,
right to expand — so it reads as a control rather than as decoration you
happened to click. The mark and the chevron are stacked and cross-faded, so the
button never changes size and the header does not twitch as the pointer crosses
it.

It is the one spot in the rail that never moves and never scrolls, at the corner
the eye already goes to. Every alternative home for a dedicated button was
either inside the scrolling list or below it.

**One tradeoff worth knowing:** some people expect a product logo to be a link
home. It now toggles instead. Today is the first item in the navigation, so home
is still one click away — but if that trips anyone up, the fix is a separate
home affordance, not putting the Collapse button back.

On touch, where there is no hover, the mark stays a logo and still toggles.

## Verification

`tsc` clean · **291/291 tests passing** · all staff routes still compile (307,
no 500s) · Tailwind confirmed compiling the arbitrary values into real CSS —
`max-width: calc(720px + var(--nav-freed,0px))` and friends are in the served
stylesheet, and a live probe resolved a 1080px cap to **1256px** with the
variable set, matching a hand-written inline `calc()` exactly. The `.page-shell`
transition reads back as `max-width 0.26s`.

**Not verified by me:** the rendered rail and the K button, which are behind
staff auth in a client component.

---

# Part 4 — Naming a step

**Date:** 28 August 2026

**Reported:** adding a step produced "Step 4", "Step 5" … with no way to rename
it. The generated name was the only name.

**Note:** this one is a genuine behaviour change, not styling — steps were not
renameable at all before. Recorded here as such.

## What it does now

The step name in the outline header is an **editable heading**: no border at
rest, a border on hover, a focus ring when you are in it. Not a separate
"rename" button you have to find — it is the label itself, where you are
already looking.

Three details that decide whether this actually feels finished:

- **A new step arrives focused, with its name selected**, so typing replaces
  "Step 4" immediately. The generated name is a starting point rather than
  something to hunt for a way to change. Adding a step also opens the outline
  first, since there is no point focusing a field that is folded away.

- **Double-clicking a step in the rail renames it.** The rail is where you *see*
  the name, so it is where you will try to change it; double-click sends you to
  the field that does rather than doing nothing.

- **An emptied name falls back to its position.** A step with no name renders as
  a blank heading on the patient's form. The fallback runs on **blur, not on
  every keystroke** — otherwise clearing the field to retype it would fight you,
  refilling as you delete.

Enter blurs the field. There is no form to submit and the change is already
applied, so Enter means "done naming".

## Files

`src/components/designer/service-designer.tsx` — added `renameStep`,
`ensureStepNamed`, a focus ref, and the editable header. `addStep` now selects
the new step, opens the outline and focuses the name.

## Verification

`tsc` clean · **291/291 tests passing** · `/services/flu-vaccination/designer`
compiles and runs (307, no 500s).

**Not verified by me:** the rendered field and the focus-on-add behaviour —
client component behind staff auth.

---

# Part 5 — The consent question was not configurable at all

**Date:** 28 August 2026

**Reported:** a `consentList` question offers no way to edit the statements, and
the tick box underneath is not configurable either.

Both correct, and this is the same shape of hole as the follow-up question that
could only be created by hand-editing JSON: a field type that **ships in a form
the designer cannot rebuild.** Three separate faults.

## Fault 1 · The clauses had no editor

The statements do not live on the field. They live on the **schema** —
`FormSchema.consentClauses` — deliberately, so the exact wording is versioned
with the form and it stays provable which text a patient agreed to. The designer
edits fields, so it never saw them. The flu form ships **ten** clauses, and not
one could be read, reworded, reordered or removed except by hand-editing JSON.

There is now a clause editor on any `consentList` question: add, edit, reorder,
remove. Two decisions inside it:

- **Each clause is a textarea, not an input.** These are sentences, often long
  ones about data protection, and a single-line field that scrolls sideways is
  unreadable for exactly the text that most needs reading.
- **Ids are stable and never reused.** A clause's id is what a stored submission
  points at to prove which wording was agreed, so renumbering on delete would
  quietly repoint old consents at new text.

The editor states plainly that the list belongs to the whole form rather than to
one question — otherwise you discover it by editing one consent question and
changing another.

## Fault 2 · The tick-box wording was hard-coded

`"I have read and agree to all of the above."` was a string literal inside
`ConsentList` in `controls.tsx`. **The one sentence a patient actually signs was
the one sentence the pharmacy could not change.**

Added `FormField.confirmLabel`, optional, edited from the same panel. The control
falls back to the original wording, so every form version published before this
renders exactly as it did. Left blank in the editor, it shows the fallback as
placeholder text so it is obvious what the patient will see.

## Fault 3 · Consent could not be added to a new service

`consentList` was **not in the palette at all** — eighteen types, and this was
not one of them. A brand-new service could never have a consent step, so the
"build your own form for any service" claim quietly excluded the one question
every clinical service needs. It is now in the palette under Media & consent.

## Files

- `src/types/form-schema.ts` — `FormField.confirmLabel`, optional
- `src/components/fields/controls.tsx` — the control reads it, with the old
  wording as fallback
- `src/components/designer/service-designer.tsx` — `ConsentClauseEditor`,
  `updateConsentClauses`, the palette entry, and the consent block in the editor

Schemas are stored as JSONB with no runtime validator, so an added optional
property is backwards compatible: old published versions load unchanged.

## Verification

`tsc` clean · **291/291 tests passing** · the designer, preview and public
patient form all compile and run · the public form at `/f/flu-vaccination`
renders with **no console errors**.

**Not verified by me:** the consent step rendering. It sits behind the wizard's
step gate — a patient cannot jump to step 3 until step 1 is complete, which is
the form working correctly — so reaching it means filling in a real patient. The
render change is a one-line fallback, but it is unseen.

## Still not configurable, flagged rather than fixed

- **`clinicianDeclarations`** — the same `ConsentClause[]` shape, ticked by the
  pharmacist rather than the patient, and it has no editor either. Same fault,
  not reported, not fixed; say the word.
- **Two consent questions in one form share one clause list.** That follows from
  clauses being schema-level, which is the right call for provability. If a form
  ever needs two different consent texts, that is a schema change, not a UI one.

---

# Part 6 — The two things Part 5 flagged

**Date:** 28 August 2026

Both items left open at the end of Part 5, now closed.

## 1 · Pharmacist declarations are editable

Same fault as the consent clauses and the same cause: `clinicianDeclarations`
lives on the schema, the designer edits fields, so it was never reachable. The
flu form ships four; the GLP-1 forms share another set. None could be read or
changed except in the seed files.

**They could not hang off a selected question the way consent does** — they are
not a question, belong to no step, and are ticked by the pharmacist on the
consultation screen rather than by the patient. So they get the outline column
to themselves, reached from a **Declarations** entry under "Whole form" in the
steps rail, with a live count.

The panel says plainly that these never appear on the patient's form. The live
preview sitting right beside it shows the patient's form, and without that note
an editor whose changes never appear in the preview looks broken.

The clause editor was generalised into a shared `ClauseEditor` rather than
copied — the two lists are the same shape and the same rules apply to both,
including stable ids that are never reused.

## 2 · A question can have its own consent statements

Previously every consent question in a form shared one list, which follows from
clauses being schema-level. In Part 5 I called that a schema change rather than
a UI one. It was — so here is the schema change.

`FormField.consentClauses` is optional and **wins over the form-wide list when
set**. Unset, the form-wide list applies exactly as before, so every published
version is unaffected. Provability is not weakened: a field lives inside the
same versioned schema the shared list does.

The editor states which list is in force *before* you edit it, because the two
look identical and editing the wrong one silently changes another question.
"Give it its own" starts from a copy of what is already showing, so splitting a
list never blanks the question.

## The resolution is now a tested function

`resolveConsentClauses(field, schema)` in `lib/forms/runtime.ts`, replacing an
inline fallback in the renderer. Four new tests — **295 total, up from 291.**

The one that matters: **an empty list on the question is a deliberate "show
nothing", not a missing value.** Writing `||` instead of `??` there would make a
question the pharmacy had explicitly cleared inherit ten statements again — and
it would look completely fine on screen while recording a valid agreement to
text the patient was never shown. That is exactly the class of bug worth a test.

## Files

- `src/types/form-schema.ts` — `FormField.consentClauses`
- `src/lib/forms/runtime.ts` — `resolveConsentClauses`
- `src/components/form/wizard.tsx` — renders through it
- `src/components/designer/service-designer.tsx` — `ClauseEditor` (generalised),
  `updateDeclarations`, the declarations view, the shared/own switch
- `tests/form-runtime.test.ts` — four tests

## Verification

`tsc` clean · **295/295 tests passing** · designer, consultations and both
public patient forms compile and run · `/f/flu-vaccination` renders with no
console errors.

**Not verified by me:** the declarations panel and the shared/own switch, both
behind staff auth.

---

# Part 7 — Systematic audit

**Date:** 28 August 2026

Five faults had been found one at a time, all the same shape: **something the
seeded forms use that the designer cannot reach.** Rather than wait for the
sixth, I enumerated the whole surface.

## Method

Three mechanical comparisons, not a read-through:

1. Every property on `FormField`, `FormStep` and `FormSchema` versus every
   property the designer writes.
2. Every member of the `FieldType` union versus the palette, and versus the
   renderer's `switch`.
3. Every `href` in the app versus the routes that exist.

Then each gap weighted by **how many times the real seeded forms use it** — a
missing editor for an unused property is theoretical; for a used one it is live.

## Findings

### Severity 1 — clinical, and in use

| Gap | Uses in real forms | Consequence |
| --- | --- | --- |
| `warnWhen` | **7** | The stop-supply warnings — including pregnancy on GLP-1 — existed only in seed files |
| `measurementKind` | **6** | Every Measurement question is hard-wired to weight on creation. **A height question could not be built at all** |
| `calculation` / `calculationInputs` | 2 | Every Calculated value is BMI. An age field could not be built |

### Severity 2 — patient-visible, and in use

| Gap | Uses | Consequence |
| --- | --- | --- |
| `FormStep.description` | **11** | The line under each step heading — "Please read these carefully before signing" |
| `presentation` | **50** | Dropdown vs one-per-line, chips vs tick list — all frozen at creation |
| `estimatedMinutes` | 3 | The "about 3 minutes" a patient sees before starting |
| `numberQuestions` | 3 | The numbering he asked for and never got |
| `FormSchema.title` / `description` | — | The form's own heading |
| `halfWidth` | 4 | Two questions side by side |
| `placeholder` | 1 | Example text inside a box |

### Severity 3 — structural

**Steps could be added but never removed or reordered.** `addStep` existed;
`removeStep` and `moveStep` did not. A step created by mistake was permanent.
This is the one actually hit in use.

**`yesNoNa` renders but was not in the palette** — a working field type that
could not be created.

### Severity 4 — latent

**`date` is in the `FieldType` union, is not in the palette, and has no case in
the renderer's switch** — so it falls through to `default: TextInput` and would
render as a plain text box. Nothing uses it and nothing can create it, so it
cannot currently bite anyone. Flagged, not fixed: the right fix is either a real
date control or removing it from the union, and that is a decision about what
the product wants, not a bug to quietly patch.

### Clean

Every `href` in the application resolves to a route that exists, including both
API endpoints (`/api/consultations/:id/pdf`, `/api/uploads/view`). No dead links.

## Fixed

Designer coverage of `FormField` went from **8 of 21 properties to 14**, and all
five step operations now exist.

- `warnWhen` — a full editor. The trigger is a **select of the answers the
  question can actually take**, read from the same literals the control writes
  (`'yes'`/`'no'`/`'na'`), because a warning bound to an answer that cannot occur
  is not a broken-looking warning, it is a silent one. An answer that no longer
  exists is kept and labelled rather than snapped to the first option — that
  would quietly repoint a stop warning at a different answer. Severity is
  spelled out with its consequence, not just colour-coded.
- `measurementKind`, `calculation` — choosers. Picking a calculation moves
  `calculationInputs` with it, so "Age" can never be left reading weight and
  height and silently never resolving.
- `presentation` — per type, because "chips" is meaningless on a Yes/No.
  Offering every presentation for every type would let him build combinations
  the renderer does not honour, which looks like a broken form rather than a
  wrong choice.
- `placeholder`, `halfWidth`, `FormStep.description`.
- Steps: `removeStep`, `moveStep`, `describeStep`. Deleting is blocked at the
  last step — a form with no steps has nothing to render and no way back.
  Deleting also clamps `stepIndex`, which would otherwise point past the end.
- **Form settings** — a new view holding the form's heading, its description,
  the estimated minutes and question numbering, with the declarations below.
  Reached from the steps rail.
- `yesNoNa` added to the palette.

## Deliberately not fixed

| Gap | Why |
| --- | --- |
| `visibleWhen` | Overlaps `reveals`, which IS editable and covers the common case. A general rules editor is a design job, not a patch, and half-building one is worse than not having it |
| `storeMetadataAs` | Only meaningful alongside per-option metadata, which is also not editable. That pair is genuinely developer territory — it carries GP mailboxes and batch numbers |
| `validation` (min/max) | One use in the real forms. Worth doing, but it needs per-type bounds to be useful rather than a raw pair of number boxes |
| `FormStep.unlockedBy` | Zero uses. The verification-gate feature exists in the runtime and no form uses it |
| `date` field type | See Severity 4 — a product decision, not a patch |

## Verification

`tsc` clean · **295/295 tests passing** · designer and both public patient forms
compile and run.

**Not verified by me:** every editor added here is behind staff auth. They
compile and typecheck; none has been clicked.

---

# Part 8 — Closing the four deferred gaps

**Date:** 28 August 2026

Part 7 left four things unfixed with reasons. All four are now done, and one of
them turned up a latent crash on the way.

## `visibleWhen` — a visibility editor

Rules that decide whether a question appears at all. Distinct from a follow-up,
and the editor says so: **a follow-up is owned by the answer that reveals it and
sits directly beneath it** (allergies → yes → which ones), while visibility is
for a question that lives somewhere else and depends on an answer given several
steps earlier. Reach for a follow-up first; this is the escape hatch.

Both halves of a rule are pickers, never free text:

- The question is chosen from every other question in the form, labelled by the
  step it sits in. Follow-ups are included, since a later question may
  legitimately depend on one; the question being edited is excluded, because a
  rule reading its own answer can never be satisfied.
- The value is built from the target question's actual answers wherever it has
  them, so a rule cannot point at an answer that does not exist. That failure is
  silent — the question simply never appears.

A rule pointing at a deleted question is **kept and marked** rather than rebound
to whichever question happens to be first. Rules are ANDed, which is stated
outright, because a list of conditions reads either way.

## `storeMetadataAs` and per-option hidden data

The flu form's GP surgery list carries an `@gov.im` mailbox on every option, and
that is how a practice gets told their patient was vaccinated. **It could not be
seen from the designer, let alone corrected** — and a wrong address there fails
silently, because the mail just goes nowhere.

Each option now has a `data` chip showing how many values it carries, collapsed
by default: most options carry none, and a key/value grid under every option
would bury the label you came to edit.

**Values keep their type.** Editing through text inputs would turn every number
into a string, so the original type decides how typed text is read back —
`ladderIndex: 0` stays a number. A number edited into something unparseable
keeps the text rather than becoming `NaN`, which would be worse than either.
Renaming a key rebuilds the object rather than patching it, so order survives.

## `validation` — limits, per type

Only the limits that do something for a given type are offered, read off
`validateField` rather than guessed: min/max where the answer is numeric,
character limits and a pattern where it is a string. A character limit on a
number question would be a box that silently does nothing.

Two things are called out because both surprise people: the message replaces
**every** message for that question including the required one, and a pattern is
a regular expression whose validity is reported as you type.

### The latent crash this turned up

`validateField` called `new RegExp(rules.pattern)` unguarded. **An invalid
pattern throws, and the throw takes down validation for the whole step** — a
patient would have met a crash rather than a validation message. Now caught: an
unparseable pattern is treated as no pattern. The wrong answer to let through,
and far better than the alternative.

Two tests pin it, including one asserting it does not throw. **297 total, up
from 295.**

## `date` — implemented rather than deleted

It was in the `FieldType` union, absent from the palette, and had no case in the
renderer — so it fell through to a plain text box. Unreachable from both ends,
which is why nothing had hit it.

Implemented rather than removed, because a plain date is genuinely useful and
deleting it from the union could break any stored schema that ever used one.
`DateInput` stores an ISO `YYYY-MM-DD` string, the same shape `dateOfBirth`
already produces, so everything downstream keeps working. It is distinct from
`dateOfBirth` on purpose: that stays a three-part entry, because typing a birth
date into a picker means scrolling back seventy years.

## Coverage, measured

| | Before Part 7 | Now |
| --- | --- | --- |
| `FormField` properties editable | 8 of 21 | **18 of 21** |
| Remaining | 13 | **0** — `id`, `type` and `number` are immutable by design |
| Step operations | add, rename | add, rename, describe, move, delete |
| Field types unreachable from the palette | 2 | **0** |
| Field types with no renderer | 1 | **0** |

`email`, `number` and `shortText` still have no explicit `case` in the renderer's
switch — that is correct, not a gap: they fall to `TextInput`, which sets its
own input type from the field.

## Verification

`tsc` clean · **297/297 tests passing** · designer, preview, consultations and
both public patient forms compile and run · `/f/weight-management-first` renders
with no console errors.

**Not verified by me:** every editor added in Parts 7 and 8 is behind staff auth.
They compile and typecheck; none has been clicked.
