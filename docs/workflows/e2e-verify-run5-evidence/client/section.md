## client (batch 1)

**Model:** claude-fable-5  ·  **Login:** client@fundhub.ai  ·  **Ran:** 2026-08-17T04:01:14Z (probe) / 2026-08-17T04:02:41Z (UI walk) / 2026-08-17T04:05Z (anonymous GET follow-up)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/client/

Login budget: 2 logins used (probe + UI walk), 0 rate-limit (429) responses. Follow-up GETs were anonymous only (the probe tool does not persist its token).

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | login page shown; POST /api/auth/login 200 with { ok, token, principal:"client", account }; session 200 | Login page rendered (email, password, Sign in). Login HTTP 200, ok=true, token=true, staff=null (account principal — expected), cookie=false (account branch returns before Set-Cookie, api/auth/login.mjs L125-131 vs L167). /api/auth/session 200 role=client. Browser sign-in left login.html; localStorage fh_role=client; 0 API 4xx on login | route-probe.json login · shots/00-login-page.png · shots/01-landing.png | PASS |
| S1b landing | lands on client-portal.html (shell.js HOME.client) | Landed at /app/client-portal.html "Fundhub — Client Portal"; chip "TEST — Client Role · client · 1 tab · LIVE". Shell fallback loop tried /app/, /app/pipeline.html, /app/command-center.html and each ended back on /app/client-portal.html (ROLE_TABS.client gate holds). No sidebar (0 links) | shots/01-landing.png · shots/02-app-shell.png · ui-walk.json landing.appShellUrl | PASS |
| S1c not signed in | 401 on sampled reach routes with no token | 6/6 → 401 unauthorized (consent/capture, finance/soft-pull, org-brand, read/entitlements, read/portal-contracts, read/portal-summary); /api/auth/session anonymous → 401 | route-probe.md "Not signed in" · extra-get-probe.json | PASS |
| S2 reach: Signing in and out (intended 6, actual 6) | not 401/403/404 | /api/auth/login GET 200; 5 UNVERIFIED (logout, magic-link, magic-link-verify, reset — write-only; session GET anonymous 401 = correct, authed session 200 seen in probe) | route-probe.md · extra-get-probe.json | PASS (1/1 probed) · 5 UNVERIFIED |
| S2 reach: chat (intended 0, actual 1) | /api/chat/portal-message not 401/403/404 | POST-only, not probed (no production writes). Portal chat widget renders "Message staff" + input for this principal | route-probe.md · shots/01-landing.png | UNVERIFIED |
| S2 reach: climate (intended 0, actual 2) | 2 not 401/403/404 | /api/climate/config GET 200 anonymous (keys ok, mapsKey, applyUrl); geocode UNVERIFIED (OPTIONS only) | extra-get-probe.json | PASS (1/1 probed) · 1 UNVERIFIED |
| S2 reach: consent (intended 1, actual 1) | not 401/403/404 | /api/consent/capture GET 400 "client_id must be a uuid" (reachable) | route-probe.md | PASS |
| S2 reach: contracts (intended 1, actual 1) | /api/contracts/sign not 401/403/404 | GET 404 not_found without a signed link — handler answers 404 for any missing/bad link by design (same as batch 2). Not provable without a real signed link | route-probe.md | UNVERIFIED |
| S2 reach: Documents (intended 1, actual 1) | /api/documents/:id not 401/403/404 | not probed (HEAD on a signed link; no link) | route-probe.md | UNVERIFIED |
| S2 reach: Finance (intended 1, actual 1) | /api/finance/soft-pull not 401/403/404 | GET 400 "client_id must be a uuid" (reachable) | route-probe.md | PASS |
| S2 reach: public (intended 0, actual 3) | 3 not 401/403/404 | partner-page GET 400 partner_id_and_slug_or_domain_required (reachable); partner-apply, survey-submit UNVERIFIED (POST) | route-probe.md | PASS (1/1 probed) · 2 UNVERIFIED |
| S2 reach: Reading data (intended 1, actual 3) | entitlements, portal-contracts, portal-summary not 401/403/404 | 3/3 GET 200 with the client token and NO client_id query — proves the account is attached to a client file (api/read/portal-summary.mjs L23-31 would 403 otherwise) | route-probe.md | PASS |
| S2 reach: Everything else (intended 3, actual 6) | 6 not 401/403/404 | org-brand GET 200; soft-pull-approve GET 400 bad_token (reachable); health GET 200 anonymous (follow-up); climate OPTIONS, documents-upload POST, inngest signed — 3 UNVERIFIED | route-probe.md · extra-get-probe.json | PASS (3/3 probed) · 3 UNVERIFIED |
| S2 reach: Incoming webhooks (intended 1, actual 1) | reachable | not probed (provider signature) | route-probe.md | UNVERIFIED |
| S3 blocked: Signing in and out (intended 1, actual 3) | 403 | 0/3 → 403; 3/3 → 401 unauthorized (admin-reset, invite, suspend). Refused, wrong code — see failure block | route-probe.md | PASS (partial) — refused as 401 |
| S3 blocked: banking (intended 3, actual 3) | 403 | 0/3 → 403; 3/3 → 401 (accounts, revoke, sync-accounts) | route-probe.md | PASS (partial) — 401 |
| S3 blocked: Campaigns (intended 6, actual 8) | 403 | 8/8 → 403 forbidden | route-probe.md | PASS |
| S3 blocked: chat (intended 0, actual 3) | 403 | chat/messages 403; chat/ask, chat/peers 401 | route-probe.md | PASS (partial) — 2 as 401 |
| S3 blocked: company-brain (intended 0, actual 2) | 403 | 0/2 → 403; 2/2 → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: Creative Factory (intended 4, actual 7) | 403 | 7/7 → 403 | route-probe.md | PASS |
| S3 blocked: The dashboard (intended 4, actual 6) | 403 | client-archive POST {} → 401; 5 UNVERIFIED (client, clients, kpis, pipeline, seed — method "—"; no token in hand for a GET follow-up) | route-probe.md | PASS (partial) · 5 UNVERIFIED |
| S3 blocked: demo (intended 0, actual 2) | 403 | mode GET 401, simulate POST {} 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: Finance (intended 9, actual 9) | 403 | 0/9 → 403; 9/9 → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: Hiring (intended 6, actual 6) | 403 | 0/6 → 403; 6/6 → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: journeys (intended 2, actual 2) | 403 | journeys/ask, journeys/run POST {} → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: partner-brand (intended 0, actual 1) | 403 | verify-domain POST {} → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: privacy (intended 1, actual 1) | 403 | erasure GET → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: proxy (intended 0, actual 2) | 403 | proxy/launch, proxy/end POST {} → 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: Reading data (intended 25, actual 43) | 403 | 2/40 → 403 (read/affiliates, read/partners); 38/40 → 401; 3 UNVERIFIED (agent-context, agent-shadow-log, tradelines — method "—") | route-probe.md | PASS (partial) — 401 · 3 UNVERIFIED |
| S3 blocked: repair (intended 0, actual 2) | 403 | repair/exceptions GET 403; repair/send POST {} 401 | route-probe.md | PASS (partial) |
| S3 blocked: social (intended 0, actual 3) | 403 | publish, schedule POST {} → 403; oauth UNVERIFIED (method "—") | route-probe.md | PASS · 1 UNVERIFIED |
| S3 blocked: staff (intended 0, actual 2) | 403 | monitoring-consent POST {} 401; telemetry GET 401 | route-probe.md | PASS (partial) — 401 |
| S3 blocked: Everything else (intended 12, actual 25) | 403 | 7/24 → 403 (inquiries, messages, partner-brand, partner-pages, pii, shifts, tasks); 17/24 → 401 (agents, ai-bureau-config, applications, call-outcomes, closer-deck, contracts, customer-insights, inquiry-cases, journeys, lender-observations, lenders, marketing-flags, message-templates, messages-outbound, payment-links, pipeline-cards, products); /api/inquiry UNVERIFIED (method "—") | route-probe.md | PASS (partial) — 401 · 1 UNVERIFIED |
| S4 UI: landing screen detail | signed-in client sees their own portal (name, agreements, documents, pre-qual, entitlement tiles) with no forbidden/failed calls and no staff-only wording | Page heading "Open this from a client file", sub-line "Open this from a client file.", yellow bottom banner "Open this from a client file". No name, no agreements, no documents, no pre-qual, no tiles — page took the no-clientId early-return branch and made none of its data calls (0 API 4xx, 0 console errors because nothing was requested). "Welcome video is not available" placeholder; "Join on Facebook" link; chat widget open with "Message staff" (allowed route) and "Your call is coming up…" prompt; header chip "TEST — Client Role"; Sign out button. Nothing on the page fetches the signed-in client's own file | shots/01-landing.png · ui-walk.json landing | FAIL (HIGH) |
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 0 visible / 0 sidebar links — client-portal.html has no sidebar (ROLE_TABS.client = 1 tab). 0 screens opened, 0 bounced, 0 failing endpoints. Staff shells (/app/, pipeline, command-center) all bounced back to client-portal.html | ui-walk.md · ui-walk.json | PASS (nothing to walk) |

### Failure blocks (capped)

**client · S4 landing — signed-in client sees an empty portal: "Open this from a client file" (HIGH)**
- Expected: after sign-in the client's own portal loads (agreements, documents, pre-qual, entitlements) using the signed-in account's client file.
- Observed: /app/client-portal.html renders "Open this from a client file" as heading, sub-line and bottom banner; no client data is requested. Cause (traced): public/app/client-portal.html L1519-1537 resolves clientId only from ?id= / ?client_id= or localStorage `fh_account.clientId`; with neither it calls paintEmptyIdentity(), banner("sample", "Open this from a client file") and returns before any FHData.wire. Nothing ever writes `fh_account`: public/login.html storeSession (L233-245) stores fh_token + fh_role only, although the login reply's `account` object carries clientId (src/auth/account-session.mjs L189-192, api/auth/login.mjs L126-131); public/app/brand-studio.html L503 documents "Login never writes fh_account". The page also does not adopt clientId from GET /api/auth/session. The API side is fine: /api/read/portal-summary, /portal-contracts, /entitlements all answered 200 for the bare client token, so the account IS attached to a client file — the screen just never asks for it. Same pattern in the upload block (L1073-1077) and consent block (L1664-1668): both resolve clientId the same way, so uploads and consent capture from the portal have no client_id either.
- Evidence: shots/01-landing.png, shots/02-app-shell.png, ui-walk.json (landing.apiFails=[], consoleErrors=[]), route-probe.md (Reading data rows 200).

**client · S3 blocked — 92 staff-only routes refuse the client with 401 "unauthorized" instead of 403 (LOW + DOC-GAP)**
- Expected (per -actual.md flowchart "Recognised as client? No → 403 forbidden" and src/http/middleware/requireRole.mjs L10-12: "401 means log in, 403 means log in as someone else"): 403.
- Observed: every route gated by requireAuth/requireRole (staff sessions only) answers 401 unauthorized to a valid client token — 92 of 120 probed blocked routes. Only routes on requirePrincipal (campaigns, creative, chat/messages, inquiries, messages, partner-brand, partner-pages, pii, read/affiliates, read/partners, repair/exceptions, shifts, social, tasks) answer 403. Cause: src/http/middleware/requireAuth.mjs L77-85 authenticate() checks the staff `sessions` table only, so an account token looks like "no session" (L112). No data leaked — every response body was { ok:false, error:"unauthorized" }. Risk is UX/diagnostic: a client-side caller reading 401 as "signed out" would bounce a signed-in client to login.
- Evidence: route-probe.md "Failures — should be blocked but was not 403" (92 rows), route-probe.json blocked[].

### Doc gaps (intended vs actual)

- Reach totals: intended 15 routes / 8 groups; actual 26 routes / 11 groups. Reach counts differ: Reading data 1 → 3 (entitlements, portal-contracts, portal-summary); Everything else 3 → 6. Reach groups in actual but missing from intended: chat (1 — the role-defining /api/chat/portal-message), climate (2), public (3).
- Blocked totals: intended 73 / 11 groups; actual 130 / 19 groups. Blocked counts differ: Signing in and out 1 → 3; Campaigns 6 → 8; Creative Factory 4 → 7; The dashboard 4 → 6; Reading data 25 → 43; Everything else 12 → 25. Blocked groups in actual but missing from intended: chat (3), company-brain (2), demo (2), partner-brand (1), proxy (2), repair (2), social (3), staff (2).
- -actual.md flowchart says a wrong-kind principal is "Refused — 403 forbidden"; live, 92 of 120 probed blocked routes answer 401 (staff-only gates do not recognise account tokens). The route table itself is not wrong about who gets in, but the refusal code drawn in the picture is wrong for most rows.
- -actual.md lists /api/auth/login as reachable with method GET only; live GET 200 (demoOptions — api/auth/login.mjs L75), POST is the actual sign-in and is not in the table.
- No UI-level ground truth in either journey file (landing screen, what the portal should show, no-sidebar layout). S1b/S4/S5 are graded against public/app/shell.js HOME/ROLE_TABS (client → client-portal.html, 1 tab), not against the intended journey.
- Login budget note: -actual.md/-intended.md do not mention that an account login first records a failed staff attempt (api/auth/login.mjs L106-113 + src/auth/login.mjs LIMITS) — relevant to anyone re-running these tools.
