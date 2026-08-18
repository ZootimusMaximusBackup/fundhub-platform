# Audit — this thread’s live work — 2026-08-17

Read-only. Auditor skill. No app edits after the build commits.

**Live:** `https://fundhub.ai`  
**Commit under test:** `07b4a83` (plus `0f51860`, `75ba39a`, `cfbdba3`)  
**Ground truth:** existing `docs/journeys/*-intended.md` — not invented here.

## Journeys in scope

| Journey | Ground truth | What this thread claimed |
|---|---|---|
| Pipeline board fills | Owner visual: no white hole under columns | Stretch CSS on `cfbdba3` |
| Contracts vs Documents | Owner call in this thread; journeys track routes, not layout | Templates on Contracts; four paper classes on Documents |
| Finance OS company money | Owner call in this thread; no dedicated intended page | Company accounts + recurring charges |
| Funding advisor desk | `docs/journeys/role-funding-advisor-intended.md` | Need-action list + Issue Inquiry Removal |
| Specialist / FTC / send | `docs/journeys/role-inquiry-remover-intended.md` | Case queue first; FTC upload + Send stay |
| Demo Mode gone | Owner call this week | `sample-data.html` gone; nav row gone |

## Evidence gathered (live HTML, 2026-08-18)

SHA256 of live `/app/*.html` **matched** local `07b4a83` for: pipeline, contracts, documents, finance-os, inquiry-remover, client-control-panel, sidebar.fragment.

| Check | Result | Evidence |
|---|---|---|
| Pipeline columns stretch | PASS | live `pipeline.html` has `align-items:stretch` and `height:100%`; hash match |
| Demo Mode page | PASS | `https://fundhub.ai/app/sample-data.html` → 404 |
| Subscriptions page | PASS | `https://fundhub.ai/app/subscriptions.html` → 404 |
| FTC upload + Send still on Specialist | PASS | live inquiry-remover has `Upload FTC or police report`, `data-act="upload-fraud"`, `data-act="send"`; case queue sits above Work Queue |
| Funding desk Issue Inquiry Removal | PASS (markup) | live CCP has the button and `/api/inquiry-cases`; no `Pull Equifax` |
| Finance OS company money markup | PASS (markup) | live page has `Not connected`, `/api/finance/bank-accounts`, `/api/finance/bills`; no `Load simulated data` |
| Command Center deleted | FAIL | `https://fundhub.ai/app/command-center.html` → 200; sidebar still names it |
| Bureau Pull TU/EX/EQ on CCP | FAIL vs Airtable spec | no live HTTP pull; existing lock forbids fake `Pull Equifax` |
| Generate Apps on CCP | FAIL vs Airtable spec | no staff HTTP; button not added |
| Live Playwright 100 after `07b4a83` | UNVERIFIED | not re-run this pass |
| Human click of Pipeline / FTC | UNVERIFIED | hashes only |
| Plaid connect on Finance OS | FAIL (honest empty) | no Connect button; Plaid still not implemented |

## Failure blocks

### 1. Command Center still live

- Journey: sixteen jobs / owner “delete Command Center”
- Step: page must be gone
- Expected: 404
- Observed: 200 at `/app/command-center.html`; sidebar still has the row
- Evidence: live GET 2026-08-18

### 2. Funding desk missing two Airtable actions

- Journey: `role-funding-advisor-intended.md` does not name these buttons (intended is a route copy). Owner prompt this thread named them.
- Step: Pull TU/EX/EQ and Generate Apps
- Expected: live actions
- Observed: pulls stay on closer deck; Generate Apps not built
- Evidence: live CCP HTML; `src/http/crm-html.test.mjs` forbids `Pull Equifax`

### 3. Click path not proven

- Journey: Pipeline fill + Specialist send
- Step: person sees full columns; person uploads FTC and can send
- Expected: live Playwright 100 + one human walk
- Observed: file hashes match; no live Playwright re-run after `07b4a83`
- Evidence: this board

## CI note (not this thread’s screens)

Prior `cfbdba3` GitHub “Partner isolation” job failed with `password authentication failed for user "fundhub_app"`. That is a CI database login, not Pipeline CSS. Not fixed in this pass.

## Auditor stop

Discovery + live hash evidence is in this file. No new Playwright specs written (Auditor Step 2 waits). No fixes in this pass.
