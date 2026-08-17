## role-owner (batch 1)

**Model:** claude-fable-5  ·  **Login:** owner@fundhub.ai  ·  **Ran:** 2026-08-17T04:01:09Z (probe) / 2026-08-17T04:01:48Z (UI walk) / 2026-08-17T04:06:12Z (GET follow-up)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/role-owner/

Login budget: 3 logins total (probe, UI walk, GET follow-up). No rate limit hit. Nothing clicked except sidebar links; no bodies sent to any reachable route; only an empty `{}` POST to the 2 blocked routes.

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | login page shown; POST /api/auth/login 200, role=owner, token + cookie set | Login page rendered. Login HTTP 200, ok=true, role=owner, token=true, cookie=true. /api/auth/session 200 role=owner (principal:string, staff:object). Browser sign-in left login.html with 0 API failures; localStorage role=owner | route-probe.json login · shots/00-login-page.png · shots/01-landing.png | PASS |
| S1b landing | lands on command-center.html (shell.js HOME.owner) | Landed at /app/command-center.html "Fundhub — Command Center". Header chip "TEST — Owner Role · owner · 34 tabs · LIVE". No API 4xx/5xx, no console errors on load. Sidebar present at once (no shell fallback) | shots/01-landing.png · shots/02-app-shell.png · ui-walk.json landing | PASS |
| S1c not signed in | 401 on sampled reach routes | 6/6 → 401 (applications, banking/accounts, banking/revoke, campaigns/action-log, connections, detail) | route-probe.md "Not signed in" | PASS |
| S2 reach: Signing in and out (intended 7, actual 9) | not 401/403/404 | 2/2 probed OK (login GET 200; session GET 200 follow-up) · 7 UNVERIFIED (admin-reset, invite, logout, magic-link, magic-link-verify, reset, suspend — write-only) | route-probe.md · extra-get-probe.json | PASS · 7 UNVERIFIED |
| S2 reach: banking (intended 3, actual 3) | not 401/403/404 | 2/2 probed OK (accounts 400, revoke 400 — need client_id, reachable) · 1 UNVERIFIED (sync-accounts POST) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: Campaigns (intended 6, actual 8) | not 401/403/404 | 6/6 probed OK (all 400 partner_id_required — reachable) · 2 UNVERIFIED (sync, write) | route-probe.md | PASS · 2 UNVERIFIED |
| S2 reach: chat (intended 0, actual 3) | not 401/403/404 | 2/2 OK (messages 200, peers 200) · 1 UNVERIFIED (ask POST) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: climate (intended 0, actual 2) | not 401/403/404 | climate 200 (follow-up), climate/config 200 (follow-up), geocode GET 405 method_not_allowed (route exists; POST-only) | extra-get-probe.json | PASS |
| S2 reach: company-brain (intended 0, actual 2) | not 401/403/404 | reviews 200, sync 200 (2/2) | route-probe.md | PASS |
| S2 reach: consent (intended 1, actual 1) | not 401/403/404 | capture GET 400 client_id must be a uuid (reachable) | route-probe.md | PASS |
| S2 reach: contracts (intended 1, actual 1) | contracts/sign not 401/403/404 | GET 404 not_found without a signed link — handler answers 404 for any missing/bad link by design (api/contracts/sign.mjs); not a role gate; not provable without a real link | route-probe.md | UNVERIFIED |
| S2 reach: Creative Factory (intended 4, actual 7) | not 401/403/404 | 4/4 probed OK (400 partner_id_required) · 3 UNVERIFIED (actions, generate, run) | route-probe.md | PASS · 3 UNVERIFIED |
| S2 reach: The dashboard (intended 4, actual 6) | not 401/403/404 | probe skipped all 6 (no method column). GET follow-up: kpis 200 {ok,kpis,display}, clients 200 (27 rows), pipeline 200 (10 stages), client 400 "?id= required" — 4/4 reachable · 2 UNVERIFIED (seed, client-archive — write) | extra-get-probe.json | PASS · 2 UNVERIFIED |
| S2 reach: demo (intended 0, actual 2) | not 401/403/404 | demo/mode GET 200 · 1 UNVERIFIED (simulate — POST/DELETE only) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: Documents (intended 1, actual 1) | not 401/403/404 | not probed (HEAD on a signed link; no link) | route-probe.md | UNVERIFIED |
| S2 reach: Finance (intended 10, actual 10) | not 401/403/404 | 9/9 probed OK (alerts 200; bank-accounts, bills, cards, cashflow, entities, liabilities, soft-pull, subscriptions 400 need client_id) · 1 UNVERIFIED (model POST) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: Hiring (intended 6, actual 6) | not 401/403/404 | 6/6 OK (bench, candidates, decisions, funnel, postings 200; application 400 bad_request without id). Follow-up: candidates items(3), postings items(1), decisions items(0), bench items(3) | route-probe.md · extra-get-probe.json | PASS |
| S2 reach: journeys (intended 2, actual 2) | not 401/403/404 | both POST-only (ask, run) — not probed. Companion GET /api/journeys 200 (Everything else) | route-probe.md | UNVERIFIED (2/2) |
| S2 reach: partner-brand (intended 0, actual 1) | not 401/403/404 | verify-domain POST-only — not probed | route-probe.md | UNVERIFIED |
| S2 reach: privacy (intended 1, actual 1) | not 401/403/404 | erasure GET 200 | route-probe.md | PASS |
| S2 reach: proxy (intended 0, actual 2) | not 401/403/404 | launch, end POST-only — not probed. Companion /api/read/proxy-sessions GET 200 | route-probe.md | UNVERIFIED (2/2) |
| S2 reach: public (intended 0, actual 3) | not 401/403/404 | partner-page GET 400 (needs id/slug — reachable) · 2 UNVERIFIED (partner-apply, survey-submit POST) | route-probe.md | PASS · 2 UNVERIFIED |
| S2 reach: Reading data (intended 26, actual 45) | not 401/403/404 (owner never 403) | 42/43 probed OK (200, or 400 needs client_id/param). 1 FAIL: /api/read/banking-surface GET 403 "banking surface requires plaid configuration" — role gate passed; 403 is the not-configured branch (api/read/banking-surface.mjs:72-74), same with a client_id (follow-up). 2 UNVERIFIED (company-brain POST, finance-ask POST). Owner-only reads that other roles got 403 on all answer 200 here: staff, invoices, failed-events, commissions, my-numbers, repair/exceptions | route-probe.md · extra-get-probe.json | FAIL (LOW) — 1/43 · 2 UNVERIFIED |
| S2 reach: repair (intended 0, actual 2) | not 401/403/404 | exceptions GET 200 · 1 UNVERIFIED (send POST) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: social (intended 0, actual 3) | not 401/403/404 | oauth GET 400 invalid_channel (follow-up — reachable) · 2 UNVERIFIED (publish, schedule POST) | extra-get-probe.json | PASS · 2 UNVERIFIED |
| S2 reach: staff (intended 0, actual 2) | not 401/403/404 | telemetry GET 400 staff_id must be a uuid (reachable) · 1 UNVERIFIED (monitoring-consent POST) | route-probe.md | PASS · 1 UNVERIFIED |
| S2 reach: Everything else (intended 15, actual 31) | not 401/403/404/5xx | 13/14 probed OK (applications, inquiries, partner-brand, partner-pages, payment-links, pii, soft-pull-approve, telemetry-style 400s; journeys, org-brand, shifts, tasks, climate, health 200). 1 FAIL: /api/inquiry GET 503 not_configured "INQUIRY_API_SECRET is not set" (api/inquiry.mjs:31-41) — past the role gate; owner-set 2026-08-15: phone inquiry remover ON HOLD. 17 UNVERIFIED (write-only: agents, ai-bureau-config, call-outcomes, closer-deck, contracts, customer-insights, documents-upload, inngest, inquiry-cases, lender-observations, lenders, marketing-flags, message-templates, messages, messages-outbound, pipeline-cards, products) | route-probe.md · extra-get-probe.json | PASS (partial) — 1 known 503 · 17 UNVERIFIED |
| S2 reach: Incoming webhooks (intended 1, actual 1) | — | webhooks/:provider — provider-signed, not probed | route-probe.md | UNVERIFIED |
| S3 blocked (intended 0 groups, actual 2 routes: chat 1, Reading data 1) | 403 | /api/chat/portal-message POST {} → 403 forbidden; /api/read/company-brain-affiliate POST {} → 403 forbidden (2/2). Task brief said "nothing to block" — -actual.md lists these 2 (client-only / affiliate+partner-only) and both hold | route-probe.md | PASS |
| S4 UI: landing screen detail | Command Center loads its data without forbidden/failed API calls; no controls the owner cannot use | 0 API 4xx/5xx, 0 console errors. Footer "live agent registry · 9 cards updated · 2 agent(s) actually live · live KPIs · cash $0.01 · funded 0". BUT the headline pane CC-01 Pipeline Summary ("— active clients · — moved forward today"), every stage counter in rails R-01..R-06, and CC-02 Holds ("Holds — no holds feed yet") are static "—" markup — nothing in command-center.html writes to .stage-count or the holds panel (only KPI tiles L1343 and the agent registry L1358 are wired). No forbidden controls; the only buttons are "Open the board ↗" links | shots/01-landing.png · ui-walk.json landing · public/app/command-center.html:761-800,1343-1358 | PASS (partial) — MEDIUM finding below |
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 34 visible / 34 links (matches ROLE_TABS.owner="*"; chip says 34 tabs). 34 screens opened, 0 bounced, 0 forbidden (403) calls. Failing endpoints: ops-admin.html GET /api/read/messages?status=blocked → 400 (1); campaign-manager.html 5× GET /api/campaigns/* → 400 partner_id_required. Console: hiring.html pageerror "Cannot read properties of null (reading 'length')" (board never renders, footer stuck "loading hiring…"); staff-teams.html footer strip shows "[object Promise]". 30/34 screens clean | ui-walk.md · shots/03..35 | PASS (partial) — 4 screens with findings |

### Failure blocks (capped)

**role-owner · S4 landing — Command Center pipeline summary and holds are unwired placeholders (MEDIUM)**
- Expected: the owner's landing screen shows live pipeline counts per stage and a holds feed, or a clear empty state that says it is not wired.
- Observed: every stage count in R-01..R-06, the CC-01 meta line ("— active clients · — moved forward today · counts only") and CC-02 Holds ("no holds feed yet", all chips 0) are hardcoded "—" in the HTML. No script writes to `.stage-count`, `.stage-dollar` or the holds chips; only KPI tiles (`FHData.kpis("today")`, command-center.html:1343) and the agent registry (`FHData.read("agents")`, :1358) load. /api/dashboard/pipeline answers 200 with 10 stages for this owner (follow-up) but the screen never calls it. Header pill says LIVE.
- Evidence: shots/01-landing.png · public/app/command-center.html:761-800 (static markup), :1314-1358 (only two wires) · extra-get-probe.json (/api/dashboard/pipeline 200)

**role-owner · S5 UI walk — Hiring screen crashes on live rows (MEDIUM)**
- Expected: hiring.html renders the board from /api/hiring/candidates.
- Observed: pageerror "Cannot read properties of null (reading 'length')". Live candidate rows carry `flags: null` (extra-get-probe.json firstItemKeys); `mapCandidateRow` (hiring.html:2572-2577) does not default it, and `cardHTML` (:1808) reads `a.flags.length` → throws inside `boot()`; the board and everything after it never paint, footer stays "loading hiring…". Stat tiles above the board did render (bench 0/12, 3 open, 3 need a human, 1/1 postings). Owner + admin only screen, so only they see it.
- Evidence: shots/30-hiring.html.png · ui-walk.md row hiring · extra-get-probe.json (/api/hiring/candidates items(3), flags:null) · public/app/hiring.html:1808, 2572-2577

**role-owner · S5 UI walk — Ops & Admin compliance gate never loads (MEDIUM)**
- Expected: ops-admin.html "Compliance gate — messages it stopped" lists blocked messages.
- Observed: GET /api/read/messages?status=blocked&limit=30 → 400 invalid_parameter. The handler requires `conversation_id` (api/read/messages.mjs:54-59) and has no status filter; ops-admin.html:862 calls it with `{status:"blocked"}`. Panel shows "Loading blocked messages…" forever; footer strip reads "sample compliance blocks — the request was rejected (That request was not accepted.)". Also on this screen: period label hardcoded "Last 7 Days — Jul 20–26" (ops-admin.html:307) while the header date is Aug 17; KPI tiles show "—" for cash/funded/close/cost/new clients though /api/dashboard/kpis answered 200. Same defect batch 2 saw for funding_advisor; owner has the role, so this is the endpoint mismatch not a gate.
- Evidence: shots/20-ops-admin.html.png · ui-walk.md row ops-admin · api/read/messages.mjs:54-59 · public/app/ops-admin.html:307,862

**role-owner · S5 UI walk — Campaigns screen sends no partner_id, shows sample book (LOW)**
- Expected: campaign-manager.html loads live campaign data for a chosen partner or a clear empty state.
- Observed: 5 GETs (/api/campaigns/spend, fatigue, connections, list, action-log with ?state=all) → 400 partner_id_required. Screen shows sample book "Ironwood Capital Group" with KPI tiles ($964.30 spend today, 3/11 live, ROAS 1.33) while the per-panel source table says "badrequest — request rejected" and the footer reads "spend:badrequest · list:badrequest · fatigue:badrequest · conn:badrequest · log:badrequest". Numbers on screen are sample furniture. Same as batch 2.
- Evidence: shots/25-campaign-manager.html.png · ui-walk.md row campaign-manager

**role-owner · S5 UI walk — Staff & Teams footer prints "[object Promise]" (LOW)**
- Expected: footer strip says "live roster · N staff · …".
- Observed: roster itself renders (1 person, Chris Stanbridge, OWNER, consent MISSING, clocked OUT), but the footer strip reads "[object Promise]". staff-teams.html:998 returns `applyMyShift(mapped).then(...)` (a Promise) from the `FHData.wire` paint callback; data.js:563-566 treats the callback's return as a string note. Cosmetic.
- Evidence: shots/29-staff-teams.html.png · public/app/staff-teams.html:998 · public/app/data.js:561-568

**role-owner · S2 reach — /api/read/banking-surface 403 (LOW, config)**
- Expected: owner never gets 403 on a reach route.
- Observed: GET 403 {ok:false, error:"banking surface requires plaid configuration"} with and without client_id. Role gate (ROLE_SETS.FINANCE) passed; the 403 is `isPlaidEnabled()` false on this deploy (api/read/banking-surface.mjs:72-74). No app screen calls this route on load (grep public/app/*.html: none), so no visible impact. Config state, not a code bug.
- Evidence: route-probe.md "Failures — should reach" · extra-get-probe.json · api/read/banking-surface.mjs:72-74

**role-owner · S2 reach — /api/inquiry 503 not_configured (known, owner-set hold)**
- Expected: owner (in the gate) gets a non-5xx answer.
- Observed: GET 503 {error:"not_configured", message:"INQUIRY_API_SECRET is not set…"} (api/inquiry.mjs:31-41). Owner-set 2026-08-15: phone inquiry remover ON HOLD. inquiry-remover.html did not call this route on load (0 API failures). Recorded as fact; not re-raised.
- Evidence: extra-get-probe.json · api/inquiry.mjs:31-41

### Doc gaps (intended vs actual)

- Reach totals: intended 88 routes across 15 groups; actual 154 routes across 25 groups. Intended file (written after the fact from the same generator on 2026-08-02) is stale vs code.
- Reach group counts differ: Signing in and out 7 → 9; Campaigns 6 → 8; Creative Factory 4 → 7; The dashboard 4 → 6; Reading data 26 → 45; Everything else 15 → 31.
- Reach groups in actual but missing from intended: chat (3), climate (2), company-brain (2), demo (2), partner-brand (1), proxy (2), public (3), repair (2), social (3), staff (2).
- Blocked: intended says "Nothing"; actual lists 2 blocked routes (chat/portal-message client-only; read/company-brain-affiliate affiliate+partner-only). Both hold live (403). The task brief's "blocked = nothing per -actual.md" is itself off by these 2.
- -actual.md gate rows vs code: /api/inquiry row says "inquiry_specialist, admin, owner" — code is `requireRole("inquiry_specialist","admin")` (api/inquiry.mjs:27); owner passed the gate live (503 is past auth), so owner is admitted via the super-role path, row is right in effect. No owner-visible gate rows were found wrong; the two batch-2 mismatches (read/my-numbers, repair/exceptions) do not affect owner (both 200 here).
- /api/read/banking-surface: -actual.md lists it as reachable for owner; live answers 403 by config (Plaid off). Not a gate row error, but the row cannot be verified on this deploy.
- No UI-level ground truth exists in either journey file (landing screen, sidebar contents, what each screen must show). S1b/S4/S5 are graded against public/app/shell.js HOME.owner (command-center.html) and ROLE_TABS.owner ("*", 34 tabs), not against the intended journey.
