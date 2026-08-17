# role-closer — proposed board updates (reverify pass, claude-fable-5)

Board: `docs/workflows/fable-audit-2026-08-16.md`. Line numbers are as of commit 2b1eed0. I did not edit the board; the parent applies these.
All evidence paths below are under `docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/`. Run 2026-08-17 05:37Z–05:44Z against https://fundhub.ai as closer@fundhub.ai (live shell.js fingerprint = 1, i.e. commit 2b1eed0).

## 1. The FIXED-UNCLICKED row — verdict: REGRESSION (partial fix; shell.js part works, 3 other callers still 403)

Plain words: the fixer gated the demo banner in `shell.js`, and that gate is live and works on every screen. But three other pieces of page code also call `/api/demo/mode` and were never gated, so 7 of 26 closer screens still get a 403 and a console error. The row's expectation ("shell makes no forbidden calls") is met for `shell.js` itself; the row's scope ("every screen") is not.

### Findings table — line 35

Original (verbatim):
```
| role-closer | S4 UI: every screen — /api/demo/mode | shell makes no forbidden calls | closer@fundhub.ai on http://localhost:8888: landed /dashboard.html then /app/pipeline.html; GET /api/demo/mode never requested (empty list); no 403. shell.js mountDemoBanner now skips unless owner/admin | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/ | FIXED-UNCLICKED | fixer |
```
Proposed replacement:
```
| role-closer | S4 UI: every screen — /api/demo/mode | shell makes no forbidden calls | LIVE fundhub.ai (2b1eed0), closer@fundhub.ai, full 26-screen walk: shell.js no longer calls /api/demo/mode on any screen (landing, pipeline, command-center, staff-teams + 15 more = 0 requests). BUT 7/26 screens still GET /api/demo/mode → 403 + 1 console error each, from three other callers: closer-dashboard, closer-call, finance-os, client-control-panel, documents (public/app/demo-client-bootstrap.js:23, no role gate); ops-admin (ops-admin.html:994 inline load()); sample-data (sample-data.html:374 inline load()). Total 7 requests, 7× 403, 0 from shell.js (CDP initiator proof) | reverify/ui-walk.json; reverify/ui-walk.md; reverify/demo-mode-requests.json (initiators); reverify/README.md | REGRESSION (partial fix — shell.js gate confirmed, 3 other callers open) | claude-fable-5 (reverify) |
```

### Section "## role-closer (batch 2)" — line 162 (S4 UI walk)

Original (verbatim):
```
| S4 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 27 visible / 34 sidebar links (hidden: sales-floor, subscriptions, journeys, hiring, brand-studio, client-portal, affiliate). 27 screens opened, 0 bounces, HTTP 200 all. **26/27 screens fired ≥1 failed API call**: `/api/demo/mode` 403 on 26 screens; `/api/read/staff` 403 on ops-admin, agent-editor, staff-teams; `/api/read/failed-events`, `/api/read/invoices` 403 + `/api/read/messages` 400 on ops-admin; `/api/read/commissions` 403 on products-commissions; 5× `/api/campaigns/*` 400 on campaign-manager | ui-walk.md · shots/03–28 | FAIL (see blocks 2–5) |
```
Proposed replacement:
```
| S4 UI walk (reverify 2026-08-17 05:38Z, LIVE) | every visible sidebar screen opens without a forbidden/failed API call | 27 visible / 34 sidebar links (same 7 hidden). 26 unique screens opened, 0 bounces, HTTP 200 all. **11/26 screens fired ≥1 failed API call** (was 26/26): `/api/demo/mode` 403 on 7 screens (closer-dashboard, closer-call, finance-os, client-control-panel, documents ← demo-client-bootstrap.js; ops-admin, sample-data ← inline page code) — 0 from shell.js; `/api/read/staff` 403 on ops-admin, agent-editor, staff-teams (unchanged); `/api/read/failed-events`, `/api/read/invoices` 403 on ops-admin (unchanged); `/api/read/messages` 400 on ops-admin GONE (compliance gate now shows "No messages stopped"); `/api/read/commissions` 403 on products-commissions (unchanged); 5× `/api/campaigns/*` 400 on campaign-manager (unchanged) | reverify/ui-walk.md · reverify/ui-walk.json · reverify/shots/03–28 · reverify/demo-mode-requests.json | FAIL — demo/mode partial fix (REGRESSION vs FIXED-UNCLICKED); blocks 3–5 unchanged |
```

### Failure block 2 — line 168

Original (verbatim):
```
**2. role-closer · S4 UI: every screen** — expected: no forbidden calls from the shell. observed (re-run 2026-08-17, closer@fundhub.ai, localhost:8888): GET /api/demo/mode never requested on landing or Pipeline. `mountDemoBanner` returns before fetch unless role is owner or admin. evidence: `role-closer/fixed/network.json` (empty list), `role-closer/fixed/shot.png`, `role-closer/fixed/pipeline.png`. status: FIXED-UNCLICKED.
```
Proposed replacement:
```
**2. role-closer · S4 UI: every screen** — expected: no forbidden calls from the shell. observed (reverify 2026-08-17 05:38Z, closer@fundhub.ai, LIVE https://fundhub.ai @ 2b1eed0, full 26-screen walk): `shell.js` `mountDemoBanner` gate is live — 0 `/api/demo/mode` requests initiated by shell.js on any screen (landing, pipeline, command-center, staff-teams and 15 others: 0 requests). Still failing: 7/26 screens GET `/api/demo/mode` → 403 + one console error each, from code the fix did not touch — `public/app/demo-client-bootstrap.js:23` (loaded by closer-dashboard, closer-call, finance-os, client-control-panel, documents; no role check), `public/app/ops-admin.html:994` (inline Demo Mode panel `load()`), `public/app/sample-data.html:374` (inline `load()`). Initiators proven via CDP `Network.requestWillBeSent` stack. evidence: `role-closer/reverify/demo-mode-requests.json`, `role-closer/reverify/ui-walk.json`, `role-closer/reverify/README.md`. status: REGRESSION vs FIXED-UNCLICKED — partial fix (shell.js CONFIRMED-FIXED; 3 other callers open). Fix target: gate or remove those three fetches for non-owner/admin.
```

### Fixer summary table — line 1083

Original (verbatim):
```
| 1 | demo-mode 403 on every page for non-owners | role-closer / closer@fundhub.ai | `public/app/shell.js` | FIXED-UNCLICKED |
```
Proposed replacement:
```
| 1 | demo-mode 403 on every page for non-owners | role-closer / closer@fundhub.ai | `public/app/shell.js` | PARTIAL on live (reverify 2026-08-17): shell.js gate works, 0 shell requests; 7/26 screens still 403 via `demo-client-bootstrap.js:23`, `ops-admin.html:994`, `sample-data.html:374` — see role-closer/reverify/BOARD-UPDATE.md |
```

## 2. Spot-checks (5 PASS rows) — all PASS-STILL

| Board line | Step | Original Observed | Reverify Observed (my run) | Evidence (reverify/) | Verdict |
|---|---|---|---|---|---|
| 29 (also section 145) | S1 sign in | 200 ok, role=closer, token+cookie, session 200, landed /dashboard.html "Loaded 27 clients" | `POST /api/auth/login` 200 ok=true role=closer token=true cookie=true; `/api/auth/session` 200 role=closer; browser form login left login.html, `fh_role=closer` stored, 0 API failures during login | route-probe.json `login`,`session` · ui-walk.json `login` · shots/00-login-page.png · shots/01-landing.png | PASS-STILL |
| 30 (also section 147) | S1c not signed in | 6/6 → 401 | 6/6 sampled reach routes → 401 (`/api/applications`, `/api/banking/accounts`, `/api/campaigns/action-log`, `/api/campaigns/connections`, `/api/campaigns/detail`, `/api/campaigns/fatigue`) | route-probe.md "Not signed in" · route-probe.json `unauth` | PASS-STILL |
| section 146 | S1b landing | landed /dashboard.html "FUNDHUB — CLOSER DASHBOARD", "Loaded 27 clients", no API failures | landed `/dashboard.html`, title "FundHub — Closer Dashboard", header "27 clients", status line "Loaded 27 clients" (count is live data and may drift), 0 API failures, 0 console errors; 0 `/api/demo/mode` requests on landing | shots/01-landing.png · ui-walk.json `landing` · demo-mode-requests.json screen `/dashboard.html` | PASS-STILL |
| 31 (also section 148–160) | S2 reach (all groups, GET routes) | 57/59 GET-probed OK; 49 write-only UNVERIFIED | 57/59 GET-probed OK · 49 write-only UNVERIFIED · 2 FAIL unchanged: `/api/contracts/sign` 404 not_found (by design, no signed link) and `/api/repair/exceptions` 403 role_forbidden (DOC-GAP row 32); dashboard reads proven via UI (27 clients, 0 failures) | route-probe.md · route-probe.json `reach`,`summary` · shots/01-landing.png | PASS-STILL (partial, same as before) |
| 34 (also section 161) | S3 blocked (all 48 routes) | 47/47 probed → 403; 1 UNVERIFIED (/api/inquiry) | 47/47 probed → 403, 0 FAIL · 1 UNVERIFIED (`/api/inquiry`, no GET/POST method to probe safely) | route-probe.md "Every probe" · route-probe.json `blocked`,`summary` | PASS-STILL |

Proposed replacement rows for the Findings table (same column format; only Observed/Evidence/Model rewritten):
```
| role-closer | S1 sign in | login 200, token+cookie, role=closer, form leaves login.html | reverify LIVE 2026-08-17 05:38Z: 200 ok, role=closer, token+cookie, session 200 role=closer, form left login.html, fh_role=closer, landed /dashboard.html "Loaded 27 clients", 0 API failures | e2e-verify-run5-evidence/role-closer/reverify/route-probe.json; reverify/ui-walk.json; reverify/shots/00-login-page.png; reverify/shots/01-landing.png | PASS-STILL | claude-fable-5 (reverify) |
| role-closer | S1c not signed in | 401 on staff routes | reverify LIVE: 6/6 → 401 | e2e-verify-run5-evidence/role-closer/reverify/route-probe.md "Not signed in" | PASS-STILL | claude-fable-5 (reverify) |
| role-closer | S2 reach (all groups, GET routes) | not 401/403/404 on 108 routes | reverify LIVE: 57/59 GET-probed OK; 49 write-only UNVERIFIED; 2 FAIL unchanged (contracts/sign 404 by design; repair/exceptions 403 DOC-GAP); dashboard reads proven via UI (27 clients, 0 failures) | e2e-verify-run5-evidence/role-closer/reverify/route-probe.md; reverify/shots/01-landing.png | PASS-STILL (partial) | claude-fable-5 (reverify) |
| role-closer | S3 blocked (all 48 routes) | 403 | reverify LIVE: 47/47 probed → 403; 1 UNVERIFIED (/api/inquiry, no method) | e2e-verify-run5-evidence/role-closer/reverify/route-probe.md "Every probe" | PASS-STILL | claude-fable-5 (reverify) |
```

## 3. Other open rows seen in passing (not graded as regressions — separate open rows)

| Board line | Row | Reverify status | Note |
|---|---|---|---|
| 36 / block 3 (line 170) | S4 UI: ops-admin.html | **changed, not worse** | `/api/read/staff`, `/api/read/failed-events`, `/api/read/invoices` → 403 still; `/api/read/messages` 400 is GONE — compliance gate now resolves to "No messages stopped by the compliance gate" (was stuck on "Loading blocked messages…"). Footer still says "sample ops health — not signed in for real data · sample staff tables — not signed in for real data · … sample AR table — not signed in for real data" while signed in; **Send what is waiting / Pause sending** still shown to a closer. Evidence: reverify/shots/18-ops-admin.html.png, reverify/demo-mode-_app_ops-admin.html.png, reverify/ui-walk.json. Still MEDIUM. |
| 37 / block 4 (line 172) | S4 UI: staff-teams, agent-editor, products-commissions | **unchanged** | `/api/read/staff` 403 on staff-teams + agent-editor (Headcount 0, "No one matches that filter", footer "sample roster — not signed in for real data", + ADD PERSON shown); `/api/read/commissions` 403 on products-commissions. Evidence: reverify/shots/26-staff-teams.html.png, 19-agent-editor.html.png, 27-products-commissions.html.png. Still MEDIUM. |
| 38 / block 5 (line 174) | S4 UI: campaign-manager.html | **unchanged** | 5× `/api/campaigns/{list,fatigue,connections,action-log,spend}?state=all…` → 400. Evidence: reverify/shots/22-campaign-manager.html.png, reverify/ui-walk.json. Still LOW. |
| 39 | /dashboard.html "+ Sample data" | **unchanged** | button still visible to closer (not clicked). reverify/shots/01-landing.png. LOW. |
| 40 | pipeline.html footer | **unchanged** | "DEMONSTRATION STATES mid-drag preview · blocked move · empty rail" still on the live board (16 cards). reverify/shots/02-app-shell.png. LOW. |
| 32, 33, 41 | DOC-GAP / UNVERIFIED rows | **unchanged** | repair/exceptions 403, contracts/sign 404, intended-vs-actual group drift identical to batch 2 (reverify/route-probe.md "Intended vs actual"). |
