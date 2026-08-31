# Documentation

Open the `.html` files in a browser — they are self-contained, with no build
step and no external assets beyond web fonts.

## `testing/`

| File | Who it is for |
|---|---|
| `weight-management-test-script.html` | **The tester.** 27 steps walking the remote Weight Management journey end to end, with the test data to use and eight safety gates that must refuse. Includes a list of known gaps so nobody reports work that is deliberately unfinished. |
| `platform-testing-guide.html` | How the automated tests are organised and what they cover. |

## `workflow/`

| File | Who it is for |
|---|---|
| `weight-management-for-the-client.html` | **Muka.** How the service works end to end — both journeys stage by stage, what happens automatically, and where the system refuses to proceed without a pharmacist. |
| `open-questions-for-the-client.html` | **Muka.** Ten decisions only he can make, sorted blocking / needed soon / can wait, each with what we assumed meanwhile and what it costs to leave open. |
| `delivery-plan.html` | **The team.** The staged plan the remote Weight Management work was built to. Stages 00–07 are complete. |
| `platform-operating-workflow.html` | Both clinical journeys as originally built, plus the setup scripts. Predates the remote Weight Management change — kept for the flu detail, which is unaffected. |

## Elsewhere in this folder

- `CHANGELOG-IMPLEMENTATION.md` — what changed in each stage and why. Maintained as the work happens, not reconstructed afterwards.
- `IMPLEMENTATION_PLAN.md` — the supplied plan the stages were built against.
- `pending-migrations/` — SQL that is written but **not** in `platform/supabase/`. Read its README before moving anything across; the ordering matters.
- `audit-remediation.md` — findings from the earlier audit and their status.
- `rules-plan.html`, `rebuild-plan.html`, `open-items.html`, `ui-change-log.html`, `demo-guide.html`, `deploy-vercel.html` — earlier reference material.

## A note on the older documents

`platform-operating-workflow.html` and several of the loose files above were
written before the client moved Weight Management to a remote service on
30 August 2026. Where one of them and
`weight-management-for-the-client.html` disagree, the newer one is right.
They are kept rather than deleted because the flu vaccination detail in them
is still accurate and still the best description of that service.
