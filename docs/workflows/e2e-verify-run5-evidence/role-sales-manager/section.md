## role-sales-manager (batch 2)

**Model:** claude-fable-5  ·  **Login:** sales@fundhub.ai  ·  **Ran:** 2026-08-17T03:37:02Z (probe) / 2026-08-17T03:37:46Z (UI walk)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/role-sales-manager/

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | POST /api/auth/login 200, ok=true, staff.role=sales_manager, token + fundhub_session cookie; /api/auth/session 200 role=sales_manager | HTTP 200, ok=true, role=sales_manager, token=true, cookie=true; session 200 role=sales_manager. Browser: left login.html, localStorage fh_role=sales_manager | route-probe.json login + shots/00-login-page.png, shots/01-landing.png | PASS |
| S1b landing | lands on /app/sales-floor.html (shell.js HOME.sales_manager) | Landed at /app/sales-floor.html ("Sales floor · Fundhub"). Screen shows live sales-floor data: Cash collected $5, funnel 0 booked / 5 held / 0 deposits / 0 funded / 5 downsells, 1 closer row (Chris Stanbridge, off shift), header chip "TEST — Sales Manager Role · sales_manager · 25 tabs LIVE". No error banner. Only API 4xx on landing: GET /api/demo/mode 403 (shell demo-banner poll) | shots/01-landing.png, shots/02-app-shell.png, ui-walk.json landing | PASS |
| S2 reach: Signing in and out (intended 6, actual 6) | all 6 routes answer not 401/403/404 | 1/1 probed OK (GET /api/auth/login 200), 5 unverified (write-only / no GET) | route-probe.md | PASS (partial) |
| S2 reach: banking (intended 2, actual 2) | all 2 routes answer not 401/403/404 | 1/1 probed OK (GET /api/banking/accounts 400 client_id required = gate passed), 1 unverified (sync-accounts POST) | route-probe.md | PASS (partial) |
| S2 reach: Campaigns (intended 6, actual 8) | all 8 routes answer not 401/403/404 | 6/6 probed OK (all 400 partner_id_required = gate passed), 2 unverified (sync, write POST) | route-probe.md | PASS (partial) |
| S2 reach: chat (intended 0, actual 3) | all 3 routes answer not 401/403/404 | 2/2 probed OK (messages 200, peers 200), 1 unverified (ask POST) | route-probe.md | PASS (partial) |
| S2 reach: climate (intended 0, actual 2) | all 2 routes answer not 401/403/404 | 0 probed, 2 unverified (OPTIONS / no method) | route-probe.md | UNVERIFIED |
| S2 reach: company-brain (intended 0, actual 1) | route answers not 401/403/404 | 1/1 probed OK (GET /api/company-brain/sync 200) | route-probe.md | PASS |
| S2 reach: contracts (intended 1, actual 1) | /api/contracts/sign answers not 401/403/404 | GET /api/contracts/sign without id/exp/sig -> 404 not_found. Code (api/contracts/sign.mjs) returns an undifferentiated 404 for any missing/forged signed link by design; probe carried no link. Not a role gate | route-probe.md | UNVERIFIED (probe cannot carry a signed link) |
| S2 reach: Creative Factory (intended 4, actual 7) | all 7 routes answer not 401/403/404 | 4/4 probed OK (all 400 partner_id_required = gate passed), 3 unverified (actions, generate, run POST) | route-probe.md | PASS (partial) |
| S2 reach: The dashboard (intended 4, actual 6) | all 6 routes answer not 401/403/404 | 0 probed, 6 unverified (no GET method listed) | route-probe.md | UNVERIFIED |
| S2 reach: Documents (intended 1, actual 1) | /api/documents/:id answers not 401/403/404 | 0 probed, 1 unverified (HEAD, signed link) | route-probe.md | UNVERIFIED |
| S2 reach: Finance (intended 9, actual 9) | all 9 routes answer not 401/403/404 | 8/8 probed OK (alerts 200; 7 others 400 client_id must be uuid = gate passed), 1 unverified (model POST) | route-probe.md | PASS (partial) |
| S2 reach: journeys (intended 1, actual 1) | /api/journeys/run answers not 401/403/404 | 0 probed, 1 unverified (POST only) | route-probe.md | UNVERIFIED |
| S2 reach: public (intended 0, actual 3) | all 3 routes answer not 401/403/404 | 1/1 probed OK (partner-page 400 = reachable), 2 unverified (POST) | route-probe.md | PASS (partial) |
| S2 reach: Reading data (intended 25, actual 43) | all 43 routes answer not 401/403/404 | 37/38 probed OK, 5 unverified (agent-context, agent-shadow-log, company-brain POST, finance-ask POST, tradelines). 1 FAIL: GET /api/read/banking-surface -> 403 "banking surface requires plaid configuration" (role gate passed; Plaid feature switch off — same answer for every role). Role-defining routes: /api/read/sales-floor 200 (hero, funnel, closers[1], beliefs, recordings, compliance, cold_deals[]), /api/read/commissions 200 (items[0]), /api/read/staff 200 (items[1]), /api/read/my-numbers 200 (owed[10]) | route-probe.md; shape notes in this section | FAIL (1 of 38) — see block |
| S2 reach: repair (intended 0, actual 2) | both routes answer not 401/403/404 | 0/1 probed OK: GET /api/repair/exceptions -> 403 role_forbidden. Code (api/repair/exceptions.mjs line 9-23) has an inner gate ALLOWED = owner, admin, SUPER_ROLES(owner) after requirePrincipal(["staff"]); -actual.md lists the gate as "staff". 1 unverified (send POST) | route-probe.md | FAIL — see block |
| S2 reach: social (intended 0, actual 3) | all 3 routes answer not 401/403/404 | 0 probed, 3 unverified (oauth no method, publish/schedule POST) | route-probe.md | UNVERIFIED |
| S2 reach: staff (intended 0, actual 1) | /api/staff/telemetry answers not 401/403/404 | 1/1 probed OK (400 staff_id must be uuid = gate passed) | route-probe.md | PASS |
| S2 reach: Everything else (intended 11, actual 25) | all 25 routes answer not 401/403/404 | 7/7 probed OK (applications 400, org-brand 200, payment-links 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200, health/inquiries counted under other rows), 18 unverified (POST-only or no method) | route-probe.md | PASS (partial) |
| S2 reach: Incoming webhooks (intended 1, actual 1) | /api/webhooks/:provider | 0 probed, 1 unverified (provider signature) | route-probe.md | UNVERIFIED |
| S3 blocked: Signing in and out (intended 1, actual 3) | all 3 answer 403 | 3/3 -> 403 (admin-reset, invite, suspend) | route-probe.md | PASS |
| S3 blocked: banking (intended 1, actual 1) | 403 | 1/1 -> 403 (revoke) | route-probe.md | PASS |
| S3 blocked: chat (intended 0, actual 1) | 403 | 1/1 -> 403 (portal-message) | route-probe.md | PASS |
| S3 blocked: company-brain (intended 0, actual 1) | 403 | 1/1 -> 403 (reviews) | route-probe.md | PASS |
| S3 blocked: consent (intended 1, actual 1) | 403 | 1/1 -> 403 (capture) | route-probe.md | PASS |
| S3 blocked: demo (intended 0, actual 2) | 403 | 2/2 -> 403 (mode GET, simulate POST) | route-probe.md | PASS |
| S3 blocked: Finance (intended 1, actual 1) | 403 | 1/1 -> 403 (soft-pull) | route-probe.md | PASS |
| S3 blocked: Hiring (intended 6, actual 6) | all 6 answer 403 | 6/6 -> 403 | route-probe.md | PASS |
| S3 blocked: journeys (intended 1, actual 1) | 403 | 1/1 -> 403 (/api/journeys/ask POST) | route-probe.md | PASS |
| S3 blocked: partner-brand (intended 0, actual 1) | 403 | 1/1 -> 403 (verify-domain) | route-probe.md | PASS |
| S3 blocked: privacy (intended 1, actual 1) | 403 | 1/1 -> 403 (erasure) | route-probe.md | PASS |
| S3 blocked: proxy (intended 0, actual 2) | 403 | 2/2 -> 403 (end, launch) | route-probe.md | PASS |
| S3 blocked: Reading data (intended 1, actual 3) | all 3 answer 403 | 3/3 -> 403 (company-brain-affiliate, failed-events, proxy-sessions) | route-probe.md | PASS |
| S3 blocked: staff (intended 0, actual 1) | 403 | 1/1 -> 403 (monitoring-consent) | route-probe.md | PASS |
| S3 blocked: Everything else (intended 4, actual 6) | all 6 answer 403 | 5/5 -> 403 (ai-bureau-config POST, journeys GET, partner-brand GET, partner-pages GET, pii GET); 1 unverified (/api/inquiry — no GET/POST method to probe safely) | route-probe.md | PASS (1 unverified) |
| S4 not signed in | 401 on reach routes without a token | 6/6 -> 401 (applications, banking/accounts, campaigns action-log/connections/detail/fatigue) | route-probe.md "Not signed in" | PASS |
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 25 screens opened, 0 bounced, 25 with API 4xx: (a) GET /api/demo/mode -> 403 on ALL 25 screens (shell.js mountDemoBanner polls an owner/admin-only endpoint for every staff role; handled silently, console error only); (b) ops-admin.html: GET /api/read/failed-events -> 403 and GET /api/read/messages?status=blocked -> 400 (screen shows "Loading blocked messages..." stuck + "request was rejected"); (c) campaign-manager.html: 5x 400 partner_id_required (fatigue, spend, list, action-log, connections) — screen shows sample furniture with "badrequest" pills; (d) sample-data.html (Demo Mode) visible in sidebar, shows "this endpoint is limited to owner, admin". Sidebar: 26 visible / 34 total (hidden: closer-call, my-numbers, subscriptions, journeys, hiring, brand-studio, client-portal, affiliate) | ui-walk.md, shots/03..27 | FAIL (MEDIUM x2, LOW x2) — see blocks |

### Failure blocks (capped)

**role-sales-manager · S2 reach: repair** — MEDIUM
- Expected: GET /api/repair/exceptions answers not 401/403/404 (-actual.md gate: "staff").
- Observed: 403 `role_forbidden` for sales_manager.
- Cause (code, read only): api/repair/exceptions.mjs line 9 `ALLOWED = new Set(["owner","admin",...SUPER_ROLES])`; SUPER_ROLES = ["owner"] (src/http/middleware/requireRole.mjs line 17). Inner gate is owner/admin only; the generator only saw `requirePrincipal(req,res,["staff"])`.
- The -actual.md row is wrong and its "UNVERIFIED: None — every route's gate was traced" claim is contradicted. Whether sales_manager should reach it is undecided (intended file has no repair group).
- Evidence: docs/workflows/e2e-verify-run5-evidence/role-sales-manager/route-probe.md (row `/api/repair/exceptions`), route-probe.json.

**role-sales-manager · S2 reach: Reading data (banking-surface)** — LOW
- Expected: GET /api/read/banking-surface answers not 401/403/404 (gate: owner, admin, sales_manager).
- Observed: 403 `banking surface requires plaid configuration`.
- Cause: api/read/banking-surface.mjs line 72-74 returns 403 when `isPlaidEnabled()` is false; role gate (ROLE_SETS.FINANCE) was passed first. Same answer for every role on live. Config switch, not a role gate; -actual.md does not mention it.
- Evidence: route-probe.md (row `/api/read/banking-surface`).

**role-sales-manager · S5 UI walk: ops-admin.html** — MEDIUM
- Expected: screen opens without forbidden/failed API calls.
- Observed: GET /api/read/failed-events?status=pending&limit=200 -> 403 (owner/admin only); GET /api/read/messages?status=blocked&limit=30 -> 400 invalid_parameter. Screen: "Compliance gate" panel stuck on "Loading blocked messages...", footer "sample compliance blocks — the request was rejected", KPIs all "—". Half-works for this role.
- Evidence: shots/17-ops-admin.html.png, ui-walk.md row "Ops & Admin".

**role-sales-manager · S5 UI walk: sample-data.html (Demo Mode)** — MEDIUM
- Expected: a sidebar row the role can see opens a working screen.
- Observed: sidebar shows "Demo Mode" to sales_manager; screen calls GET /api/demo/mode -> 403 twice and prints "this endpoint is limited to owner, admin"; counts panel "—". Screen self-labels "Owner-only" yet is offered to this role.
- Evidence: shots/27-sample-data.html.png, ui-walk.md row "Demo Mode".

**role-sales-manager · S5 UI walk: /api/demo/mode 403 on every screen** — LOW
- Expected: no forbidden API call per screen.
- Observed: shell.js mountDemoBanner (line 1582) fetches /api/demo/mode for every staff role; endpoint is owner/admin only (api/demo/mode). 403 on all 25 screens + login. Handled (`r.ok ? ... : null`), so no visible break; one console error per screen. Cosmetic.
- Evidence: ui-walk.md (every row), ui-walk.json login.apiFails.

**role-sales-manager · S5 UI walk: campaign-manager.html** — LOW
- Expected: screen loads live data.
- Observed: 5x 400 partner_id_required (staff sessions must pass ?partner_id=); screen shows sample furniture (spend 964.30, 3/11 live) with "badrequest" pills and a "Beta" banner. Screen sends an incomplete query for a staff session.
- Evidence: shots/21-campaign-manager.html.png, ui-walk.md row "Campaigns".

### Doc gaps (intended vs actual)

- Intended totals 71 reach / 17 blocked vs actual 125 reach / 31 blocked (156 routes). Intended is stale vs code.
- Reach count mismatches: Campaigns 6 vs 8; Creative Factory 4 vs 7; The dashboard 4 vs 6; Reading data 25 vs 43; Everything else 11 vs 25.
- Reach groups only in actual (missing from intended): chat (3), climate (2), company-brain (1), public (3), repair (2), social (3), staff (1).
- Blocked count mismatches: Signing in and out 1 vs 3; Reading data 1 vs 3; Everything else 4 vs 6.
- Blocked groups only in actual (missing from intended): chat (1), company-brain (1), demo (2), partner-brand (1), proxy (2), staff (1).
- -actual.md gate for `/api/repair/exceptions` says "staff"; code enforces owner/admin (inner gate). Live 403 for sales_manager. The file's "UNVERIFIED: None" is therefore inaccurate.
- -actual.md lists `/api/read/banking-surface` as reachable by sales_manager without noting the Plaid feature switch that returns 403 on live.
- Sidebar (shell.js) shows sample-data.html (Demo Mode) and ops-admin.html to sales_manager, but their data endpoints (/api/demo/mode, /api/read/failed-events) are owner/admin only in -actual.md "blocked" — UI surface and API gates disagree.

### Payload shapes (role-defining GETs, read-only)

- /api/read/sales-floor -> 200 (2455 bytes): {ok, period, hero{cash_cents...}, funnel{booked,held,deposits,funded,downsells}, closers[1], beliefs, recordings{items[]}, compliance{available:false}, cold_deals[], discipline}
- /api/read/commissions -> 200 (70 bytes): {ok, count, limit, offset, hasMore, items[0]} — empty
- /api/read/staff -> 200 (397 bytes): {ok, count, ..., items[1]}
- /api/read/my-numbers -> 200 (4180 bytes): {ok, period, staff_id, shift, pace, month, money, team[], owed[10]}
