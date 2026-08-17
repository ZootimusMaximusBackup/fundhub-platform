# role-sales-manager — BOARD-UPDATE (reverify after 2b1eed0)

Proposed replacements for docs/workflows/fable-audit-2026-08-16.md. Board is NOT edited by the auditor; the parent applies. Line numbers are 1-indexed as of commit 2b1eed0. Findings-table columns: | Journey | Step | Expected | Observed | Evidence | Severity | Model |.

Verdict key: PASS-STILL = a PASS row that still passes with my numbers; CHANGED-NOT-REGRESSION = differs from the original but is not worse. No REGRESSION found for this role.

## Findings-table rows (lines 116-135)

### Line 116 — S1 sign in — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S1 sign in | POST /api/auth/login 200 with staff.role=sales_manager, token and cookie; browser leaves login.html | HTTP 200, ok=true, role=sales_manager, token=true, cookie=true; session 200 role=sales_manager; browser left login.html with fh_role=sales_manager | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/route-probe.json; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/shots/00-login-page.png | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S1 sign in | POST /api/auth/login 200 with staff.role=sales_manager, token and cookie; browser leaves login.html | HTTP 200, ok=true, role=sales_manager, token=true, cookie=true; session 200 role=sales_manager; browser left login.html with fh_role=sales_manager; login now fires 0 API 4xx (was 1: demo/mode 403) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.json; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/00-login-page.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md | PASS-STILL | claude-fable-5 (reverify) |

### Line 117 — S1b landing — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S1b landing | lands on /app/sales-floor.html (shell.js HOME.sales_manager) | Landed at /app/sales-floor.html; live sales-floor data ($5 cash collected, 5 held, 1 closer row); header chip sales_manager 25 tabs LIVE; only 4xx is GET /api/demo/mode 403 | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/shots/01-landing.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/shots/02-app-shell.png | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S1b landing | lands on /app/sales-floor.html (shell.js HOME.sales_manager) | Landed at /app/sales-floor.html (Sales floor · Fundhub); live data ($5 cash collected, 0 booked / 5 held / 0 deposits / 0 funded / 5 downsells, 1 closer row); header chip TEST — Sales Manager Role · sales_manager · 25 tabs LIVE; 0 API 4xx on landing (was 1: GET /api/demo/mode 403 — gone after shell.js fix) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-01-landing.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/01-landing.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.json | PASS-STILL | claude-fable-5 (reverify) |

### Line 118 — S2 reach: Reading data (intended 25, actual 43) — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S2 reach: Reading data (intended 25, actual 43) | all 43 routes answer not 401/403/404 | 37/38 probed OK, 5 unverified; role-defining routes sales-floor 200 (closers[1]), commissions 200 (items[0]), staff 200 (items[1]), my-numbers 200 (owed[10]) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/route-probe.md | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S2 reach: Reading data (intended 25, actual 43) | all 43 routes answer not 401/403/404 | 37/38 probed OK, 5 unverified — identical to original; the 1 non-OK is still banking-surface 403 (plaid switch); sales-floor 200 (2455 bytes), commissions 200 (70 bytes), staff 200 (397 bytes), my-numbers 200 (4180 bytes); 0 status diffs vs original across all 38 | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.json | PASS-STILL | claude-fable-5 (reverify) |

### Line 122 — S2 reach: Campaigns (intended 6, actual 8), Creative Factory (4/7), Finance (9/9), banking (2/2), chat (0/3), company-brain (0/1), public (0/3), staff (0/1), Everything else (11/25), Signing in and out (6/6) — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S2 reach: Campaigns (intended 6, actual 8), Creative Factory (4/7), Finance (9/9), banking (2/2), chat (0/3), company-brain (0/1), public (0/3), staff (0/1), Everything else (11/25), Signing in and out (6/6) | all probed GET routes answer not 401/403/404 | Campaigns 6/6 OK (400 partner_id_required), Creative 4/4 OK, Finance 8/8 OK, banking 1/1, chat 2/2 (200), company-brain 1/1 (200), public 1/1, staff 1/1, Everything else 7/7, auth 1/1; remaining routes unverified write-only | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/route-probe.md | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S2 reach: Campaigns (intended 6, actual 8), Creative Factory (4/7), Finance (9/9), banking (2/2), chat (0/3), company-brain (0/1), public (0/3), staff (0/1), Everything else (11/25), Signing in and out (6/6) | all probed GET routes answer not 401/403/404 | Campaigns 6/6 OK (400 partner_id_required), Creative 4/4 OK, Finance 8/8 OK, banking 1/1, chat 2/2 (200), company-brain 1/1 (200), public 1/1, staff 1/1, Everything else 7/7, auth 1/1 — same counts as original, 0 status diffs; write-only routes still unverified | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |

### Line 124 — S3 blocked: all 15 groups (Signing in and out 1/3, banking 1/1, chat 0/1, company-brain 0/1, consent 1/1, demo 0/2, Finance 1/1, Hiring 6/6, journeys 1/1, partner-brand 0/1, privacy 1/1, proxy 0/2, Reading data 1/3, staff 0/1, Everything else 4/6) — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S3 blocked: all 15 groups (Signing in and out 1/3, banking 1/1, chat 0/1, company-brain 0/1, consent 1/1, demo 0/2, Finance 1/1, Hiring 6/6, journeys 1/1, partner-brand 0/1, privacy 1/1, proxy 0/2, Reading data 1/3, staff 0/1, Everything else 4/6) | all 31 blocked routes answer 403 | 30/30 probed answered 403 (forbidden); 1 unverified (/api/inquiry has no GET/POST to probe safely); 0 open | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/route-probe.md | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S3 blocked: all 15 groups (Signing in and out 1/3, banking 1/1, chat 0/1, company-brain 0/1, consent 1/1, demo 0/2, Finance 1/1, Hiring 6/6, journeys 1/1, partner-brand 0/1, privacy 1/1, proxy 0/2, Reading data 1/3, staff 0/1, Everything else 4/6) | all 31 blocked routes answer 403 | 30/30 probed answered 403; 1 unverified (/api/inquiry); 0 open — identical to original, 0 status diffs | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.json | PASS-STILL | claude-fable-5 (reverify) |

### Line 125 — S4 not signed in — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S4 not signed in | 401 on reach routes without a token | 6/6 -> 401 (applications, banking/accounts, campaigns action-log/connections/detail/fatigue) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/route-probe.md | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S4 not signed in | 401 on reach routes without a token | 6/6 -> 401 (applications, banking/accounts, campaigns action-log/connections/detail/fatigue) — same as original | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |

### Line 126 — S5 UI: ops-admin.html — **CHANGED-NOT-REGRESSION**

Original (verbatim):

| role-sales-manager | S5 UI: ops-admin.html | screen opens without forbidden/failed API call | GET /api/read/failed-events -> 403 (owner/admin only) and GET /api/read/messages?status=blocked -> 400; Compliance gate panel stuck on Loading blocked messages, KPIs all dashes; screen half-works | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/shots/17-ops-admin.html.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/ui-walk.md | MEDIUM | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S5 UI: ops-admin.html | screen opens without forbidden/failed API call | GET /api/read/messages?status=blocked&limit=30 -> 200 (was 400); Compliance gate panel now reads "No messages stopped by the compliance gate" (no Loading, no "request was rejected"); GET /api/read/failed-events -> 403 still (owner/admin only, not in fix set) so KPIs remain dashes; page's own GET /api/demo/mode -> 403 once (ops-admin.html line 994) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-ops-admin.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.md | CHANGED-NOT-REGRESSION | claude-fable-5 (reverify) |

### Line 127 — S5 UI: sample-data.html (Demo Mode) — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S5 UI: sample-data.html (Demo Mode) | a sidebar row shown to the role opens a working screen | Sidebar shows Demo Mode to sales_manager; screen calls /api/demo/mode -> 403 twice and prints this endpoint is limited to owner, admin; counts panel empty | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/shots/27-sample-data.html.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/ui-walk.md | MEDIUM | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S5 UI: sample-data.html (Demo Mode) | a sidebar row shown to the role opens a working screen | Sidebar still shows Demo Mode to sales_manager; screen calls GET /api/demo/mode -> 403 once (was twice; shell.js call gone, page's own call remains) and still prints "limited to owner, admin"; not fixed, not worse | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-sample-data.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/27-sample-data.html.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md | PASS-STILL | claude-fable-5 (reverify) |

### Line 128 — S5 UI: /api/demo/mode 403 on every screen — **CHANGED-NOT-REGRESSION**

Original (verbatim):

| role-sales-manager | S5 UI: /api/demo/mode 403 on every screen | no forbidden API call per screen | shell.js mountDemoBanner (line 1582) polls /api/demo/mode for every staff role; owner/admin-only endpoint answers 403 on all 25 screens plus login; handled silently, one console error per screen | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/ui-walk.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/ui-walk.json | LOW | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S5 UI: /api/demo/mode 403 on every screen | no forbidden API call per screen | shell.js mountDemoBanner no longer calls /api/demo/mode for sales_manager: 0 calls on login, landing, and 19 of 25 screens (was 25/25 + login). Remaining 6 screens call it once each from page code, not shell.js: closer-dashboard, finance-os, client-control-panel, documents (demo-client-bootstrap.js line 23), ops-admin (line 994), sample-data (line 374). Total 27 -> 6 calls; console errors 38 -> 12 | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.json; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md | CHANGED-NOT-REGRESSION | claude-fable-5 (reverify) |

### Line 130 — S5 UI walk overall — **PASS-STILL**

Original (verbatim):

| role-sales-manager | S5 UI walk overall | every visible sidebar screen opens | 25 screens opened, 0 bounced, all HTTP 200; sidebar 26 visible / 34 total (closer-call, my-numbers, subscriptions, journeys, hiring, brand-studio, client-portal, affiliate hidden); products-commissions shows 5 live products, no commission rows | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/ui-walk.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/shots/26-products-commissions.html.png | PASS | claude-fable-5 |

Proposed replacement:

| role-sales-manager | S5 UI walk overall | every visible sidebar screen opens | 25 screens opened, 0 bounced, all HTTP 200; sidebar 26 visible / 34 total (same 8 hidden); 0 NEW failing endpoints vs original walk; screens with any API 4xx 25 -> 7 (6 demo/mode page-level + campaign-manager 5x400 partner_id_required); products-commissions shows 5 live products, no commission rows | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.json; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/26-products-commissions.html.png | PASS-STILL | claude-fable-5 (reverify) |

## Section rows (## role-sales-manager (batch 2), lines 378-417) — same verdicts, section format | Step | Expected | Observed | Evidence | Result |

| Board line | Step | Verdict | Observed (reverify) | Evidence |
|---|---|---|---|---|
| 380 | S1 sign in | PASS-STILL | reverify: HTTP 200 ok=true role=sales_manager token+cookie; session 200; browser left login.html, fh_role=sales_manager, fh_account absent (staff), 0 API 4xx during login | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.json; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md |
| 381 | S1b landing | PASS-STILL | reverify: /app/sales-floor.html, same live numbers ($5, 0/5/0/0/5, 1 closer), chip TEST — Sales Manager Role · sales_manager · 25 tabs LIVE; 0 API 4xx on landing (demo/mode call gone) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-01-landing.png |
| 395 | S2 reach: Reading data (intended 25, actual 43) | PASS-STILL | reverify: 37/38 probed OK, 5 unverified, banking-surface 403 plaid — 0 status diffs vs original | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md |
| 399 | S2 reach: Everything else (intended 11, actual 25) | PASS-STILL | reverify: 7/7 probed OK, 18 unverified — 0 status diffs | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md |
| 401 | S3 blocked: Signing in and out … through line 415 (all 15 groups) | PASS-STILL | reverify: 30/30 -> 403, 1 unverified (/api/inquiry) — 0 status diffs | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md |
| 416 | S4 not signed in | PASS-STILL | reverify: 6/6 -> 401 | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md |
| 417 | S5 UI walk | CHANGED-NOT-REGRESSION | reverify: 25 screens, 0 bounced, all 200, sidebar 26/34; 0 new failing endpoints; (a) demo/mode 403 now on 6/25 screens (page-level code) not 25/25 — shell.js fix confirmed for this role; (b) ops-admin messages?status=blocked -> 200, panel shows empty-state text, failed-events 403 remains; (c) campaign-manager still 5x 400 partner_id_required (unchanged, LOW); (d) sample-data still calls demo/mode -> 403 once and prints owner/admin text (unchanged, MEDIUM) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-ops-admin.png |

Note for line 417: the original Result was "FAIL (MEDIUM x2, LOW x2)". After 2b1eed0 the two MEDIUM items split: ops-admin messages 400 -> fixed (200 + empty-state text) but ops-admin failed-events 403 remains (owner/admin gate; KPI dashes persist); sample-data Demo Mode row unchanged (MEDIUM). LOW campaign-manager unchanged. LOW /api/demo/mode-on-every-screen is now 6/25 page-level calls (shell.js part fixed).

## Spot-checks (fix side effects on this role)

| # | Check | Expected | Observed | Evidence | Verdict |
|---|---|---|---|---|---|
| a | /api/demo/mode called / 403 on any screen for sales_manager | shell.js no longer calls it for non-owner/admin | 0 calls on login, landing, 19/25 screens. 6 screens still GET -> 403 once each from page code: closer-dashboard, finance-os, client-control-panel, documents (demo-client-bootstrap.js), ops-admin, sample-data. Was 25/25 screens + login (27 calls) -> now 6 calls | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.md; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md | CHANGED-NOT-REGRESSION |
| b | ops-admin.html GET /api/read/messages?status=blocked | accepted (not 400) | 200; compliance panel "No messages stopped by the compliance gate"; no Loading text, no "request was rejected"; footer "live compliance gate · 0 blocked". failed-events still 403 (owner/admin) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-ops-admin.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.json | CHANGED-NOT-REGRESSION |
| c | POST {} /api/read/company-brain-affiliate with partner token | white-label only | n/a for this role. Probe as sales_manager: POST {} -> 403 (blocked list, same as original) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.md | PASS-STILL |
| d | localStorage fh_account after staff login | recorded | keys = fh_role, fh_token; fh_account absent (login response has no account for staff; login.html removes key); fh_role = sales_manager | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md | PASS-STILL |
| e | Screens whose files changed in 2b1eed0 (staff-teams, command-center, hiring, ops-admin) | open without new failing calls | staff-teams 200, 0 API 4xx, footer "live roster · 1 staff · signed-in user not on roster · consent 0/1"; command-center 200, 0 API 4xx, footer "live agent registry · 9 cards updated · 2 agent(s) actually live · live KPIs"; hiring.html direct URL bounces to /app/sales-floor.html (HIRING_ONLY owner/admin gate, unchanged; sidebar row already hidden); ops-admin see (b) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-staff-teams.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/shots/spot-command-center.png; docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.md | PASS-STILL |
| f | Route probe full diff vs original | no status changes | 0 diffs across 72 reach + 30 blocked + 6 unauth probes; same 3 bad reach rows (contracts/sign 404, banking-surface 403, repair/exceptions 403) | docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/route-probe.json vs ../route-probe.json | PASS-STILL |
