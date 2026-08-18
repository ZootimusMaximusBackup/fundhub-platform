# U6 findings — Inquiry Send leaves the building

**COMPLIANCE REVIEW REQUIRED** — inquiry removal.

Walked 2026-08-18 on `https://fundhub.ai`. Specialist `inquiry@fundhub.ai`. One Send on a TEST Queued case for client `8556bedc-…` only. Never opened the live credit file. Did not press Mark Cleared. Did not mail a bureau letter (mail box unchecked). Did not press Send a second time.

Intended desk (`role-inquiry-remover-intended.md`) names Send as a human click on the inquiry queue. Phone inquiry work stays on hold. That step is named. Chris’s claim is that Send actually calls the phone runtime / bureau path. Scored that claim.

Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u6/`. Logs: `walk.json` `db.json` `db-after.json`.

No PASS without a shot, HTTP status, or database row.

## Score

| Ask | Result |
|---|---|
| Specialist opens a TEST Queued case | **WORKS** — 3 TEST Queued rows. File opened. |
| Send calls the phone runtime / bureau path | **BROKEN** — button becomes `VIEW IS NOT DEFINED`. No outbound. |
| Mail / call row / event from this Send | **No** |

Chris’s claim (Inquiry Send actually leaves the building): **BROKEN**. Re-proved live today. Same fail W6 saw. Not copied.

## BROKEN

### Send does not call out

- Journey: Send is named on the Specialist desk. Phone work is on hold.
- Expected (board): one Send on a TEST Queued case. Record screen, network, and whether `inquiry-removal-ai-sigma.vercel.app` or `INQUIRY_API_BASE` was hit.
- Observed:
  - Specialist lands on Specialist. `window.VIEW` is missing. `window.FHInquiryView` is present.
  - Three TEST cases, all `Queued`. Call fired: no. Delivered: no.
  - Opened one TEST row. Send was on. Mail letter (PostGrid) was checked. Unchecked it. Did not press Mark Cleared.
  - Pressed Send once. Button text became **VIEW IS NOT DEFINED**.
  - No `POST /api/inquiry-cases`. No call to `inquiry-removal-ai-sigma.vercel.app`.
  - `GET /api/inquiry?action=cases` → **503** `not_configured` (“Inquiry phone runtime is not configured”).
  - Local `.env`: `INQUIRY_API_BASE` unset. `INQUIRY_API_SECRET` set (name only).
  - After Send: cases still `Queued`. `call_fired` still false. No new inquiry event from this click. `inquiry.gate.clear` (1) is an older row, not this Send.
- Evidence: `00-inquiry-login.png` `01-specialist-desk.png` `02-test-case-open.png` `03-send-once.png` `walk.json` `db-after.json`

## Left undone

- Did not press Send again. Did not press Mark Cleared (U7).

## Next

U7 — inquiry complete → next funding round. Do not fake the event. Do not press Mark Cleared.
