# F-DOORS — leftover doors

Walked 2026-08-18 on `https://fundhub.ai`. Findings only. TEST client `8556bedc-…` only. Never opened `9af65808-…`. Did not set Netlify `INNGEST_EVENT_KEY`. Did not put a vendor in sandbox. Did not charge a card. Did not mail a letter.

Ground truth: **MISSING** for archive, Bland start, and job runs. Intended journeys only say “Incoming webhooks — 1 route should be reachable.” Scored against the fire board.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-doors/`

## 1) Webhooks

Unsigned POSTs, then one signed e2e body when the door asked for a signature. Signed bodies were empty / not-complete / not `delivery.confirmed`. No real letter. No real call from these posts.

| Door | Unsigned | Signed e2e | Capture rows |
|---|---|---|---|
| `/api/webhooks/ghl` | **404** `unknown provider: ghl` | not tried (no adapter) | **0** |
| `/api/webhooks/postgrid` | **401** `invalid_signature` | **200** `ignored` `letter.updated` | **0** |
| `/api/webhooks/plaid` | **404** `unknown provider: plaid` | not tried (no adapter) | **0** |
| `/api/webhooks/bland` | **401** `bad_signature` | **200** `not_completed` emitted `[]` | **0** |

`webhook_captures` before/after: only `clickfunnels` **442 → 442**. Delta **0**. No ghl / postgrid / plaid / bland rows.

Env names used to sign (values not printed): `POSTGRID_WEBHOOK_SECRET`, `BLAND_WEBHOOK_SECRET`.

**Score:** GHL **BROKEN**. Plaid **BROKEN**. PostGrid door **PASS** (refuses unsigned, accepts signed e2e, ignores it). Bland door **PASS** (same).

Evidence: `webhooks.json` `captures-before.json` `captures-after.json`

## 2) Bland START

No CRM start door. Owner `GET /api/inquiry?action=cases` → **503** `not_configured`. `POST /api/inquiry?action=launch` hangup-shaped e2e body → **503** `not_configured`. `INQUIRY_API_BASE` unset.

One call to `api.bland.ai/v1/calls` only. Number from `FUNDHUB_TEST_PHONE` (last four `0865`). Task: “This is a Fundhub e2e test. Say goodbye and hang up.” `max_duration` **1** (shortest the API allows). `record` false. No other number.

- HTTP **200** `success`
- Call id `70a094ce-77f5-4cca-a9f2-5d75d899cdff`
- Later GET: `queue_status=started`, `completed=false`, last four `0865`

**Score:** CRM start **BROKEN**. Vendor start **PASS** (call accepted).

Evidence: `bland-start.json` `jobs-runs.json` (call status)

## 3) Archive

TEST still had card `5410b98b-…` on Sales / `decision_rendered`. Pressed **DEL → typed DELETE → Archive** once. That files the whole TEST contact (owner-set). Did it on TEST only.

| | Before | After |
|---|---|---|
| Named card | 1 | **0** |
| TEST cards | 1 | **0** |
| Live board cards | 22 | 21 |
| `crm_archived_at` | empty | `2026-08-18T21:45:03.377Z` |

`POST /api/dashboard/client-archive` → **200**. Banner: “Archived TEST Client Role · removed from pipeline.”

**Score:** **PASS.**

Shots: `archive-confirm.png` (TEST card behind the box) `archive-after.png` (banner + card gone)

Evidence: `archive-walk.json` `archive-before.json`

## 4) Jobs

Did not write Netlify `INNGEST_EVENT_KEY`.

Local names present: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.

| Probe | Result |
|---|---|
| Live `GET /api/inngest` | **401** Unauthorized |
| `GET api.inngest.com/v1/runs` | **404** |
| `GET api.inngest.com/v1/events` | **200** (reachable with local signing name) |
| `GET api.inngest.com/v2/runs` | **200** — 5 **COMPLETED** run rows |

Named completed runs (not from our emit): `message-dispatch-sweeper`, `dpc-03-inbound-reply-router`, `f-09-funding-declined-no-path`, `f-11-bank-email-event-router`, `f-06-funding-conditions-missing-docs`.

Local emit of already-used `contract.signed` on TEST: events table **3 → 4**. New row `a80dde69-…`. Local handlers **0**. Direct `inngest.send` → **401** `Event key not found`. No Inngest run for that emit.

**Score:** Run API **reachable**. Cloud already has completed runs. Our emit did **not** start a run. Per the board: a run row exists on the Cloud list, so “never ran” is false. Our fire emit is still **UNVERIFIED** as a trigger.

Evidence: `jobs.json` `jobs-runs.json`

## What I did not do

- No live credit file.
- No Netlify key write.
- No vendor sandbox.
- No card charge.
- No PostGrid letter send.
- No second Bland call.
- No app, test, config, env, or intended-journey edits.
- No deploy. No commit.
