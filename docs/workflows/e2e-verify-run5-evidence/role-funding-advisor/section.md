## role-funding-advisor (batch 2)

**Model:** claude-fable-5  ·  **Login:** advisor@fundhub.ai  ·  **Ran:** 2026-08-17T03:37:01Z (probe) / 2026-08-17T03:37:46Z (UI walk) / 2026-08-17T03:41:25Z (GET follow-up)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | login page shown; POST /api/auth/login 200, role=funding_advisor, token + cookie set | Login page rendered (email, password, Sign in). Login HTTP 200, ok=true, role=funding_advisor, token=true, cookie=true. /api/auth/session 200 role=funding_advisor. Browser sign-in left login.html; localStorage role=funding_advisor | route-probe.json login + shots/00-login-page.png, shots/01-landing.png | PASS |
| S1b landing | lands on command-center.html (shell HOME map: funding_advisor → command-center.html) | Landed at /app/command-center.html "Fundhub — Command Center". Header chip "TEST — Funding Advisor Role · funding_advisor · 24 tabs · LIVE". Pipeline summary and every stage counter render as "—"; Holds panel "no holds feed yet"; footer "9 cards updated · 2 agent(s) actually live · cash $0.01 · funded 0". No error banner. Sidebar already present (no shell fallback needed) | shots/01-landing.png, shots/02-app-shell.png, ui-walk.json landing | PASS |
| S2 reach: Signing in and out (intended 6, actual 6) | all 6 answer not 401/403/404 | /api/auth/login GET 200; /api/auth/session GET 200 (follow-up); 4 unverified (logout, magic-link, magic-link-verify, reset — write-only, not probed) | route-probe.md, extra-get-probe.json | PASS (2/2 probed) · 4 UNVERIFIED |
| S2 reach: banking (intended 1, actual 1) | 1 route not 401/403/404 | /api/banking/accounts GET 400 client_id required (reachable) | route-probe.md | PASS |
| S2 reach: Campaigns (intended 6, actual 8) | all 8 not 401/403/404 | 6/6 probed OK (all 400 partner_id_required — reachable), 2 unverified (sync, write — write-only) | route-probe.md | PASS · 2 UNVERIFIED |
| S2 reach: chat (intended 0, actual 3) | all 3 not 401/403/404 | /api/chat/messages 200, /api/chat/peers 200; 1 unverified (chat/ask POST) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: climate (intended 0, actual 2) | 2 not 401/403/404 | /api/climate/config GET 200 (follow-up); geocode unverified (OPTIONS only) | extra-get-probe.json | PASS (1/1 probed) · 1 UNVERIFIED |
| S2 reach: consent (intended 1, actual 1) | 1 not 401/403/404 | /api/consent/capture GET 400 client_id must be a uuid (reachable) | route-probe.md | PASS |
| S2 reach: contracts (intended 1, actual 1) | /api/contracts/sign not 401/403/404 | GET 404 not_found without a signed link — the handler answers 404 for any missing/bad link by design (api/contracts/sign.mjs GONE). Not provable without a real signed link | route-probe.md | UNVERIFIED |
| S2 reach: Creative Factory (intended 4, actual 7) | all 7 not 401/403/404 | 4/4 probed OK (400 partner_id_required — reachable), 3 unverified (actions, generate, run — write-only) | route-probe.md | PASS · 3 UNVERIFIED |
| S2 reach: The dashboard (intended 4, actual 6) | all 6 not 401/403/404 | probe skipped all 6 (no method listed). GET follow-up: kpis 200, clients 200 (27 rows), pipeline 200 (10 stages), client 400 "?id= required" — 4/4 reachable; seed + client-archive unverified (write) | extra-get-probe.json, payload-shapes.md | PASS (4/4 probed) · 2 UNVERIFIED |
| S2 reach: Documents (intended 1, actual 1) | /api/documents/:id not 401/403/404 | not probed (HEAD on a signed link; no link) | route-probe.md | UNVERIFIED |
| S2 reach: Finance (intended 5, actual 5) | all 5 not 401/403/404 | alerts 200; entities, liabilities, soft-pull 400 (need client_id — reachable); model unverified (POST) | route-probe.md | PASS (4/4 probed) · 1 UNVERIFIED |
| S2 reach: proxy (intended 0, actual 2) | /api/proxy/launch, /api/proxy/end not 401/403/404 | both POST-only, not probed (no production writes). Companion read /api/read/proxy-sessions GET 200 items:array(0) | route-probe.md, payload-shapes.md | UNVERIFIED (2/2) |
| S2 reach: public (intended 0, actual 3) | all 3 not 401/403/404 | partner-page GET 400 (needs id/slug — reachable); partner-apply, survey-submit unverified (POST) | route-probe.md | PASS (1/1 probed) · 2 UNVERIFIED |
| S2 reach: Reading data (intended 19, actual 36) | all 36 not 401/403/404 | 33/34 probed OK (200 or 400-needs-client_id). 1 FAIL: /api/read/my-numbers GET 403 "forbidden" — handler has a second gate after ROLE_SETS.STAFF that allows only closer or FINANCE roles (api/read/my-numbers.mjs L42-48). 2 unverified (company-brain POST, finance-ask POST) | route-probe.md, extra-get-probe.json | FAIL (LOW) — 1/34 · 2 UNVERIFIED |
| S2 reach: repair (intended 0, actual 2) | /api/repair/exceptions, /api/repair/send not 401/403/404 | /api/repair/exceptions GET 403 "role_forbidden" — handler is owner/admin only (api/repair/exceptions.mjs L9-25); -actual.md says "staff". repair/send unverified (POST) | route-probe.md | FAIL (LOW) — 1/1 · 1 UNVERIFIED |
| S2 reach: social (intended 0, actual 3) | all 3 not 401/403/404 | none probed (oauth no method; publish, schedule POST) | route-probe.md | UNVERIFIED (3/3) |
| S2 reach: Everything else (intended 11, actual 23) | all 23 not 401/403/404 | 8/8 probed OK: applications 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200 (63 rows), inquiries 400, health 200 (follow-up); 15 unverified (POST-only: agents, ai-bureau-config, call-outcomes, contracts, customer-insights, documents-upload, inquiry-cases, lender-observations, lenders, message-templates, messages, messages-outbound, pipeline-cards; climate OPTIONS; inngest signed) | route-probe.md, extra-get-probe.json | PASS (8/8 probed) · 15 UNVERIFIED |
| S2 reach: Incoming webhooks (intended 1, actual 1) | /api/webhooks/:provider reachable | not probed (provider signature) | route-probe.md | UNVERIFIED |
| S3 blocked: Signing in and out (intended 1, actual 3) | admin-reset, invite, suspend → 403 | 3/3 POST {} → 403 forbidden | route-probe.md | PASS |
| S3 blocked: banking (intended 2, actual 2) | revoke, sync-accounts → 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: chat (intended 0, actual 1) | chat/portal-message → 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: company-brain (intended 0, actual 2) | reviews, sync → 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: demo (intended 0, actual 2) | demo/mode, demo/simulate → 403 | 2/2 → 403 (GET mode, POST {} simulate; DELETE not probed) | route-probe.md | PASS |
| S3 blocked: Finance (intended 5, actual 5) | bank-accounts, bills, cards, cashflow, subscriptions → 403 | 5/5 → 403 | route-probe.md | PASS |
| S3 blocked: Hiring (intended 6, actual 6) | all 6 hiring/* → 403 | 6/6 → 403 | route-probe.md | PASS |
| S3 blocked: journeys (intended 2, actual 2) | journeys/ask, journeys/run → 403 (the bare /api/journeys row is grouped under Everything else) | 2/2 POST {} → 403 | route-probe.md | PASS |
| S3 blocked: partner-brand (intended 0, actual 1) | verify-domain → 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: privacy (intended 1, actual 1) | privacy/erasure → 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: Reading data (intended 7, actual 10) | affiliates, banking-surface, closer-deck, commissions, company-brain-affiliate, failed-events, invoices, partners, sales-floor, staff → 403 | 10/10 → 403 | route-probe.md | PASS |
| S3 blocked: staff (intended 0, actual 2) | monitoring-consent, telemetry → 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: Everything else (intended 4, actual 8) | closer-deck, inquiry, journeys, marketing-flags, partner-brand, partner-pages, payment-links, products → 403 | 7/7 probed → 403 (journeys GET, closer-deck POST, marketing-flags POST, partner-brand GET, partner-pages GET, payment-links GET, products POST); /api/inquiry skipped by probe (no method listed) — GET follow-up: /api/inquiry and /api/inquiry?action=cases → 403 forbidden | route-probe.md, extra-get-probe-inquiry.json | PASS (8/8) |
| S4 not signed in | 401 on reach routes with no token | 6/6 sampled → 401 (applications, banking/accounts, campaigns/action-log, connections, detail, fatigue) | route-probe.md "Not signed in" | PASS |
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 25 visible / 34 sidebar links; 24 distinct screens opened, HTTP 200, 0 bounced. 24/24 had ≥1 API 4xx. Distinct failing endpoints: GET /api/demo/mode → 403 (all 24 screens + login + landing); GET /api/read/staff → 403 (ops-admin, agent-editor, staff-teams); GET /api/read/invoices → 403, GET /api/read/failed-events → 403, GET /api/read/messages?status=blocked → 400 (ops-admin); GET /api/read/commissions → 403 (products-commissions); GET /api/campaigns/{spend,list,action-log,connections,fatigue} → 400 (campaign-manager). No 5xx. | ui-walk.md, ui-walk.json, shots/03..26 | FAIL (MEDIUM) |

### Failure blocks (capped)

**role-funding-advisor · S5 UI walk — /api/demo/mode 403 on every screen (MEDIUM)**
- Expected: a reachable screen makes no forbidden API calls.
- Observed: the shared shell calls GET /api/demo/mode on every one of the 24 screens (and on login + landing). The route is owner/admin-only, so a funding_advisor gets 403 every page load; one console error per screen. No visible banner on most screens. The sidebar also shows "Demo Mode" (sample-data.html) to this role: the page renders "Turn Demo Mode ON / OFF / Wipe demo data" buttons and a red "this endpoint is limited to owner, admin" line. Buttons were not clicked; probe confirms GET/POST on demo/* → 403.
- Evidence: ui-walk.md (API 4xx column, all rows), ui-walk.json login.apiFails, shots/26-sample-data.html.png, route-probe.md (demo rows).

**role-funding-advisor · S5 UI walk — Ops & Admin screen half-works (MEDIUM)**
- Expected: ops-admin.html loads its panels without forbidden calls.
- Observed: GET /api/read/staff → 403, /api/read/invoices → 403, /api/read/failed-events → 403, /api/read/messages?status=blocked&limit=30 → 400. Screen shows KPIs as "—", "No unpaid invoices loaded — needs an AR read endpoint", "Loading blocked messages…" (never resolves), footer strip "sample compliance blocks — the request was rejected · sample staff tables — not signed in for real data · sample AR table — not signed in for real data" although the user is signed in.
- Evidence: shots/16-ops-admin.html.png, ui-walk.md row ops-admin.

**role-funding-advisor · S5 UI walk — Staff & Teams / Agent Editor / Products & Commissions call owner-only reads (MEDIUM)**
- Expected: screens offered in the sidebar do not call endpoints this role is blocked from.
- Observed: GET /api/read/staff → 403 on staff-teams.html and agent-editor.html; GET /api/read/commissions → 403 on products-commissions.html. staff-teams shows Headcount 0, "No one matches that filter", footer "sample roster — not signed in for real data". products-commissions shows the live product ladder (5 products) but footer "sample commission ledger — not signed in for real data". agent-editor renders 22 real agents; footer "sample agent owners — not signed in for real data".
- Evidence: shots/24-staff-teams.html.png, shots/25-products-commissions.html.png, shots/17-agent-editor.html.png, ui-walk.md.

**role-funding-advisor · S5 UI walk — Campaigns screen sends no partner_id (LOW)**
- Expected: campaign-manager.html loads live campaign data or a clear empty state.
- Observed: five GETs (/api/campaigns/spend, list, action-log, connections, fatigue) → 400 partner_id_required. Screen shows sample book "Ironwood Capital Group" with KPI tiles ($964.30 spend today, 3/11 live, ROAS 1.33) while the per-panel source table and footer label every panel "badrequest — request rejected (staff se…)". Numbers on screen are sample furniture, not live.
- Evidence: shots/20-campaign-manager.html.png, ui-walk.md row campaign-manager.

**role-funding-advisor · S2 reach: Reading data — /api/read/my-numbers 403 (LOW + DOC-GAP)**
- Expected (per -actual.md): funding_advisor is in the allowed list → not 403.
- Observed: GET 403 {error:"forbidden", message:"My numbers is for closers."}. Code: api/read/my-numbers.mjs passes ROLE_SETS.STAFF then a second gate allows only role=closer or FINANCE roles. The generator reads only the first gate. Sidebar correctly hides "My numbers" for this role, so no user-visible impact.
- Evidence: route-probe.md "Failures — should reach", api/read/my-numbers.mjs L42-48.

**role-funding-advisor · S2 reach: repair — /api/repair/exceptions 403 (LOW + DOC-GAP)**
- Expected (per -actual.md): gate "staff" → not 403.
- Observed: GET 403 {error:"role_forbidden"}. Code: api/repair/exceptions.mjs ALLOWED = owner, admin (+SUPER_ROLES). -actual.md row is wrong for every non-owner/admin staff role.
- Evidence: route-probe.md "Failures — should reach", api/repair/exceptions.mjs L9-25.

### Doc gaps (intended vs actual)

- Reach totals: intended 60 routes across 12 groups; actual 111 routes across 18 groups. Intended file is stale vs code.
- Reach group counts differ: Campaigns 6 → 8; Creative Factory 4 → 7; The dashboard 4 → 6; Reading data 19 → 36; Everything else 11 → 23.
- Reach groups in actual but missing from intended: chat (3), climate (2), proxy (2 — the role-defining /api/proxy/launch and /api/proxy/end), public (3), repair (2), social (3).
- Blocked totals: intended 28 across 8 groups; actual 45 across 13 groups.
- Blocked group counts differ: Signing in and out 1 → 3; Reading data 7 → 10; Everything else 4 → 8.
- Blocked groups in actual but missing from intended: chat (1), company-brain (2), demo (2), partner-brand (1), staff (2).
- -actual.md itself is wrong on two rows (generator reads only the first gate): /api/read/my-numbers is closer/FINANCE-only in code (live 403 for funding_advisor); /api/repair/exceptions is owner/admin-only in code (live 403). Both are listed as reachable.
- No UI-level ground truth exists in either file (landing screen, sidebar contents, which screens the role should see). The S1b/S5 rows are graded against public/app/shell.js HOME/ROLE_TABS, not against the intended journey.
