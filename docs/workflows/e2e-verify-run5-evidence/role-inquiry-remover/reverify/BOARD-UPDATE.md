# BOARD-UPDATE — role-inquiry-remover (reverify, claude-fable-5)

Board: `docs/workflows/fable-audit-2026-08-16.md`. Line numbers are 1-indexed as of the board at commit 2b1eed0 (read 2026-08-17T05:47Z). This journey had **no FIXED-UNCLICKED rows**; every row below is a spot-check for side effects of ship commit 2b1eed0. Verdicts: PASS-STILL / CHANGED-NOT-REGRESSION / REGRESSION / UNVERIFIED. **No REGRESSION found.**

Evidence root for every replacement row: `docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/` (abbreviated `reverify/` below). Original rows are quoted verbatim.

Rule the parent should apply: for rows marked PASS-STILL where nothing changed, the parent may leave the row and only append the reverify evidence path + verdict; the replacement text below is offered in full so it can be pasted either way.

---

## Findings table (lines 87–115)

### Line 87 — S1 sign in — PASS-STILL

Original:
```
| role-inquiry-remover | S1 sign in | login 200 ok=true role=inquiry_specialist token+cookie; session 200 | HTTP 200 ok=true role=inquiry_specialist token=true cookie=true; /api/auth/session 200 role=inquiry_specialist | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/route-probe.json; shots/00-login-page.png; shots/01-landing.png | PASS | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S1 sign in | login 200 ok=true role=inquiry_specialist token+cookie; session 200 | REVERIFY 2026-08-17T05:48Z (live 2b1eed0): HTTP 200 ok=true role=inquiry_specialist token=true cookie=true; /api/auth/session 200 role=inquiry_specialist; browser login form left login.html, fh_role=inquiry_specialist stored, 0 API 4xx during sign-in (was 1: /api/demo/mode 403) | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/route-probe.json; reverify/ui-walk.json login; reverify/shots/00-login-page.png; reverify/shots/01-landing.png | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 88 — S1b landing — PASS-STILL

Original:
```
| role-inquiry-remover | S1b landing | lands on inquiry-remover.html per shell.js HOME map | landed at /app/inquiry-remover.html (Fundhub — Inquiry Remover); header TEST — Inquiry Specialist Role · 24 tabs · LIVE; empty state (No inquiries in the database yet, No active cases, queue 0/0/0) | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/01-landing.png; shots/02-app-shell.png | PASS | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S1b landing | lands on inquiry-remover.html per shell.js HOME map | REVERIFY 2026-08-17T05:49Z: landed at /app/inquiry-remover.html (Fundhub — Inquiry Remover); header TEST — Inquiry Specialist Role · 24 tabs · LIVE; empty state (No inquiries in the database yet, No active cases, queue 0/0/0); 7 API calls on load, 0 4xx/5xx (was 1: /api/demo/mode 403); no demo banner mounted; blank red strip (line 112) still present | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/shots/01-landing.png; reverify/shots/02-app-shell.png; reverify/spot-check.json screens.inquiry-remover.html | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 91 — S2 reach: Campaigns — PASS-STILL

Original:
```
| role-inquiry-remover | S2 reach: Campaigns (intended 6, actual 8) | 8 routes not 401/403/404 | 6/6 probed OK (400 partner_id_required), 2 unverified write-only | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/route-probe.md | PASS | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S2 reach: Campaigns (intended 6, actual 8) | 8 routes not 401/403/404 | REVERIFY 2026-08-17T05:48Z: 6/6 probed OK (400 partner_id_required), 2 unverified write-only — identical to original | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 100 — S2 reach: Reading data — PASS-STILL (doc gap unchanged, still open)

Original:
```
| role-inquiry-remover | S2 reach: Reading data (intended 19, actual 35) | 35 routes not 401/403/404 | 29/30 probed OK, 5 unverified; /api/read/my-numbers GET → 403 My numbers is for closers (second gate api/read/my-numbers.mjs lines 42-46 not reflected in actual.md) | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/route-probe.md | DOC-GAP | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S2 reach: Reading data (intended 19, actual 35) | 35 routes not 401/403/404 | REVERIFY 2026-08-17T05:48Z: 29/30 probed OK, 5 unverified; /api/read/my-numbers GET → 403 forbidden — identical to original; DOC-GAP still open, no regression | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/route-probe.md | DOC-GAP (PASS-STILL) | claude-fable-5 (reverify) |
```

### Line 103 — S2 reach: Everything else — PASS-STILL

Original:
```
| role-inquiry-remover | S2 reach: Everything else (intended 12, actual 23) | 23 routes not 401/403/404 | 7/7 probed OK (applications 400, inquiries 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400, tasks 200), 16 unverified write-only | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/route-probe.md | PASS | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S2 reach: Everything else (intended 12, actual 23) | 23 routes not 401/403/404 | REVERIFY 2026-08-17T05:48Z: 7/7 probed OK (applications 400, inquiries 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400, tasks 200), 16 unverified write-only — identical to original. One-off GETs: /api/read/inquiry-cases 200 cases[0], /api/read/inquiries 200 items[0], /api/pii 400 client_id must be a uuid | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/route-probe.md; reverify/inquiry-route-check.json | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 106 — S3 blocked: all 15 groups — PASS-STILL

Original:
```
| role-inquiry-remover | S3 blocked: all 15 groups (50 routes) | all 50 answer 403 | 50/50 → 403 (Signing in and out 3, banking 2, chat 1, company-brain 2, consent 1, demo 2, Finance 6, Hiring 6, journeys 2, partner-brand 1, privacy 1, proxy 2, Reading data 11, staff 2, Everything else 8) | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/route-probe.md | PASS | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S3 blocked: all 15 groups (50 routes) | all 50 answer 403 | REVERIFY 2026-08-17T05:48Z: 50/50 → 403, 0 unverified, 0 fail (Signing in and out 3, banking 2, chat 1, company-brain 2, consent 1, demo 2, Finance 6, Hiring 6, journeys 2, partner-brand 1, privacy 1, proxy 2, Reading data 11, staff 2, Everything else 8) — identical to original | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 107 — S4 not signed in — PASS-STILL

Original:
```
| role-inquiry-remover | S4 not signed in | 401 | 6/6 → 401 | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/route-probe.md Not signed in | PASS | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S4 not signed in | 401 | REVERIFY 2026-08-17T05:48Z: 6/6 → 401 — identical to original | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/route-probe.md Not signed in | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 108 — S5 UI: /api/demo/mode 403 on every screen — CHANGED-NOT-REGRESSION (mostly gone; 6 page-level callers remain)

Original:
```
| role-inquiry-remover | S5 UI: /api/demo/mode 403 on every screen | screens open without a forbidden API call | shell.js mountDemoBanner (line 1582) calls GET /api/demo/mode for every staff role; owner/admin-only → 403 on all 24 screens + login + landing; handled silently, one console error per page | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/ui-walk.md; ui-walk.json | LOW | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S5 UI: /api/demo/mode 403 on every screen | screens open without a forbidden API call | REVERIFY 2026-08-17T05:49Z (live 2b1eed0): shell.js mountDemoBanner now returns for non-owner/admin — GET /api/demo/mode 403 gone from login, landing and 18 of 24 screens; total demo/mode 4xx 32 → 6. Still 403 once each on 6 screens whose own page scripts call it: closer-dashboard, finance-os, client-control-panel, documents (public/app/demo-client-bootstrap.js line 23), ops-admin (ops-admin.html line 994), sample-data (sample-data.html line 374). Handled silently; one console error each | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/ui-walk.md; reverify/ui-walk.json; reverify/spot-check.json demoMode | LOW → CHANGED-NOT-REGRESSION (improved, 6 residual page-level callers) | claude-fable-5 (reverify) |
```

### Line 109 — S5 UI: admin screens offered but data 403 — PASS-STILL (finding unchanged, still open)

Original:
```
| role-inquiry-remover | S5 UI: admin screens offered but data 403 | a screen the role can open loads its data or is not offered | sidebar shows Ops & Admin, Agent Editor, Staff & Teams, Products & Commissions, Demo Mode (ROLE_TABS staff); ops-admin → read/failed-events 403, read/invoices 403, read/staff 403; agent-editor and staff-teams → read/staff 403 (headcount 0, No one matches that filter); products-commissions → read/commissions 403; banners say not signed in for real data although signed in (data.js line 107 folds 403 into unauthorized) | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/16-ops-admin.html.png; shots/17-agent-editor.html.png; shots/24-staff-teams.html.png; shots/25-products-commissions.html.png; ui-walk.md | MEDIUM | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S5 UI: admin screens offered but data 403 | a screen the role can open loads its data or is not offered | REVERIFY 2026-08-17T05:49Z: unchanged — same 5 admin tabs visible (25/34 sidebar links identical); ops-admin → read/failed-events 403, read/invoices 403, read/staff 403; agent-editor → read/staff 403; staff-teams → read/staff 403; products-commissions → read/commissions 403; footer still says "not signed in for real data". Not touched by 2b1eed0; no regression | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/shots/16-ops-admin.html.png; reverify/shots/17-agent-editor.html.png; reverify/shots/24-staff-teams.html.png; reverify/shots/25-products-commissions.html.png; reverify/ui-walk.md | MEDIUM (PASS-STILL — still open) | claude-fable-5 (reverify) |
```

### Line 110 — S5 UI: campaign-manager.html — PASS-STILL (finding unchanged, still open)

Original:
```
| role-inquiry-remover | S5 UI: campaign-manager.html | live data or honest empty state | 5 reads (fatigue, list, connections, action-log, spend) → 400 partner_id_required; screen shows sample Ironwood Capital Group numbers with badrequest markers | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/20-campaign-manager.html.png; ui-walk.md | LOW | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S5 UI: campaign-manager.html | live data or honest empty state | REVERIFY 2026-08-17T05:49Z: unchanged — same 5 reads (fatigue, list, connections, action-log, spend) → 400; /api/demo/mode 403 no longer on this screen; no regression | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/shots/20-campaign-manager.html.png; reverify/ui-walk.md | LOW (PASS-STILL — still open) | claude-fable-5 (reverify) |
```

### Line 111 — S5 UI: ops-admin.html read/messages 400 — CHANGED-NOT-REGRESSION (now works)

Original:
```
| role-inquiry-remover | S5 UI: ops-admin.html read/messages 400 | blocked-messages panel loads | GET /api/read/messages?status=blocked&limit=30 → 400 invalid_parameter; panel stuck on Loading blocked messages... | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/16-ops-admin.html.png; ui-walk.md | LOW | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S5 UI: ops-admin.html read/messages 400 | blocked-messages panel loads | REVERIFY 2026-08-17T05:52Z (live 2b1eed0): GET /api/read/messages?status=blocked&limit=30 → 200 {ok:true, count, limit, offset, hasMore, items[0]}; panel reads "No messages stopped by the compliance gate"; footer "live compliance gate · 0 blocked" (was 400 + "Loading blocked messages..." + "request was rejected") | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/spot-check.json opsAdminMessages; reverify/shots/spot-ops-admin.png; reverify/ui-walk.md | CHANGED-NOT-REGRESSION (side-effect fix; panel now loads) | claude-fable-5 (reverify) |
```

### Line 112 — S1b UI: blank red strip — PASS-STILL (finding unchanged, still open)

Original:
```
| role-inquiry-remover | S1b UI: blank red strip on Inquiry Remover | no error box when there is no error | empty red-bordered pill above Queue by Bureau; inquiry-remover.html line 352 systemAlert hidden but CSS line 91 .system-alert display:flex overrides hidden; no JS fills it | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/01-landing.png; shots/13-inquiry-remover.html.png | LOW | claude-fable-5 |
```
Replacement:
```
| role-inquiry-remover | S1b UI: blank red strip on Inquiry Remover | no error box when there is no error | REVERIFY 2026-08-17T05:52Z: unchanged — #systemAlert isVisible=true, empty red-bordered pill still drawn above Queue by Bureau; not touched by 2b1eed0 | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/shots/spot-inquiry-remover-landing.png; reverify/spot-check.json screens.inquiry-remover.html.systemAlertVisible | LOW (PASS-STILL — still open) | claude-fable-5 (reverify) |
```

---

## Section "## role-inquiry-remover (batch 2)" (lines 280–370)

Line 282 header — proposed append: `· **Reverify:** claude-fable-5, 2026-08-17T05:48–05:54Z against live 2b1eed0, evidence docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/ — no regression`.

### Line 288 — S1 sign in — PASS-STILL
Original:
```
| S1 sign in | login 200, ok=true, role=inquiry_specialist, token + cookie set; session 200 | HTTP 200, ok=true, role=inquiry_specialist, token=true, cookie=true; /api/auth/session 200 role=inquiry_specialist | route-probe.json login + shots/00-login-page.png, shots/01-landing.png | PASS |
```
Replacement:
```
| S1 sign in | login 200, ok=true, role=inquiry_specialist, token + cookie set; session 200 | REVERIFY 05:48Z: HTTP 200, ok=true, role=inquiry_specialist, token=true, cookie=true; /api/auth/session 200 role=inquiry_specialist; browser sign-in 0 API 4xx (was 1) | reverify/route-probe.json login + reverify/shots/00-login-page.png, reverify/shots/01-landing.png | PASS-STILL |
```

### Line 289 — S1b landing — PASS-STILL
Original:
```
| S1b landing | lands on inquiry-remover.html (shell.js HOME map) | landed at /app/inquiry-remover.html, title "Fundhub — Inquiry Remover"; header "TEST — Inquiry Specialist Role · inquiry_specialist · 24 tabs · LIVE"; empty state ("No inquiries in the database yet.", "No active cases.", queue 0/0/0); one blank red-bordered strip above "Queue by Bureau" | shots/01-landing.png, shots/02-app-shell.png | PASS |
```
Replacement:
```
| S1b landing | lands on inquiry-remover.html (shell.js HOME map) | REVERIFY 05:49Z: landed at /app/inquiry-remover.html, title "Fundhub — Inquiry Remover"; header "TEST — Inquiry Specialist Role · inquiry_specialist · 24 tabs · LIVE"; empty state ("No inquiries in the database yet.", "No active cases.", queue 0/0/0); blank red-bordered strip still present; 0 API 4xx on landing (was 1: demo/mode 403) | reverify/shots/01-landing.png, reverify/shots/02-app-shell.png, reverify/spot-check.json | PASS-STILL |
```

### Line 292 — S2 reach: Campaigns — PASS-STILL
Original:
```
| S2 reach: Campaigns (intended 6, actual 8) | all 8 answer not 401/403/404 | 6/6 probed OK (all 400 partner_id_required), 2 unverified (write-only) | route-probe.md | PASS |
```
Replacement:
```
| S2 reach: Campaigns (intended 6, actual 8) | all 8 answer not 401/403/404 | REVERIFY 05:48Z: 6/6 probed OK (all 400 partner_id_required), 2 unverified (write-only) — identical | reverify/route-probe.md | PASS-STILL |
```

### Line 301 — S2 reach: Reading data — PASS-STILL (doc gap still open)
Original:
```
| S2 reach: Reading data (intended 19, actual 35) | all 35 answer not 401/403/404 | 29/30 probed OK, 5 unverified; 1 FAIL: /api/read/my-numbers GET → 403 "My numbers is for closers" (second gate in api/read/my-numbers.mjs lines 42-46 not shown in actual.md) | route-probe.md | FAIL (doc gap, not role-defining) |
```
Replacement:
```
| S2 reach: Reading data (intended 19, actual 35) | all 35 answer not 401/403/404 | REVERIFY 05:48Z: 29/30 probed OK, 5 unverified; same 1 FAIL: /api/read/my-numbers GET → 403 forbidden — identical to original | reverify/route-probe.md | FAIL (doc gap) — PASS-STILL, no regression |
```

### Line 304 — S2 reach: Everything else — PASS-STILL
Original:
```
| S2 reach: Everything else (intended 12, actual 23) | all 23 answer not 401/403/404 | 7/7 probed OK (applications 400, inquiries 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200), 16 unverified (write-only). Extra one-off: /api/inquiry?action=cases GET → 503 not_configured (INQUIRY_API_SECRET not set on this deploy) | route-probe.md; scratch one-off (status + shape only) | PASS with note |
```
Replacement:
```
| S2 reach: Everything else (intended 12, actual 23) | all 23 answer not 401/403/404 | REVERIFY 05:48–05:54Z: 7/7 probed OK (applications 400, inquiries 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200), 16 unverified (write-only) — identical. One-off: /api/inquiry?action=cases GET → 503 not_configured (unchanged; owner-set hold); /api/read/inquiry-cases 200 cases[0]; /api/read/inquiries 200 items[0]; /api/pii 400 | reverify/route-probe.md; reverify/inquiry-route-check.json | PASS with note — PASS-STILL |
```

### Lines 306–320 — S3 blocked (15 rows) — PASS-STILL
All 15 rows unchanged: 50/50 → 403, group counts identical (3,2,1,2,1,2,6,6,2,1,1,2,11,2,8). Proposed edit: leave the rows, change Evidence to `reverify/route-probe.md` and Result to `PASS-STILL` on each, or add one summary line under the table: `REVERIFY 2026-08-17T05:48Z: S3 blocked 50/50 → 403 on live 2b1eed0 — PASS-STILL (reverify/route-probe.md).`

### Line 321 — S4 not signed in — PASS-STILL
Original:
```
| S4 not signed in | 401 | 6/6 → 401 | route-probe.md "Not signed in" | PASS |
```
Replacement:
```
| S4 not signed in | 401 | REVERIFY 05:48Z: 6/6 → 401 — identical | reverify/route-probe.md "Not signed in" | PASS-STILL |
```

### Line 322 — S5 UI walk — CHANGED-NOT-REGRESSION
Original:
```
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 24 screens opened (25 visible links; command-center listed twice), 0 bounced, 24/24 had at least one API 4xx/5xx. Distinct endpoints: GET /api/demo/mode → 403 (every screen + login/landing); GET /api/read/staff → 403 (ops-admin, agent-editor, staff-teams); GET /api/read/failed-events → 403, GET /api/read/invoices → 403, GET /api/read/messages?status=blocked → 400 (ops-admin); GET /api/read/commissions → 403 (products-commissions); GET /api/campaigns/{fatigue,list,connections,action-log,spend} → 400 partner_id_required (campaign-manager) | ui-walk.md, ui-walk.json | FAIL |
```
Replacement:
```
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | REVERIFY 05:49Z (live 2b1eed0): 24 screens opened (25 visible / 34 total links, identical list), 0 bounced, 10/24 had ≥1 API 4xx/5xx (was 24/24); 0 NEW failing endpoints vs original. Distinct endpoints now: GET /api/demo/mode → 403 only on closer-dashboard, finance-os, client-control-panel, documents, ops-admin, sample-data (page-level callers; gone from login/landing/other 18); GET /api/read/staff → 403 (ops-admin, agent-editor, staff-teams); GET /api/read/failed-events → 403, GET /api/read/invoices → 403 (ops-admin); GET /api/read/messages?status=blocked → 200 now (was 400); GET /api/read/commissions → 403 (products-commissions); GET /api/campaigns/{fatigue,list,connections,action-log,spend} → 400 (campaign-manager). Console errors 42 → 17 | reverify/ui-walk.md, reverify/ui-walk.json | FAIL → CHANGED-NOT-REGRESSION (fewer failures; remaining ones are the open MEDIUM/LOW rows) |
```

### Failure block "S5 UI walk — /api/demo/mode 403 on every screen" (lines 326–330)
Proposed append line: `- REVERIFY 2026-08-17T05:49Z (2b1eed0): shell.js no longer calls it for this role. 26 of 32 calls gone (login, landing, 18 screens clean). 6 remain from page scripts: demo-client-bootstrap.js (closer-dashboard, finance-os, client-control-panel, documents), ops-admin.html line 994, sample-data.html line 374. CHANGED-NOT-REGRESSION; residual LOW.`

---

## Spot-checks (side effects of 2b1eed0 on this role)

| # | Check | Expected | Observed (my run) | Evidence | Verdict |
|---|---|---|---|---|---|
| a | GET /api/demo/mode still called / 403 for this role? | shell.js fix removes it for staff | Login: 0 (was 1). Landing: 0 (was 1). Screens: 6/24 still call it once each → 403 (closer-dashboard, finance-os, client-control-panel, documents via demo-client-bootstrap.js; ops-admin.html line 994; sample-data.html line 374); 18/24 clean. Total 32 → 6 | reverify/spot-check.json demoMode; reverify/ui-walk.json | CHANGED-NOT-REGRESSION |
| b | ops-admin.html GET /api/read/messages?status=blocked&limit=30 | 200 (was 400 for staff) | 200 {ok:true, count, limit, offset, hasMore, items[0]}; panel "No messages stopped by the compliance gate"; footer "live compliance gate · 0 blocked" | reverify/spot-check.json opsAdminMessages; reverify/shots/spot-ops-admin.png | CHANGED-NOT-REGRESSION (works now) |
| c | white-label POST {} /api/read/company-brain-affiliate | n/a — white-label only | not run for this journey (staff role; owner of that check is the white-label reverify) | — | UNVERIFIED (not applicable) |
| d | localStorage fh_account after staff login | recorded | keys after login: fh_role, fh_token only; fh_account absent (login.html line 242-243 sets it only when the reply has `account`; staff reply does not, so it removes it); fh_role=inquiry_specialist; fh_token present (value not read) | reverify/spot-check.json localStorage | PASS-STILL (no visible change for staff) |
| e | Route probe vs original | identical | route-probe.md identical to original minus Ran line (diff empty): 54/57 reach OK, 49 unverified, 3 fails (contracts/sign 404, read/my-numbers 403, repair/exceptions 403); 50/50 blocked 403; 6/6 unauth 401 | reverify/route-probe.md, reverify/route-probe.json | PASS-STILL |
| f | New failing endpoint on any screen that was clean before | none | none — programmatic diff of (screen, endpoint, status) sets between original ui-walk.json and reverify ui-walk.json: 0 new, 21 gone | reverify/ui-walk.json vs ../ui-walk.json | PASS-STILL |
| g | Sidebar / screens changed by hiring.html, staff-teams.html, command-center.html edits | same 25 visible / 34 links, 0 bounced | identical sidebar (JSON equal), 24 screens, 0 bounced; staff-teams still read/staff 403 only; command-center 0 4xx (was demo/mode 403) | reverify/ui-walk.md | PASS-STILL |
| h | /api/inquiry?action=cases (role-defining, board line 104 MEDIUM) | unchanged (owner hold) | 503 not_configured, unchanged | reverify/inquiry-route-check.json | PASS-STILL (still open, owner-set hold) |
