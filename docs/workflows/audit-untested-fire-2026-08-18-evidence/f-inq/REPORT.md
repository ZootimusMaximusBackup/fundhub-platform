# F-INQ — Mark Cleared on a TEST case

**COMPLIANCE REVIEW REQUIRED** — inquiry complete.

Walked 2026-08-18. Specialist `inquiry@fundhub.ai`. TEST client `8556bedc-…` only. Pressed **Mark Cleared once**. Did not press Send. Did not mail a bureau. Did not open live file `9af65808-…`. Did not flip `INNGEST_EVENT_KEY`.

Ground truth for “inquiry work done → next funding round starts by itself” is **MISSING**. `docs/journeys/role-inquiry-remover-intended.md` does not name that hop.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-inq/`. Logs: `before.json` `after.json` `walk.json`. Shots: `01-before.png` `02-after.png`.

Env names used: `STAFF_E2E_PASSWORD`, `DATABASE_URL`. Values not printed.

## F-INQ findings

| Ask | Result |
|---|---|
| Case status after one Mark Cleared | **Completed** (`f872cc9d-…`). Was `Queued`. |
| `inquiry.removed` count | **0 → 1** (all files and TEST). |
| New event row | `41c26b69-…` at 2026-08-18T21:42:28.865Z. Payload (no secrets): `caseId=IRC-1787072070546`, `inquiryRemovalCaseId=f872cc9d-…`, `source=inquiry_removal_case`. Key `inquiry.removed:case:f872cc9d-…`. |
| New task / C-03 row | **Yes.** Task `f09e0aff-…` title “Start next funding round — clean file”, source `c-03-inquiry-removed-resume-or-hold`, body = event id. Created 21:42:31.107Z (~2s later). Failed-event rows still **0**. |
| New funding round row | **No.** TEST `funding_rounds` still **0**. |
| Client flags | `ready_for_next_round=true`. Next action “Apply for Funding”. Tag `inquiry:completed`. |
| Did the next funding round start? | **No.** A staff task and a flag appeared. No round row. |
| Bureau work | None. `call_fired=false`. `delivered=false`. Send not pressed. |

HTTP: `POST /api/inquiry-cases` action=`mark_cleared` id=`f872cc9d-…` → **200** `ok=true` `case_status=Completed` `event_id=41c26b69-…` `deduped=false`. Press count **1**.

After reload the completed case left the active list. Two TEST cases stay `Queued` (`e235efc2-…`, `1d212e99-…`). Live file untouched (0 events / 0 case writes in the last 2 hours).

## PASS — Mark Cleared writes the event

- Journey: **MISSING** for this hop. Button exists on the Specialist desk.
- Expected (Chris): press Mark Cleared once on a TEST Queued case.
- Observed: case `Completed`. `inquiry.removed` written once. C-03 ran and made the “start next round” task.
- Evidence: `01-before.png` `02-after.png` `walk.json` `after.json`.

## NO — next funding round did not start

- Journey: **MISSING.**
- Expected (Chris ask 5): did the next funding round start?
- Observed: `funding_rounds` on TEST still **0** before and after. C-03 sets a flag and a task. It does not insert a round.
- Evidence: `before.json` `after.json` `funding_rounds_test.n=0`.

## Left undone

- Did not press Send. Did not mail a bureau. Did not open the live file.
- Before shot is the open TEST row. The Mark Cleared control sits below the fold at 1440×900. Button text and the POST are in `walk.json`.

## Next

Chris names what to fix, if anything.
