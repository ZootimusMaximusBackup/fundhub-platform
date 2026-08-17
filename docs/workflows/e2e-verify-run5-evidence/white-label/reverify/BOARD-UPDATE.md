# white-label — BOARD-UPDATE (reverify pass, claude-fable-5)

Board: docs/workflows/fable-audit-2026-08-16.md. Reverify ran 2026-08-17T05:48Z–05:52Z against https://fundhub.ai (commit 2b1eed0 confirmed by shell.js / login.html fingerprints) as partner@fundhub.ai. Evidence under docs/workflows/e2e-verify-run5-evidence/white-label/reverify/. This journey had no FIXED-UNCLICKED rows; every row below was PASS / PASS (partial) and was re-run for fix-induced regressions. Verdicts: PASS-STILL or CHANGED-NOT-REGRESSION. No REGRESSION found.

Findings-table columns: | Journey | Step | Expected | Observed | Evidence | Severity | Model |. Section-table columns: | Step | Expected | Observed | Evidence | Result |. The parent applies these; the auditor did not edit the board.

## Findings table rows (L539-572)

### Board line 539 — PASS-STILL

Original (verbatim):

| white-label | S1 sign in | login page shown; POST /api/auth/login 200 with { ok, token, principal:"partner", account } (no staff key, no cookie — account path api/auth/login.mjs L126-133) | Login page rendered. Login 200 ok=true token=true staff=null cookie=false (by design for accounts). /api/auth/session 200 role=partner. Browser sign-in left login.html; fh_role=partner; 0 API fails, 0 console errors | docs/workflows/e2e-verify-run5-evidence/white-label/route-probe.json · docs/workflows/e2e-verify-run5-evidence/white-label/shots/00-login-page.png · docs/workflows/e2e-verify-run5-evidence/white-label/shots/01-landing.png | PASS | claude-fable-5 |

Proposed replacement:

| white-label | S1 sign in | login page shown; POST /api/auth/login 200 with { ok, token, principal:"partner", account } (no staff key, no cookie — account path api/auth/login.mjs L126-133) | Reverify 2026-08-17T05:48Z: login HTTP 200 ok=true token=true staff=null cookie=false; /api/auth/session 200 role=partner (body keys ok, principal, staff). Browser sign-in left login.html → /app/partner-galaxy.html; fh_role=partner; 0 API 4xx/5xx, 0 console errors. NEW since ship: login.html now also stores localStorage fh_account (kind=partner, partnerId present) — see spot-check | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.json · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/ui-walk.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/00-login-page.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/01-landing.png | PASS-STILL | claude-fable-5 (reverify) |

### Board line 540 — PASS-STILL

Original (verbatim):

| white-label | S1b landing | lands on partner-galaxy.html (shell.js HOME.partner L238) | Landed at /app/partner-galaxy.html "Your Galaxy — Partner View"; header chip "TEST — White-Label Partner Role · partner · 2 tabs · LIVE"; sidebar present | docs/workflows/e2e-verify-run5-evidence/white-label/shots/01-landing.png · docs/workflows/e2e-verify-run5-evidence/white-label/shots/02-app-shell.png · docs/workflows/e2e-verify-run5-evidence/white-label/ui-walk.json | PASS | claude-fable-5 |

Proposed replacement:

| white-label | S1b landing | lands on partner-galaxy.html (shell.js HOME.partner L238) | Reverify: landed at /app/partner-galaxy.html "Your Galaxy — Partner View"; header chip "TEST — White-Label Partner Role · partner · 2 tabs · LIVE"; sidebar present (2 visible / 34). Same as original | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/01-landing.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/02-app-shell.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/ui-walk.json | PASS-STILL | claude-fable-5 (reverify) |

### Board line 541 — PASS-STILL

Original (verbatim):

| white-label | S1c not signed in | 401 on sampled reach routes | 6/6 → 401 unauthorized (campaigns action-log, connections, detail, fatigue, list, spend); /api/auth/session no token → 401 | docs/workflows/e2e-verify-run5-evidence/white-label/route-probe.md · docs/workflows/e2e-verify-run5-evidence/white-label/extra-get-probe.json | PASS | claude-fable-5 |

Proposed replacement:

| white-label | S1c not signed in | 401 on sampled reach routes | Reverify: 6/6 sampled reach routes → 401 unauthorized with no token (campaigns action-log, connections, detail, fatigue, list, spend). Same as original | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |

### Board line 543 — PASS-STILL

Original (verbatim):

| white-label | S2 reach: Campaigns (intended 6, actual 8) | not 401/403/404 | 6/6 probed OK (action-log/connections/fatigue/list/spend 200; detail 400 bad_request needs id); sync, write UNVERIFIED (POST) | docs/workflows/e2e-verify-run5-evidence/white-label/route-probe.md | PASS · 2 UNVERIFIED | claude-fable-5 |

Proposed replacement:

| white-label | S2 reach: Campaigns (intended 6, actual 8) | not 401/403/404 | Reverify: 6/6 probed OK (action-log/connections/fatigue/list/spend 200; detail 400 bad_request needs id); sync, write UNVERIFIED (POST). Identical statuses to original | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |

### Board line 559 — PASS-STILL

Original (verbatim):

| white-label | S3 blocked: demo (intended 0, actual 2) | 403 | demo/mode GET 401, demo/simulate POST {} 401 (DELETE not probed) | docs/workflows/e2e-verify-run5-evidence/white-label/route-probe.md | PASS (partial) — LOW wrong status | claude-fable-5 |

Proposed replacement:

| white-label | S3 blocked: demo (intended 0, actual 2) | 403 | Reverify: demo/mode GET 401, demo/simulate POST {} 401 — unchanged. Browser: /api/demo/mode was NOT called on landing, Brand Studio, or a direct ops-admin.html visit (0 demo/mode requests in the full call log) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md | PASS-STILL | claude-fable-5 (reverify) |

### Board line 566 — CHANGED-NOT-REGRESSION

Original (verbatim):

| white-label | S3 blocked: Reading data (intended 25, actual 45) | 403 | 42 probed: 4 → 403 (affiliates, entitlements, portal-contracts, portal-summary); 38 → 401 incl. company-brain-affiliate whose -actual.md gate says "affiliate, partner" but handler needs a staff session (api/read/company-brain-affiliate.mjs L27-33); 3 UNVERIFIED (agent-context, agent-shadow-log, tradelines) | docs/workflows/e2e-verify-run5-evidence/white-label/route-probe.md | PASS (partial) — LOW; 3 UNVERIFIED | claude-fable-5 |

Proposed replacement:

| white-label | S3 blocked: Reading data (intended 25, actual 45) | 403 | Reverify: 42 probed: 4 → 403 (affiliates, entitlements, portal-contracts, portal-summary); 37 → 401; 1 CHANGED: /api/read/company-brain-affiliate POST {} now 400 question_required (was 401) — the ship moved it to requirePrincipal(affiliate, partner) so a partner now reaches it, matching the -actual.md gate text; failure block B is resolved. Nothing leaked. 3 UNVERIFIED (agent-context, agent-shadow-log, tradelines) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.json · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md | CHANGED-NOT-REGRESSION | claude-fable-5 (reverify) |

### Board line 570 — PASS-STILL

Original (verbatim):

| white-label | S3 blocked: Everything else (intended 13, actual 24) | 403 | 23 probed: 6 → 403 (documents-upload, inquiries, messages, pii, shifts, tasks); 17 → 401 unauthorized; /api/inquiry UNVERIFIED (no method). Nothing leaked | docs/workflows/e2e-verify-run5-evidence/white-label/route-probe.md | PASS (partial) — LOW · 1 UNVERIFIED | claude-fable-5 |

Proposed replacement:

| white-label | S3 blocked: Everything else (intended 13, actual 24) | 403 | Reverify: 23 probed: 6 → 403 (documents-upload, inquiries, messages, pii, shifts, tasks); 17 → 401; /api/inquiry UNVERIFIED. Identical to original. Nothing leaked | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |

### Board line 571 — PASS-STILL

Original (verbatim):

| white-label | S4 UI: landing screen detail | partner-galaxy loads without forbidden/failed API calls; no unusable controls; no sample/not-signed-in wording | 0 API 4xx/5xx, 0 console errors (calls: /api/auth/session, /api/read/partners, /api/org-brand; shell skips /api/demo/mode for partner, shell.js L1577). Cluster map all "0 working · 0 total", six metrics "—", banner "PARTNER VIEW — your book only", footer "live partner census · 1 partner(s) · $0 accrued · 1 agreement(s) unsigned", own apply URL shown. No sample/demo wording. Only Sign out + zoom controls. Cosmetic: top-bar text crowding, lower half of viewport empty | docs/workflows/e2e-verify-run5-evidence/white-label/shots/01-landing.png · docs/workflows/e2e-verify-run5-evidence/white-label/shots/03-_app_partner-galaxy.html.png · docs/workflows/e2e-verify-run5-evidence/white-label/ui-walk.json | PASS | claude-fable-5 |

Proposed replacement:

| white-label | S4 UI: landing screen detail | partner-galaxy loads without forbidden/failed API calls; no unusable controls; no sample/not-signed-in wording | Reverify: 0 API 4xx/5xx, 0 console errors on landing. Full call log: GET /api/auth/session 200 (x2), /api/read/partners?limit=200 200, /api/health 200, /api/org-brand 200 — no /api/demo/mode. Cluster map all "0 working · 0 total", six metrics "—", banner "PARTNER VIEW — your book only", footer "live partner census · 1 partner(s) · $0 accrued · 1 agreement(s) unsigned". Same cosmetics (top-bar crowding, empty lower half) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/01-landing.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/sc-partner-galaxy.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md | PASS-STILL | claude-fable-5 (reverify) |

### Board line 572 — CHANGED-NOT-REGRESSION

Original (verbatim):

| white-label | S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call (shell.js ROLE_TABS.partner L221 = partner-galaxy, brand-studio) | 2 visible / 34 links (matches ROLE_TABS.partner); 2 screens opened, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors. Brand Studio opens in partner mode (?partner_id=<uuid>): Domain "— not connected", Funnels 0 of 6, Compliance Locked, preview renders. Offers a "Verify" domain button (brand-studio.html L393, L715-740) that POSTs owner/admin-only /api/partner-brand/verify-domain → 401 for partner (not clicked) | docs/workflows/e2e-verify-run5-evidence/white-label/ui-walk.md · docs/workflows/e2e-verify-run5-evidence/white-label/shots/04-brand-studio.html.png | PASS (partial) — LOW | claude-fable-5 |

Proposed replacement:

| white-label | S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call (shell.js ROLE_TABS.partner L221 = partner-galaxy, brand-studio) | Reverify: 2 visible / 34 links; 2 screens opened, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors. CHANGED: Brand Studio final URL is now /app/brand-studio.html (no ?partner_id= reload) because login.html now stores fh_account and brand-studio.html L500-501 reads partnerId from it; page still in partner mode (footer "partner brand · TEST — White-Label Partner Role · draft", brand name filled, Domain "— not connected", Funnels 0 of 6, Compliance Locked; calls: partner-brand?partner_id 200, partner-pages?partner_id 200). "Verify" button still present, still owner/admin-only (verify-domain POST {} → 401 in probe) — LOW unchanged | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/ui-walk.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/04-brand-studio.html.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/sc-brand-studio.png · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md | CHANGED-NOT-REGRESSION | claude-fable-5 (reverify) |

## Section table rows (## white-label (batch 1), L754-787)

### Board line 754 — PASS-STILL

Original (verbatim):

| S1 sign in | login page shown; POST /api/auth/login 200 with `{ ok, token, principal:"partner", account }` (account principal — no `staff` key, no cookie by design api/auth/login.mjs L126-133) | Login page rendered. Login HTTP 200, ok=true, token=true, staff=null (expected for an account), cookie=false (account path sets none — by design). /api/auth/session 200 role=partner. Browser sign-in left login.html; localStorage fh_role=partner; 0 API fails, 0 console errors | route-probe.json login · shots/00-login-page.png · shots/01-landing.png | PASS |

Proposed replacement:

| S1 sign in | login page shown; POST /api/auth/login 200 with `{ ok, token, principal:"partner", account }` (account principal — no `staff` key, no cookie by design api/auth/login.mjs L126-133) | Reverify 2026-08-17T05:48Z: login HTTP 200 ok=true token=true staff=null cookie=false; /api/auth/session 200 role=partner (body keys ok, principal, staff). Browser sign-in left login.html → /app/partner-galaxy.html; fh_role=partner; 0 API 4xx/5xx, 0 console errors. NEW since ship: login.html now also stores localStorage fh_account (kind=partner, partnerId present) — see spot-check | reverify/route-probe.json · reverify/ui-walk.md · reverify/spot-check.md · reverify/shots/00-login-page.png · reverify/shots/01-landing.png | PASS-STILL |

### Board line 755 — PASS-STILL

Original (verbatim):

| S1b landing | lands on partner-galaxy.html (shell.js HOME.partner L238) | Landed at /app/partner-galaxy.html "Your Galaxy — Partner View". Header chip "TEST — White-Label Partner Role · partner · 2 tabs · LIVE". Sidebar present, no fallback needed | shots/01-landing.png · shots/02-app-shell.png · ui-walk.json landing | PASS |

Proposed replacement:

| S1b landing | lands on partner-galaxy.html (shell.js HOME.partner L238) | Reverify: landed at /app/partner-galaxy.html "Your Galaxy — Partner View"; header chip "TEST — White-Label Partner Role · partner · 2 tabs · LIVE"; sidebar present (2 visible / 34). Same as original | reverify/shots/01-landing.png · reverify/shots/02-app-shell.png · reverify/ui-walk.json | PASS-STILL |

### Board line 756 — PASS-STILL

Original (verbatim):

| S1c not signed in | 401 on sampled reach routes | 6/6 → 401 unauthorized (campaigns action-log, connections, detail, fatigue, list, spend). Follow-up: /api/auth/session no token → 401 | route-probe.md "Not signed in" · extra-get-probe.json | PASS |

Proposed replacement:

| S1c not signed in | 401 on sampled reach routes | Reverify: 6/6 sampled reach routes → 401 unauthorized with no token (campaigns action-log, connections, detail, fatigue, list, spend). Same as original | reverify/route-probe.md | PASS-STILL |

### Board line 758 — PASS-STILL

Original (verbatim):

| S2 reach: Campaigns (intended 6, actual 8) | not 401/403/404 | 6/6 probed OK: action-log 200, connections 200, fatigue 200, list 200, spend 200, detail 400 bad_request (needs id — reachable). 2 UNVERIFIED (sync, write — POST) | route-probe.md | PASS · 2 UNVERIFIED |

Proposed replacement:

| S2 reach: Campaigns (intended 6, actual 8) | not 401/403/404 | Reverify: 6/6 probed OK (action-log/connections/fatigue/list/spend 200; detail 400 bad_request needs id); sync, write UNVERIFIED (POST). Identical statuses to original | reverify/route-probe.md | PASS-STILL |

### Board line 774 — PASS-STILL

Original (verbatim):

| S3 blocked: demo (intended 0, actual 2) | 403 | demo/mode GET 401, demo/simulate POST {} 401 (DELETE never probed) | route-probe.md | PASS (partial) — denied, wrong status |

Proposed replacement:

| S3 blocked: demo (intended 0, actual 2) | 403 | Reverify: demo/mode GET 401, demo/simulate POST {} 401 — unchanged. Browser: /api/demo/mode was NOT called on landing, Brand Studio, or a direct ops-admin.html visit (0 demo/mode requests in the full call log) | reverify/route-probe.md · reverify/spot-check.md | PASS-STILL |

### Board line 781 — CHANGED-NOT-REGRESSION

Original (verbatim):

| S3 blocked: Reading data (intended 25, actual 45) | 403 | 42 probed: 4 → 403 (affiliates, entitlements, portal-contracts, portal-summary); 38 → 401 unauthorized incl. company-brain-affiliate (gate row says "affiliate, partner" — see failure block B); 3 UNVERIFIED (agent-context, agent-shadow-log, tradelines — no method) | route-probe.md | PASS (partial) — nothing leaked; 38 wrong status · 3 UNVERIFIED |

Proposed replacement:

| S3 blocked: Reading data (intended 25, actual 45) | 403 | Reverify: 42 probed: 4 → 403 (affiliates, entitlements, portal-contracts, portal-summary); 37 → 401; 1 CHANGED: /api/read/company-brain-affiliate POST {} now 400 question_required (was 401) — the ship moved it to requirePrincipal(affiliate, partner) so a partner now reaches it, matching the -actual.md gate text; failure block B is resolved. Nothing leaked. 3 UNVERIFIED (agent-context, agent-shadow-log, tradelines) | reverify/route-probe.md · reverify/route-probe.json · reverify/spot-check.md | CHANGED-NOT-REGRESSION |

### Board line 785 — PASS-STILL

Original (verbatim):

| S3 blocked: Everything else (intended 13, actual 24) | 403 | 23 probed: 6 → 403 (documents-upload, inquiries, messages, pii, shifts, tasks); 17 → 401 unauthorized (agents, ai-bureau-config, applications, call-outcomes, closer-deck, contracts, customer-insights, inquiry-cases, journeys, lender-observations, lenders, marketing-flags, message-templates, messages-outbound, payment-links, pipeline-cards, products); /api/inquiry UNVERIFIED (no method) | route-probe.md | PASS (partial) — nothing leaked · 1 UNVERIFIED |

Proposed replacement:

| S3 blocked: Everything else (intended 13, actual 24) | 403 | Reverify: 23 probed: 6 → 403 (documents-upload, inquiries, messages, pii, shifts, tasks); 17 → 401; /api/inquiry UNVERIFIED. Identical to original. Nothing leaked | reverify/route-probe.md | PASS-STILL |

### Board line 786 — PASS-STILL

Original (verbatim):

| S4 UI: landing screen detail | partner-galaxy loads its data without forbidden/failed API calls; no controls the principal cannot use; no "sample/not signed in" wording | 0 API 4xx/5xx, 0 console errors on landing (calls traced in code: /api/auth/session, /api/read/partners, /api/org-brand — shell skips /api/demo/mode for partner, shell.js L1577). Page shows Fundhub cluster map with every cluster "0 working · 0 total", all six bottom metrics "—", banner "PARTNER VIEW — your book only…", footer "live partner census · 1 partner(s) · $0 accrued · 1 agreement(s) unsigned", "Your page · https://fundhub.ai/sites/<partner_id>/apply". No sample/demo wording. Only Sign out + cluster zoom controls (read-only). Cosmetic: top bar text crowds ("1 partner on file" / clock clipped); lower half of viewport empty | shots/01-landing.png · shots/03-_app_partner-galaxy.html.png · ui-walk.json landing | PASS |

Proposed replacement:

| S4 UI: landing screen detail | partner-galaxy loads its data without forbidden/failed API calls; no controls the principal cannot use; no "sample/not signed in" wording | Reverify: 0 API 4xx/5xx, 0 console errors on landing. Full call log: GET /api/auth/session 200 (x2), /api/read/partners?limit=200 200, /api/health 200, /api/org-brand 200 — no /api/demo/mode. Cluster map all "0 working · 0 total", six metrics "—", banner "PARTNER VIEW — your book only", footer "live partner census · 1 partner(s) · $0 accrued · 1 agreement(s) unsigned". Same cosmetics (top-bar crowding, empty lower half) | reverify/shots/01-landing.png · reverify/shots/sc-partner-galaxy.png · reverify/spot-check.md | PASS-STILL |

### Board line 787 — CHANGED-NOT-REGRESSION

Original (verbatim):

| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call (shell.js ROLE_TABS.partner L221 = partner-galaxy, brand-studio) | 2 visible / 34 sidebar links (galaxy logo link + Brand Studio); matches ROLE_TABS.partner. 2 screens opened, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors. Brand Studio opened as /app/brand-studio.html?partner_id=<uuid> in partner mode: brand name "TEST — White-Label Partner Role", Domain "— not connected", Funnels 0 of 6, Compliance "Locked", live preview renders. Offers a "Verify" domain button that POSTs to owner/admin-only /api/partner-brand/verify-domain (not clicked — see failure block C) | ui-walk.md · shots/03-_app_partner-galaxy.html.png · shots/04-brand-studio.html.png | PASS (partial) |

Proposed replacement:

| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call (shell.js ROLE_TABS.partner L221 = partner-galaxy, brand-studio) | Reverify: 2 visible / 34 links; 2 screens opened, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors. CHANGED: Brand Studio final URL is now /app/brand-studio.html (no ?partner_id= reload) because login.html now stores fh_account and brand-studio.html L500-501 reads partnerId from it; page still in partner mode (footer "partner brand · TEST — White-Label Partner Role · draft", brand name filled, Domain "— not connected", Funnels 0 of 6, Compliance Locked; calls: partner-brand?partner_id 200, partner-pages?partner_id 200). "Verify" button still present, still owner/admin-only (verify-domain POST {} → 401 in probe) — LOW unchanged | reverify/ui-walk.md · reverify/shots/04-brand-studio.html.png · reverify/shots/sc-brand-studio.png · reverify/spot-check.md · reverify/route-probe.md | CHANGED-NOT-REGRESSION |

## Section header line (L746) — proposed addendum

Append after the existing header paragraph:

**Reverify (claude-fable-5, 2026-08-17T05:48Z–05:52Z, live commit 2b1eed0):** probe + UI walk + spot-check re-run as partner@fundhub.ai → docs/workflows/e2e-verify-run5-evidence/white-label/reverify/. Route probe identical to batch 1 except /api/read/company-brain-affiliate POST {} 401 → 400 question_required (fix intended; failure block B resolved). UI walk identical except Brand Studio URL no longer carries ?partner_id= (fh_account now stored at login; still partner mode). No regression. 3 logins used, no 429.

## Failure block B (L796-799) — proposed status note

Append one line: "**Reverify 2026-08-17T05:48Z:** POST {} with the partner token → 400 question_required (docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md, docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md). Handler now uses requirePrincipal(affiliate, partner) — an account partner reaches it. Resolved by 2b1eed0; the -actual.md row now matches code (still listed under the blocked table — DOC-GAP row placement only)."

## Spot-checks (fix side effects on this role)

| Check | Expected | Observed (reverify) | Evidence | Verdict |
|---|---|---|---|---|
| (a) /api/demo/mode called on any partner screen? | never called for partner (shell.js L1577 guard now owner/admin only) | 0 requests to /api/demo/mode across landing, Brand Studio, and a direct /app/ops-admin.html visit (full call log recorded). Direct GET with partner token → 401 unauthorized (unchanged from batch 1) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md | PASS-STILL |
| (b) GET /api/read/messages?status=blocked with partner token | denied (staff-only readHandler); ops-admin not offered to partner | 401 unauthorized (35 bytes, keys ok,error); GET /api/read/messages with no params also 401. Direct /app/ops-admin.html visit is bounced by the shell to /app/partner-galaxy.html before any messages call fires (call log: session, read/partners, health, org-brand only) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/sc-ops-admin-direct.png | PASS-STILL (401 not 403 — same LOW wrong-status as failure block A) |
| (c) POST {} /api/read/company-brain-affiliate with partner token | 400 question_required (handler now requirePrincipal affiliate/partner) | 400 question_required (40 bytes, keys ok,error) in both probe and spot-check; batch 1 had 401 unauthorized | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md | CHANGED-NOT-REGRESSION (fix effect; the route is now reachable to the partner as the -actual.md gate text says) |
| (d) localStorage fh_account after login | recorded only | fh_account PRESENT (new since ship): keys accountId, affiliateId, clientId, email, kind, name, orgId, partnerId; kind=partner; partnerId present, clientId/affiliateId absent. fh_role=partner; fh_token present; localStorage keys = fh_account, fh_role, fh_token. Side effect: Brand Studio reads partnerId from fh_account and no longer reloads with ?partner_id= | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.json | CHANGED-NOT-REGRESSION |
| UI walk overall (any new failing endpoint on a screen clean in batch 1?) | 0 API 4xx/5xx, 0 console errors on both partner screens | partner-galaxy: 0/0; brand-studio: 0/0. Every /api/ call on both screens answered 200 (session, read/partners, health, org-brand, partner-brand?partner_id, partner-pages?partner_id) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/ui-walk.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.md | PASS-STILL |
| Route probe overall | same counts as batch 1 | reach 17/18 probed OK · 21 UNVERIFIED · 1 "FAIL" (contracts/sign 404 by design) — same; blocked 15 → 403, 91 → 401, 1 → 400 (batch 1: 15 / 92 / 0); not-signed-in 6/6 → 401. Only cell that changed: company-brain-affiliate | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.md · docs/workflows/e2e-verify-run5-evidence/white-label/reverify/route-probe.json | PASS-STILL (one CHANGED-NOT-REGRESSION cell) |

