# Honest CRM fix — 2026-08-16

Punch list from the deep audit. TransUnion stays off. Do not delete staff rows. Missing facts = dash. Never invent people.

## Fix now

| ID | Owner | Status | What |
|---|---|---|---|
| 1 portal | portal | done | Client portal: no Derek/Marcus; no fake upload bar |
| 2 closer-ui | closer-ui | done | Closer dashboard, My numbers, sales-floor leftover, Join |
| 3 clocks | clocks | done | Every Jul 26 clock becomes real now |
| 4 ops-aff | ops-aff | done | Ops-admin staff tables, affiliate copy-code, partner-galaxy sample |
| 5 mail-honest | this session | done | Pay-link is not marked sent unless the notice actually queued |

## Not this batch

- Full LexisNexis product
- Twilio live texts (Monday / A2P)
- Flipping every email template to approved
- Rewriting intended journey files

## Unit 3 clocks — manifest

**Status:** done
**Owner:** clocks

Frozen `Sun Jul 26 · 2:47:09 PM ET` clocks now tick live `America/New_York` once per second. Placeholder in the HTML is `—` until JS paints. Matches client-control-panel tickClock.

**Files**
- `public/app/command-center.html` — clock markup + replaced Jul 26 epoch tick with live `tickClock`
- `public/app/inquiry-remover.html` — clock markup + tickClock
- `public/app/messaging.html` — clock markup + tickClock
- `public/app/pipeline.html` — clock markup + tickClock
- `public/app/ops-admin.html` — clock only (staff tables left for unit 4)
- `public/app/automations.html` — clock markup + tickClock
- `public/app/galaxy.html` — `nowClock` uses real time; no new fake people
- `public/app/partner-galaxy.html` — clock JS only (`nowClock`); did not touch sample people
- `src/http/crm-html.test.mjs` — clock markup must not contain `Jul 26`; must tick `America/New_York`; must not seed `new Date(2026, 6, 26)`

**Left on purpose**
- `public/app/closer-dashboard.html` — other agent
- client portal — other agent
- `public/app/partner-galaxy.html` still has sample filename `Morning brief — Jul 26` (not clock markup; unit 4 may rewrite sample people)
- `public/app/fundhub-brand.css` comment `verified Jul 26 2026` (not a clock)
- wireframes/ copies (not live app)

**Verify:** `node --test src/http/crm-html.test.mjs` — pass 6 / fail 0

## Unit 1 portal — manifest

**COMPLIANCE REVIEW REQUIRED** — upload + consent id on the existing capture path. No new consent wording. No new upload API.

**Status:** done
**Owner:** portal

Derek Owusu and Marcus Webb are gone from the live portal. Missing name / advisor / booking / docs paint as a dash. Without `?id=` or `?client_id=`, the page says “Open this from a client file.” It does not invent a person.

**Files**
- `public/app/client-portal.html` — live bind to `GET /api/dashboard/client`, `GET /api/read/entitlements`, `GET /api/read/documents`. Real upload only via `FHData.uploadFiles` → `POST /api/documents-upload`. Fake `setInterval` upload bar gone. Fake 4:12 welcome scrubber gone. Consent still `GET/POST /api/consent/capture`; query now also reads `?client_id=`.
- `src/http/crm-html.test.mjs` — fails if Derek Owusu, Marcus Webb, `setInterval`, fake `markSentUi()`, or the 4:12 video timer return.

**What a human sees**

Without `?id=` / `?client_id=`:
- Header name: —
- Welcome: “Open this from a client file”
- Advisor: —
- Video: “Welcome video is not available”
- Upload: “Uploads are off”
- Bookings / docs / messages / payments: empty or dash

With `?id=` (staff session, live file):
- Name from the client row, or —
- Advisor from a live field on the file, or —
- Booking from `latest_booking`, or “No booking is on file”
- Docs from `/api/read/documents`, or “No files yet”
- Tiles still lock/unlock from entitlements

Did not edit calendar.html, sales-floor, closer-dashboard, contracts, data.js, or ops-admin.

**Verify:** `node --test src/http/crm-html.test.mjs src/http/consent-sign-pad-html.test.mjs` — pass

## Unit 5 mail-honest + leftover floor — manifest

**COMPLIANCE REVIEW REQUIRED** — payment-link send status. A link is marked sent only if the notice actually queued.

**Status:** done
**Owner:** this session

**Files**
- `api/payment-links.mjs` — do not `markSent` unless `sendTemplated` queued (`queued.sent === true`)
- `src/http/payment-links-endpoints.test.mjs` — template pending does not mark the link sent
- `public/app/sales-floor.html` / `sales-floor.js` — Sarah chip / fake cash / sample funnel gone; who from session
- `public/app/closer-call.html` / `closer-call.js` — Join stays disabled until `join_url`
- `src/sales/cockpit.mjs` — `join_url` from this client's meeting URL
- `src/http/crm-html.test.mjs` — lock tests for my-numbers, closer-dashboard, ops, affiliate, partner-galaxy

Did not change global `sendTemplated` `{ sent: true }`. SMS still queues until Monday / A2P.

**Verify:** `node --test src/http/crm-html.test.mjs src/http/payment-links-endpoints.test.mjs` + Playwright sales-dashboards

## Unit 2 closer-ui — dashboard + my-numbers manifest

**Status:** done for `closer-dashboard.html` and `my-numbers.html` / `my-numbers.js`.
**Owner:** closer-ui

Did not invent people. Missing = dash. Did not edit sales-floor, closer-call, client-portal, ops-admin, galaxy, data.js, calendar, or contracts.

**Files**
- `public/app/closer-dashboard.html` — header who is session staff from `GET /api/auth/session`, or a dash. Clock ticks live now (`America/New_York`), not Sun Jul 26. Without `?client_id=` the calculators hide and the page says “Open from a client.” With a client id, tradelines and lender-matches bind as before; deal math stays dashes, not SAMPLE fake dollars. Jordan Blake / Priya Nair / sample cards are gone from default HTML.
- `public/app/my-numbers.html` — header chip is a dash until paint; Elena Voss / Devon Marsh / Bianca Souza / Marcus Webb gone from seed HTML so a failed API cannot show them.
- `public/app/my-numbers.js` — binds session name or dash; replaces every team row and owed row from `GET /api/read/my-numbers`; empty is honest empty.
- `src/http/closer-ui-honest.test.mjs` — fails if those sample names return in default markup / paint path.
- `src/http/closer-dashboard-view.test.mjs` — default markup check is honest empty, not Capital One Spark.
- `e2e/sales-dashboards.spec.mjs` — session name Casey Reed; no Marcus/Elena/Devon/Bianca; closer dashboard without a client shows “Open from a client.”
- `e2e/lenders-inquiry-ops.spec.mjs` — lender-matches tile with a real client id.

**What a human sees**

Closer dashboard, no client id:
- Who: signed-in staff name, or —
- Clock: real now
- Calculators: “Open from a client.”

Closer dashboard, with `?client_id=`:
- Funding numbers from live tradelines, or dash
- Lender matches from live count, or dash
- Deal math: dash (no endpoint)

My numbers:
- Header chip: signed-in staff name, or —
- Team / owed / cash: live rows or honest empty / dash

Journeys: no new routes. Did not edit `-actual.md`.

**Verify:** `node --test src/http/closer-ui-honest.test.mjs src/http/closer-dashboard-view.test.mjs src/http/crm-html.test.mjs` pass. Playwright closer dashboard + my-numbers: 5/5.

## Unit 4 ops-aff — manifest

**Status:** done
**Owner:** ops-aff

Fake people are gone from ops-admin, affiliate, partner-galaxy, agent-editor, and the commissions ledger. Missing facts are a dash or an empty table. Staff rows were not deleted. No new backend.

**Files**
- `public/app/ops-admin.html` — static Jordan / Nina / Marcus / Sarah / Alvin / Dana pay and consent rows gone. Tables bind `GET /api/read/staff`. Empty = “No staff rows.” Comp and This Week stay a dash (no pay-rule API). Did not touch the live clock (unit 3).
- `public/app/affiliate.html` — `DKOWAL-000123` gone. Code is live `tracking_id` for this session or “No code yet.” Referral and payout tables start empty (“No referrals on file.” / “No payouts on file.”). Fake $367.68 banner and 342 clicks gone.
- `public/app/partner-galaxy.html` — Derek / Priya / fake $ swarm gone. `CLIENTS` and `NODES` are empty. Census is live `GET /api/read/partners` or “No partners on file.” Clock left as unit 3 live `America/New_York`. No new partner API.
- `public/app/agent-editor.html` — owner and escalate dropdowns are “Pick a person” then live staff.
- `public/app/products-commissions.html` — Jordan / Marcus LEDGER sample gone. Empty commissions API keeps an empty table (“No payouts on file.”).
- `src/http/crm-html.test.mjs` — fails if Derek Owusu / DKOWAL-000123 / Jordan Blake return as default furniture in these files.
- `e2e/ops-admin.spec.mjs` — waits for live staff This Week dashes; Nina / Marcus must not appear.

Did not edit client-portal, closer-dashboard, my-numbers, calendar, data.js. Did not delete staff rows.

**Verify:** `node --test src/http/crm-html.test.mjs` — pass 10 / fail 0

## Unit 6 inquiry-who — manifest

**Status:** done
**Owner:** this session

Alvin Torres was demo furniture on Inquiry Remover. The live page now paints the signed-in staff name from `GET /api/auth/session`. Empty queue zeros the tiles. Fake Equifax-down alert and Wei / Theresa / Felix letters are gone. Staff row `alvin@fundhub.ai` was not deleted.

**Files**
- `public/app/inquiry-remover.html` — session who-header; empty stats/letters/bureaus; no Alvin / Felix / Wei
- `public/app/closer-call.js` — funding-band notes are human, not builder copy
- `src/http/crm-html.test.mjs` — fails if Alvin / Wei / Felix / fake 93% pace return

**What a human sees**
- Name: signed-in person (Chris Stanbridge when Chris is signed in), or —
- Role: their real role (owner), not “Inquiry Remover · 93% pace”
- Queue / letters: empty until real rows exist
