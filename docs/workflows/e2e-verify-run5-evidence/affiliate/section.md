## affiliate (batch 1)

**Model:** claude-fable-5  ·  **Login:** affiliate@fundhub.ai  ·  **Ran:** 2026-08-17T04:01:06Z (probe) / 2026-08-17T04:02:02Z (UI walk) / 2026-08-17T04:03:57Z (no-login GET follow-up)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/affiliate/

Login budget: 2 logins used (probe + UI walk), 0 rate-limited. No third login; the GET follow-up sent no token.

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | login page shown; POST /api/auth/login 200 with token; principal=affiliate | Login page rendered. Login HTTP 200, ok=true, token=true, staff=null (account principal shape `{ok,token,principal,account}` — expected), cookie=false (account branch sets no Set-Cookie by design, api/auth/login.mjs L126-133). /api/auth/session 200 role=affiliate. Browser sign-in left login.html; localStorage fh_role=affiliate; 0 API fails, 0 console errors | route-probe.json login · shots/00-login-page.png · shots/01-landing.png | PASS |
| S1b landing | lands on affiliate.html (shell.js HOME.affiliate) | Landed at /app/affiliate.html "Fundhub — Affiliate". Header chip "TEST — Affiliate Role · affiliate · 1 tab · LIVE". Sidebar shows only Portals → Affiliate (ROLE_TABS.affiliate = [affiliate.html]) | shots/01-landing.png · shots/02-app-shell.png · ui-walk.json landing | PASS |
| S1c not signed in | 401 on sampled reach routes | 2/2 sampled → 401 (/api/org-brand, /api/read/affiliates) | route-probe.md "Not signed in" | PASS |
| S2 reach: Signing in and out (intended 6, actual 6) | all 6 not 401/403/404 | /api/auth/login GET 200; /api/auth/session GET 200 role=affiliate (probe's who-am-I call); 4 UNVERIFIED (logout, magic-link, magic-link-verify, reset — write-only, not probed) | route-probe.md, route-probe.json session | PASS (2/2 probed) · 4 UNVERIFIED |
| S2 reach: climate (intended 0, actual 2) | 2 not 401/403/404 | /api/climate/config GET 200 keys ok,mapsKey,applyUrl (no-token follow-up); geocode UNVERIFIED (OPTIONS only) | extra-get-probe.json | PASS (1/1 probed) · 1 UNVERIFIED |
| S2 reach: contracts (intended 1, actual 1) | /api/contracts/sign not 401/403/404 | GET 404 not_found without a signed link — handler answers 404 for any missing/bad link; not provable without a real link | route-probe.md | UNVERIFIED |
| S2 reach: Documents (intended 1, actual 1) | /api/documents/:id not 401/403/404 | not probed (HEAD on a signed link; no link) | route-probe.md | UNVERIFIED |
| S2 reach: public (intended 0, actual 3) | all 3 not 401/403/404 | partner-page GET 400 partner_id_and_slug_or_domain_required (reachable); partner-apply, survey-submit UNVERIFIED (POST) | route-probe.md | PASS (1/1 probed) · 2 UNVERIFIED |
| S2 reach: Reading data (intended 0, actual 1) | /api/read/affiliates not 401/403/404 | GET 200 (own row only per api/read/affiliates.mjs) | route-probe.md | PASS |
| S2 reach: Everything else (intended 2, actual 5) | all 5 not 401/403/404 | org-brand GET 200; soft-pull-approve GET 400 bad_token (reachable); health GET 200 (no-token follow-up); climate OPTIONS-only and inngest (signed) UNVERIFIED | route-probe.md, extra-get-probe.json | PASS (3/3 probed) · 2 UNVERIFIED |
| S2 reach: Incoming webhooks (intended 1, actual 1) | /api/webhooks/:provider reachable | not probed (provider signature) | route-probe.md | UNVERIFIED |
| S3 blocked: Signing in and out (intended 1, actual 3) | admin-reset, invite, suspend → 403 | 3/3 POST {} → 401 unauthorized (denied, but not 403) | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: banking (intended 3, actual 3) | 3 → 403 | 3/3 → 401 unauthorized | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: Campaigns (intended 6, actual 8) | 8 → 403 | 8/8 → 403 forbidden | route-probe.md | PASS |
| S3 blocked: chat (intended 0, actual 4) | 4 → 403 | messages, portal-message → 403; ask, peers → 401 | route-probe.md | PASS (partial) — 2/4 403, 2/4 401 |
| S3 blocked: company-brain (intended 0, actual 2) | reviews, sync → 403 | 2/2 → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: consent (intended 1, actual 1) | consent/capture → 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: Creative Factory (intended 4, actual 7) | 7 → 403 | 7/7 → 403 | route-probe.md | PASS |
| S3 blocked: The dashboard (intended 4, actual 6) | 6 → 403 | client-archive POST {} → 401; 5 UNVERIFIED (no method listed; no token left to follow up) | route-probe.md | PASS (partial) 1/1 denied via 401 · 5 UNVERIFIED |
| S3 blocked: demo (intended 0, actual 2) | demo/mode, demo/simulate → 403 | 2/2 → 401 (GET mode, POST {} simulate; DELETE not probed) | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: Finance (intended 10, actual 10) | 10 → 403 | soft-pull → 403; other 9 → 401 | route-probe.md | PASS (partial) — 1/10 403, 9/10 401 |
| S3 blocked: Hiring (intended 6, actual 6) | 6 → 403 | 6/6 → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: journeys (intended 2, actual 2) | journeys/ask, journeys/run → 403 | 2/2 POST {} → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: partner-brand (intended 0, actual 1) | verify-domain → 403 | 1/1 → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: privacy (intended 1, actual 1) | privacy/erasure → 403 | 1/1 → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: proxy (intended 0, actual 2) | launch, end → 403 | 2/2 POST {} → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: Reading data (intended 26, actual 45) | 45 → 403 | 42 probed: entitlements, partners, portal-contracts, portal-summary → 403; 38 → 401 (incl. /api/read/company-brain-affiliate POST {} → 401 — see failure block); 3 UNVERIFIED (agent-context, agent-shadow-log, tradelines — no method) | route-probe.md | PASS (partial) — 4/42 403, 38/42 401 · 3 UNVERIFIED |
| S3 blocked: repair (intended 0, actual 2) | exceptions, send → 403 | exceptions GET → 403; send POST {} → 401 | route-probe.md | PASS (partial) |
| S3 blocked: social (intended 0, actual 3) | 3 → 403 | publish, schedule POST {} → 403; oauth UNVERIFIED (no method) | route-probe.md | PASS (2/2 probed) · 1 UNVERIFIED |
| S3 blocked: staff (intended 0, actual 2) | monitoring-consent, telemetry → 403 | 2/2 → 401 | route-probe.md | PASS (partial) — denied via 401 |
| S3 blocked: Everything else (intended 13, actual 26) | 26 → 403 | 25 probed: documents-upload, inquiries, messages, partner-brand, partner-pages, pii, shifts, tasks → 403 (8); 17 → 401; /api/inquiry UNVERIFIED (no method; no token left) | route-probe.md | PASS (partial) — 8/25 403, 17/25 401 · 1 UNVERIFIED |
| S4 UI: landing screen detail | screen loads its data without forbidden/failed API calls; no controls the principal cannot use | Page calls /api/auth/session, /api/org-brand, /api/read/affiliates — all OK; 0 API 4xx/5xx, 0 console errors. Shows AF-00 scoped-view notice, referral link https://fundhub.ai/start?ref=AFF-000001, code AFF-000001, clicks "—", rate "Per agreement", cookie 60d, Referred 0, Converted 0, Owed $0.00, Paid $0.00, funnel all 0. Beta banner. Footer strip reads "affiliate roster loaded · no code for this session" while the code card shows AFF-000001 (race: roster callback ran before session set meId — public/app/affiliate.html L485-520). Company Brain "Ask" button offered, but its endpoint POST /api/read/company-brain-affiliate answers 401 for this token (probe) → button cannot work (not clicked; no writes) | shots/01-landing.png · ui-walk.json landing · route-probe.md | FAIL (MEDIUM) |
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 2 visible / 34 links (logo → /app/affiliate.html, Portals → Affiliate); 1 distinct screen opened, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors. Sidebar matches shell.js ROLE_TABS.affiliate = [affiliate.html] | ui-walk.md · shots/03-_app_affiliate.html.png · shots/04-affiliate.html.png | PASS |

### Failure blocks (capped)

**affiliate · S4 landing — Company Brain "Ask" cannot work for an affiliate session (MEDIUM)**
- Expected: affiliate.html offers "Ask approved partner docs"; POST /api/read/company-brain-affiliate is gated to affiliate + partner (api/read/company-brain-affiliate.mjs L15), so an affiliate should get an answer or a 400 question_required.
- Observed: POST {} with the affiliate token → 401 unauthorized. The handler gates with `requireAuth` (staff sessions only — src/http/middleware/requireAuth.mjs verifySession) before `requireRole(AFFILIATE_BRAIN_ROLES)` (api/read/company-brain-affiliate.mjs L27-33); an account token never reaches the role check. On screen the user would see "Could not answer — unauthorized" (public/app/affiliate.html L564-565). Button not clicked (no writes); the 401 is from the probe. /api/read/affiliates works because it uses requirePrincipal (api/read/affiliates.mjs L11-13) — the same pattern this handler lacks.
- Evidence: route-probe.md (blocked row company-brain-affiliate), shots/01-landing.png (Ask control).

**affiliate · S3 blocked — 92 blocked routes answer 401 "unauthorized", not 403 (LOW + DOC-GAP)**
- Expected (per -actual.md): "Recognised as affiliate? → No → 403 forbidden".
- Observed: 92/126 probed blocked routes → 401 unauthorized with a valid affiliate token; 34 → 403 (routes on requirePrincipal / readHandler). Access is denied in every case (nothing leaked). Cause: staff-only handlers use `requireAuth` → verifySession, which does not recognise account-table tokens, so a signed-in affiliate is told "not signed in". Same root as the Ask finding above.
- Evidence: route-probe.md "Failures — should be blocked but was not 403" (92 rows), route-probe.json blocked[].

**affiliate · S4 landing — footer says "no code for this session" while code AFF-000001 is shown (LOW)**
- Expected: status strip agrees with the card.
- Observed: strip "affiliate roster loaded · no code for this session" (roster callback ran before /api/auth/session resolved meId; session callback then repaints the code but not the strip or Owed) — public/app/affiliate.html L485-520. Clicks 30d "—" and Paid have no source (noted in code L517-519).
- Evidence: shots/01-landing.png, ui-walk.json screens[0].bodyText.

### Doc gaps (intended vs actual)

- Group counts differ (route-probe.md "Intended vs actual group counts"): reach — Everything else 2 vs 5, climate 0 vs 2, public 0 vs 3, Reading data 0 vs 1; blocked — Signing in and out 1 vs 3, Campaigns 6 vs 8, Creative Factory 4 vs 7, The dashboard 4 vs 6, Reading data 26 vs 45, Everything else 13 vs 26, and 8 groups missing from intended: chat 4, company-brain 2, demo 2, partner-brand 1, proxy 2, repair 2, social 3, staff 2. Intended file is itself a copy of an older -actual (stated at its top).
- -actual.md lists `/api/read/company-brain-affiliate` under **blocked** with gate "affiliate, partner" — contradictory; and the live handler 401s an affiliate anyway (api/read/company-brain-affiliate.mjs L27-33 requireAuth). Row is wrong on both counts.
- -actual.md says the blocked path is "403 forbidden"; for an account principal 92 routes answer 401 (see failure block). The generator reads staff-role sets, not the auth primitive (requireAuth vs requirePrincipal).
- No UI ground truth in the journey files: landing (affiliate.html) and sidebar (one tab) graded against public/app/shell.js HOME.affiliate / ROLE_TABS.affiliate. DOC-GAP.
- shell.js L211-218 comment still says 'affiliate' has "no catalog row and nothing issues them a session" — stale; accounts-table login (db/migrations/044) issues one, and it worked live. DOC-GAP (comment only).
