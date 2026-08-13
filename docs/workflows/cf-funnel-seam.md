# CF funnel seam — live proof (2026-08-12)

**Status:** **SEAM GREEN** — CF V2 signature fix live; real booking landed client + events

## Correlate UI (W2) — client `704cc907-acaf-4f21-8003-2cd36c26cfbf`

| Surface | Result |
|---------|--------|
| `/api/dashboard/clients` | **PASS** — Chris Seam listed |
| `/api/read/search?q=sigfix` | **PASS** — links to CCP |
| `/api/dashboard/client?id=…` | **PASS** — task “Strategy session booked” + open blocker |
| Pipeline cards (sales/funding/repair) | **PASS** — sales/`booked` card (sync handler + backfill); phone on client |
| Portal magic-link | **PASS** — verify → client account/session (rate-limited on re-issue) |
| Live Playwright | **100/100** reconfirmed |
| Messaging inbox | no thread yet (expected; dry-run) |  
**Sales board (owner 2026-08-12):**  
`entry.captured` → **New Lead** · last CF field `cf_svy_available_capital` → **Survey Complete** · `booking.created` → **Booked**.  
Advances only (never demote). Confirmed left alone for now.

**Owner command:** agent in control (2026-08-12)  
**Canonical webhook:** `https://fundhub.ai/api/webhooks/clickfunnels`  
**Owner:** Contact Attributes **all mapped**. Secret last4 matches Netlify (`4f97`).  
**CF UI:** 28 deliveries Issued; Delivered blank / retry / red X → we were **401 bad_signature**  
**Cause:** CF 2.0 signs `timestamp.body` with `X-Webhook-ClickFunnels-*`; we only checked raw-body HMAC on `x-clickfunnels-signature`.  
**Fix:** `src/adapters/clickfunnels.mjs` + router header list (tests 26/26).  
**Capture:** `CF_CAPTURE_MODE=1`  
**Dry-run:** `MESSAGING_DRY_RUN=1` (leave until seam green)

## Proven on FundHub (runtime)

| Check | Result |
|------|--------|
| Unsigned POST | `401 bad_signature` |
| Runtime HMAC selftest (`cf_sign_selftest`) | `200` `reason: no_email` |
| Secret length | 64 (last4 `4f97` — matches masked CLI) |
| `webhook_captures` after selftest | **1** row (`fundhub.sign_selftest`) |
| Live health | `ok: true`, `pending: 0` |

## Live CF fires (no land)

| When | Email | CF UX | Captures | Events | Client |
|------|-------|-------|----------|--------|--------|
| Earlier | `Bakerskater987+test.cfseam@gmail.com` | survey + book + thank-you | 0 | 0 | 0 |
| 2026-08-12 ~23:11Z | `Bakerskater987+test.cfseam.cmd.1786576245680@gmail.com` | book Wed Aug 12 5:30–6:00 PM MST → **thank-you** | 0* | 0 | 0 |

\*Only capture in DB is our selftest, not a CF body.

**Conclusion:** Ads/bookings complete inside ClickFunnels, but ClickFunnels is **not POSTing signed webhooks** to FundHub (or posts to a different URL). Attributes mapping alone cannot fix missing deliveries.

## Blocker (owner — CF UI, 60 seconds)

Open ClickFunnels → Webhooks → endpoint for FundHub:

1. URL must be exactly `https://fundhub.ai/api/webhooks/clickfunnels`
2. Delivery log for today’s booking — **any attempts?** success / fail / empty?
3. Events enabled must include survey/contact update **and** `appointments/scheduled_event.created` (or CF’s equivalent)

Reply with what the delivery log shows (even “empty / no attempts”).

## Task list

| Step | Status |
|------|--------|
| 0 Owner secret match recorded | **done** |
| 1 Enable capture + deploy | **done** |
| 2 Attrs mapped (owner) | **done** |
| 3 Agent books +test → thank-you | **done** (cmd email above) |
| 4 Runtime sign selftest + capture write | **done** |
| 5 CF delivery log (owner) | **blocked — need CF UI** |
| 6 Diff real CF payload vs normalize | blocked on 5 |
| 7 Client row + appointment same id | blocked on 5 |
| 8 Replay idempotency | blocked on 5 |
| 9 Update E2E-REPORT blocker #1 | in progress (this board) |

## Evidence

`docs/workflows/e2e-verify-run4-evidence/cf-seam/`  
- `sign-selftest.json`  
- `watch-after-book-cmd.json`  
- booking email in this board


**CF Deliveries clock:** CF UI ~3h ahead of Phoenix (likely Eastern workspace TZ). Not FundHub.
