# role-funding-advisor — proposed board updates (reverify, claude-fable-5)

Board: `docs/workflows/fable-audit-2026-08-16.md`. Line numbers are 1-indexed as of the file at the
time of this run (Findings table lines 42–86; section "## role-funding-advisor (batch 2)" rows
lines 201–235). The parent applies these; this file does not touch the board.

Verdict legend: PASS-STILL / CHANGED-NOT-REGRESSION / REGRESSION / UNVERIFIED. No REGRESSION found.
Ran 2026-08-17T05:48–05:52Z against https://fundhub.ai (shell.js fingerprint grep = 1) as advisor@fundhub.ai.
Evidence root for every replacement row: `docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/`.

---

## Findings-table rows (columns: Journey | Step | Expected | Observed | Evidence | Severity | Model)

### Line 42 — S1 sign in — PASS-STILL

Original:
```
| role-funding-advisor | S1 sign in | login page shown; /api/auth/login 200 with role=funding_advisor, token and cookie set | Login page rendered; login HTTP 200 ok=true role=funding_advisor token=true cookie=true; /api/auth/session 200 role=funding_advisor; browser left login.html with localStorage role=funding_advisor | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/route-probe.json; shots/00-login-page.png; shots/01-landing.png | PASS | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S1 sign in | login page shown; /api/auth/login 200 with role=funding_advisor, token and cookie set | Reverify 2026-08-17T05:48Z: login HTTP 200 ok=true role=funding_advisor token=true cookie=true; /api/auth/session 200 role=funding_advisor; browser left login.html with localStorage fh_role=funding_advisor; login-time API 4xx now 0 (was 1 — the demo/mode call is gone) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/route-probe.json; reverify/shots/00-login-page.png; reverify/shots/01-landing.png; reverify/spot-check.md | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 43 — S1b landing — PASS-STILL (observed changed for the better)

Original:
```
| role-funding-advisor | S1b landing | lands on /app/command-center.html (shell HOME map) | Landed at /app/command-center.html; chip TEST — Funding Advisor Role · funding_advisor · 24 tabs · LIVE; stage counters all render as dashes, Holds panel says no holds feed yet, no error banner; sidebar present | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/shots/01-landing.png; shots/02-app-shell.png; ui-walk.json | PASS | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S1b landing | lands on /app/command-center.html (shell HOME map) | Reverify: still lands at /app/command-center.html; chip TEST — Funding Advisor Role · funding_advisor · 24 tabs · LIVE; sidebar present; no error banner; 0 API 4xx on landing (was 1). Changed (not worse): pipeline summary now shows live counts (16 active clients; Sales row 1/1/3/0/0/0/1/0/0/10, other rows 0) instead of dashes; Holds panel now says No holds | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/shots/01-landing.png; reverify/shots/02-app-shell.png; reverify/ui-walk.json | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 60 — S2 reach: Everything else — PASS-STILL

Original:
```
| role-funding-advisor | S2 reach: Everything else (intended 11, actual 23) | 23 routes not 401/403/404 | 8/8 probed OK: applications 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200 (63 rows), inquiries 400, health 200; 15 unverified (POST-only, OPTIONS, or signed) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/route-probe.md; extra-get-probe.json | PASS | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S2 reach: Everything else (intended 11, actual 23) | 23 routes not 401/403/404 | Reverify: probe statuses identical to original (diff of Every-probe table empty): applications 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200, inquiries 400; 15 unverified (write-only). Whole reach side still 57/60 probed OK, same 3 known FAILs (contracts/sign 404, read/my-numbers 403, repair/exceptions 403) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/route-probe.md; reverify/route-probe.json | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 66 — S3 blocked: demo — PASS-STILL

Original:
```
| role-funding-advisor | S3 blocked: demo (intended 0, actual 2) | demo/mode, demo/simulate 403 | 2/2 403 (GET mode, POST {} simulate; DELETE not probed) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/route-probe.md | PASS | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S3 blocked: demo (intended 0, actual 2) | demo/mode, demo/simulate 403 | Reverify: 2/2 403 (GET mode, POST {} simulate; DELETE not probed) — unchanged | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 72 — S3 blocked: Reading data — PASS-STILL (covers the company-brain-affiliate gate change)

Original:
```
| role-funding-advisor | S3 blocked: Reading data (intended 7, actual 10) | affiliates, banking-surface, closer-deck, commissions, company-brain-affiliate, failed-events, invoices, partners, sales-floor, staff 403 | 10/10 403 | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/route-probe.md | PASS | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S3 blocked: Reading data (intended 7, actual 10) | affiliates, banking-surface, closer-deck, commissions, company-brain-affiliate, failed-events, invoices, partners, sales-floor, staff 403 | Reverify: 10/10 403; POST {} /api/read/company-brain-affiliate still 403 for a staff token after the requirePrincipal(affiliate/partner) change. All-groups blocked side still 44/44 probed 403 · 1 UNVERIFIED · 0 FAIL | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/route-probe.md; reverify/route-probe.json | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 75 — S4 not signed in — PASS-STILL

Original:
```
| role-funding-advisor | S4 not signed in | 401 without token | 6/6 sampled reach routes 401 | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/route-probe.md | PASS | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S4 not signed in | 401 without token | Reverify: 6/6 sampled reach routes 401 (applications, banking/accounts, campaigns/action-log, connections, detail, fatigue) — unchanged | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/route-probe.md | PASS-STILL | claude-fable-5 (reverify) |
```

### Line 76 — S5 UI: /api/demo/mode 403 on every screen — CHANGED-NOT-REGRESSION (mostly fixed; residue on 6 screens)

Original:
```
| role-funding-advisor | S5 UI: /api/demo/mode 403 on every screen | reachable screens make no forbidden API calls | shell calls GET /api/demo/mode (owner/admin only) on all 24 screens plus login and landing, 403 each time, one console error per screen; sidebar also offers Demo Mode (sample-data.html) which shows Turn ON/OFF/Wipe buttons and a red this endpoint is limited to owner, admin line | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/ui-walk.md; ui-walk.json; shots/26-sample-data.html.png | MEDIUM | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S5 UI: /api/demo/mode 403 on every screen | reachable screens make no forbidden API calls | Reverify after shell.js gate: login+landing 0 demo/mode calls; 18/24 screens 0 calls; 6/24 screens still make ONE GET /api/demo/mode → 403 (one console error each) from their own page scripts, not the shell: closer-dashboard, finance-os, client-control-panel, documents (public/app/demo-client-bootstrap.js) and ops-admin, sample-data (inline). Demo Mode (sample-data.html) still in this role's sidebar with Turn ON/OFF/Wipe buttons + red limited-to-owner,admin line (not clicked) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/ui-walk-compare.md; reverify/ui-walk.md; reverify/spot-check.md; reverify/shots/26-sample-data.html.png | CHANGED-NOT-REGRESSION (residual LOW) | claude-fable-5 (reverify) |
```

### Line 77 — S5 UI: ops-admin.html — CHANGED-NOT-REGRESSION (compliance panel now live; 3 owner-only 403s remain)

Original:
```
| role-funding-advisor | S5 UI: ops-admin.html | screen loads its panels without forbidden calls | GET /api/read/staff 403, /api/read/invoices 403, /api/read/failed-events 403, /api/read/messages?status=blocked 400; KPIs show dashes, No unpaid invoices loaded, Loading blocked messages never resolves, footer says not signed in for real data while signed in | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/shots/16-ops-admin.html.png; ui-walk.md | MEDIUM | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S5 UI: ops-admin.html | screen loads its panels without forbidden calls | Reverify: GET /api/read/messages?status=blocked&limit=30 → 200 ok=true items[] (0) — panel now reads No messages stopped by the compliance gate, footer strip says live compliance gate · 0 blocked (was 400 / Loading blocked messages… forever). Still 403: /api/read/staff, /api/read/invoices, /api/read/failed-events, plus one page-level GET /api/demo/mode 403; KPIs dashes; footer still says sample staff tables / sample ops health / sample AR table — not signed in for real data while signed in | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/spot-check.md; reverify/shots/spot-02-ops-admin.png; reverify/shots/16-ops-admin.html.png; reverify/ui-walk.md | CHANGED-NOT-REGRESSION (still MEDIUM for the 3 owner-only reads) | claude-fable-5 (reverify) |
```

### Line 80 — S5 UI walk overall — CHANGED-NOT-REGRESSION (no new failures; 24→10 screens with any 4xx)

Original:
```
| role-funding-advisor | S5 UI walk overall | every visible sidebar screen opens without a forbidden or failed API call | 25 visible of 34 sidebar links; 24 distinct screens opened, all HTTP 200, 0 bounced, no 5xx; 24/24 had at least one API 4xx (distinct endpoints listed in the rows above) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/ui-walk.md; shots/03 to shots/26 | MEDIUM | claude-fable-5 |
```
Replacement:
```
| role-funding-advisor | S5 UI walk overall | every visible sidebar screen opens without a forbidden or failed API call | Reverify 2026-08-17T05:49Z: 25 visible of 34 sidebar links (same); 24 distinct screens opened, all HTTP 200, 0 bounced, 0 5xx; 0 NEW failing endpoints on any screen; 19 previously-failing endpoint hits gone (18 shell demo/mode + 1 messages?status=blocked 400); screens with ≥1 API 4xx 24 → 10 (6 residual demo/mode + ops-admin 3×403, agent-editor/staff-teams read/staff 403, products-commissions read/commissions 403, campaign-manager 5×400 partner_id_required — all pre-existing) | docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/ui-walk-compare.md; reverify/ui-walk.md; reverify/ui-walk.json; reverify/shots/03 to 26 | CHANGED-NOT-REGRESSION (residual MEDIUM rows unchanged) | claude-fable-5 (reverify) |
```

---

## Section rows (columns: Step | Expected | Observed | Evidence | Result) — same verdicts, same evidence, for the "## role-funding-advisor (batch 2)" section

| Board line | Step | Proposed Observed (short) | Evidence | Result |
|---|---|---|---|---|
| 201 | S1 sign in | Reverify 05:48Z: login 200 ok role=funding_advisor token+cookie; session 200; left login.html; fh_role=funding_advisor; login API 4xx 0 (was 1) | reverify/route-probe.json, reverify/shots/00-login-page.png, 01-landing.png | PASS-STILL |
| 202 | S1b landing | Still /app/command-center.html, same chip, sidebar present, no error banner; counters now live (16 active clients) instead of dashes | reverify/shots/01-landing.png, 02-app-shell.png | PASS-STILL |
| 219 | S2 reach: Everything else | 8/8 probed statuses identical to original; reach side 57/60 OK, same 3 FAIL | reverify/route-probe.md | PASS-STILL |
| 225 | S3 blocked: demo | 2/2 → 403 unchanged | reverify/route-probe.md | PASS-STILL |
| 231 | S3 blocked: Reading data | 10/10 → 403; company-brain-affiliate POST {} still 403 for staff; all groups 44/44 | reverify/route-probe.md | PASS-STILL |
| 234 | S4 not signed in | 6/6 → 401 unchanged | reverify/route-probe.md | PASS-STILL |
| 235 | S5 UI walk | 24 screens, HTTP 200, 0 bounced, 0 5xx, 0 new failing endpoints; demo/mode 403 24→6 screens (page scripts); messages?status=blocked 400→200; other 403/400s unchanged | reverify/ui-walk-compare.md, reverify/ui-walk.md, reverify/spot-check.md | CHANGED-NOT-REGRESSION |

Suggested addition under the section's failure blocks: append one line to each of the two S5 blocks
("/api/demo/mode 403 on every screen" and "Ops & Admin screen half-works") — "Reverify 2026-08-17T05:49Z:
see reverify/BOARD-UPDATE.md — shell call removed; 6 page-level callers remain / messages?status=blocked
now 200, three owner-only reads still 403."

---

## Spot-checks (fix side effects on this role)

| # | Check | Expected after fix | Observed (my run) | Evidence | Verdict |
|---|---|---|---|---|---|
| a | GET /api/demo/mode called / 403 on any screen | shell.js no longer calls it for non-owner/admin | login+landing: 0 calls; pipeline: 0; command-center: 0; 18/24 screens: 0. Still called once (403 + 1 console error) on 6 screens by page-level scripts: closer-dashboard, finance-os, client-control-panel, documents (demo-client-bootstrap.js), ops-admin, sample-data (inline) | reverify/spot-check.md, reverify/ui-walk-compare.md, reverify/ui-walk.md | CHANGED-NOT-REGRESSION |
| b | ops-admin GET /api/read/messages?status=blocked&limit=30 | 200 (was 400 for staff) | 200, body ok=true keys ok,count,limit,offset,hasMore,items; items length 0; panel "No messages stopped by the compliance gate"; footer "live compliance gate · 0 blocked"; "Loading blocked messages…" no longer stuck | reverify/spot-check.json, reverify/shots/spot-02-ops-admin.png | CHANGED-NOT-REGRESSION |
| c | POST {} /api/read/company-brain-affiliate (white-label-only check) | n/a for this role; for a staff token must stay 403 | Staff token: 403 (probe blocked list, unchanged). Partner-token check not run in this journey | reverify/route-probe.md | PASS-STILL (staff side only) |
| d | localStorage fh_account written at login for a staff role | login.html stores fh_account only when login returns account | fh_ keys after login: fh_role, fh_token only; fh_account absent (null); fh_role=funding_advisor; fh_token present (value not read) | reverify/spot-check.md (login localStorage block) | PASS-STILL (absent for staff, as expected) |
| e | Reading data reach: /api/read/my-numbers and repair/exceptions (LOW rows 57/58) | unchanged | still 403 forbidden / 403 role_forbidden — identical to original | reverify/route-probe.md Failures table | unchanged (LOW rows stand) |
| f | staff-teams.html / agent-editor.html / products-commissions.html (MEDIUM row 78) | unchanged | still exactly one 403 each (read/staff, read/staff, read/commissions); no new endpoint | reverify/ui-walk-compare.md | unchanged (MEDIUM row stands) |
| g | campaign-manager.html (LOW row 79) | unchanged | still 5×400 partner_id_required (spend, list, action-log, connections, fatigue); demo/mode call gone | reverify/ui-walk-compare.md | unchanged (LOW row stands) |
