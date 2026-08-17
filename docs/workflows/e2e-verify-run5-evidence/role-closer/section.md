## role-closer (batch 2)

**Model:** claude-fable-5 (Fable Ultracode, parent session)  ·  **Login:** closer@fundhub.ai  ·  **Ran:** 2026-08-17T03:33Z (UI walk) / 2026-08-17T03:38Z (route probe)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/role-closer/

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | `POST /api/auth/login` → 200, token + `fundhub_session` cookie, `staff.role=closer`; login form leaves `login.html` | 200 · ok · role=closer · token · cookie · `/api/auth/session` 200 role=closer · form login left login.html, `fh_role=closer` stored, 0 API failures | route-probe.json `login`,`session` · shots/00-login-page.png · shots/01-landing.png | PASS |
| S1b landing | lands on `/dashboard.html` (shell.js HOME for closer) | landed `/dashboard.html` "FUNDHUB — CLOSER DASHBOARD", "Loaded 27 clients", live client rows, no API failures | shots/01-landing.png · ui-walk.json `landing` | PASS |
| S1c WHO — not signed in | 401 on staff routes | 6/6 sampled routes → 401 | route-probe.md "Not signed in" | PASS |
| S2 reach: Signing in and out (intended 6, actual 6) | not 401/403/404 | 1/1 GET OK · 5 write-only UNVERIFIED | route-probe.md | PASS (partial) |
| S2 reach: banking (1/1) | not 401/403/404 | 1/1 OK (400 = needs params, reachable) | route-probe.md | PASS |
| S2 reach: Campaigns (intended 6, actual 8) | not 401/403/404 | 6/6 GET OK · 2 UNVERIFIED | route-probe.md | PASS (partial) |
| S2 reach: consent (1/1) | not 401/403/404 | 1/1 OK | route-probe.md | PASS |
| S2 reach: contracts (1/1) | not 401/403/404 | `/api/contracts/sign` GET → 404 `not_found` — by design without a signed link (`api/contracts/sign.mjs` GONE); real link path not exercised | route-probe.md | UNVERIFIED |
| S2 reach: Creative Factory (intended 4, actual 7) | not 401/403/404 | 4/4 GET OK · 3 UNVERIFIED | route-probe.md | PASS (partial) |
| S2 reach: The dashboard (intended 4, actual 6) | not 401/403/404 | probe skipped all 6 (methods "—" in -actual.md); UI landing loaded 27 clients via `/api/dashboard/*` with 0 failures → reach proven for the read routes; `/api/dashboard/seed` not probed (write) | shots/01-landing.png · ui-walk.json `login.apiFails=[]` | PASS (read) / UNVERIFIED (seed) |
| S2 reach: Documents (1/1) | not 401/403/404 | 1 UNVERIFIED (POST-only) | route-probe.md | UNVERIFIED |
| S2 reach: Finance (5/5) | not 401/403/404 | 4/4 GET OK · 1 UNVERIFIED | route-probe.md | PASS (partial) |
| S2 reach: Reading data (intended 19, actual 36) | not 401/403/404 | 31/31 GET OK · 5 UNVERIFIED | route-probe.md | PASS (partial) |
| S2 reach: Everything else (intended 10, actual 22) | not 401/403/404 | 6/6 GET OK · 16 UNVERIFIED | route-probe.md | PASS (partial) |
| S2 reach: Incoming webhooks (1/1) | not 401/403/404 | 1 UNVERIFIED (POST-only) | route-probe.md | UNVERIFIED |
| S2 reach: groups not in intended — chat 3, climate 2, public 3, repair 2, social 3 | (intended file has no such groups) | chat 2/2 OK; public 1/1 OK; climate/social all write-only UNVERIFIED; **repair `/api/repair/exceptions` GET → 403 `role_forbidden`** | route-probe.md | FAIL for repair (see block 1) |
| S3 blocked: every group (48 routes) | 403 | **47/47 probed → 403** (Signing in/out 3, banking 2, chat 1, company-brain 2, demo 2, Finance 5, Hiring 6, journeys 2, partner-brand 1, privacy 1, proxy 2, Reading data 10, staff 2, Everything else 8) · 1 UNVERIFIED (`/api/inquiry`, no method) | route-probe.md "Every probe" | PASS |
| S4 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 27 visible / 34 sidebar links (hidden: sales-floor, subscriptions, journeys, hiring, brand-studio, client-portal, affiliate). 27 screens opened, 0 bounces, HTTP 200 all. **26/27 screens fired ≥1 failed API call**: `/api/demo/mode` 403 on 26 screens; `/api/read/staff` 403 on ops-admin, agent-editor, staff-teams; `/api/read/failed-events`, `/api/read/invoices` 403 + `/api/read/messages` 400 on ops-admin; `/api/read/commissions` 403 on products-commissions; 5× `/api/campaigns/*` 400 on campaign-manager | ui-walk.md · shots/03–28 | FAIL (see blocks 2–5) |

### Failure blocks (capped)

**1. role-closer · S2 reach: repair** — expected: `/api/repair/exceptions` reachable (the `-actual.md` says gate = `staff`). observed: live GET → 403 `role_forbidden`. cause: `api/repair/exceptions.mjs:9-24` allows owner/admin only; the journey generator reads the outer `requirePrincipal(["staff"])` and misses the inner role check, so `role-closer-actual.md:…repair/exceptions` overstates closer's reach. Same generator blind spot on `/api/dashboard/seed` (code `api/dashboard/seed.mjs:27` = admin only; -actual says `staff`; not probed — write route). evidence: `role-closer/route-probe.md` "Failures — should reach". severity: DOC-GAP (live is stricter than the doc; no user harm).

**2. role-closer · S4 UI: every screen** — expected: no forbidden calls from the shell. observed: `public/app/shell.js:1582 mountDemoBanner` calls `GET /api/demo/mode` on every screen for every staff role; gate is owner/admin → 403 for closer on 26/27 screens (39 console errors per walk). effect: a closer never sees the Demo Mode banner even when the org toggle is on — the banner is documented as "every CRM screen when the org toggle is on". evidence: `role-closer/ui-walk.md` Screens table; `route-probe.md` blocked row `/api/demo/mode` 403. severity: MEDIUM.

**3. role-closer · S4 UI: ops-admin.html** — expected: screen either hidden from closer or fully readable. observed: closer opens Ops & Admin (BETA); `/api/read/staff`, `/api/read/failed-events`, `/api/read/invoices` → 403, `/api/read/messages` → 400; screen falls to sample mode with footer "sample compliance blocks — the request was rejected · sample ops health — not signed in for real data · sample AR table — not signed in for real data · sample staff tables — not signed in for real data" (closer IS signed in — text blames the wrong cause); "Compliance gate — Loading blocked messages…" never resolves; outbound-mail buttons **Send what is waiting / Pause sending** are shown to a closer. evidence: `shots/18-ops-admin.html.png` · ui-walk.json. severity: MEDIUM.

**4. role-closer · S4 UI: staff-teams.html, agent-editor.html, products-commissions.html** — expected: screens the closer can open show real data or an honest "not for your role". observed: staff-teams: `/api/read/staff` 403 → Headcount 0, "No one matches that filter", footer "sample roster — not signed in for real data", **+ ADD PERSON** button visible (`/api/auth/invite` is 403 for closer). products-commissions: `/api/read/commissions` 403 → "sample commission ledger — not signed in for real data", **+ ADD PRODUCT** / "CLICK A ROW TO EDIT" visible (`/api/products` POST is 403 for closer). agent-editor: `/api/read/staff` 403 under a Beta banner. evidence: `shots/26-staff-teams.html.png`, `shots/27-products-commissions.html.png`, `shots/19-agent-editor.html.png` · ui-walk.json. severity: MEDIUM.

**5. role-closer · S4 UI: campaign-manager.html** — expected: screen loads campaign data or an honest empty state. observed: 5 calls (`/api/campaigns/spend|list|action-log|connections|fatigue`) → 400 (screen sends an incomplete query); Beta banner shown. evidence: `shots/22-campaign-manager.html.png` · ui-walk.json. severity: LOW.

### Observations (not failures — LOW / for the owner's eye)

* `/dashboard.html` (closer landing) shows a **+ Sample data** button (`public/dashboard.html:234`). Code (`api/dashboard/seed.mjs:27`) rejects non-admin, so a closer clicking it gets "Seed error: forbidden". Not clicked (write). Severity LOW.
* `pipeline.html` footer reads "DEMONSTRATION STATES mid-drag preview · blocked move · empty rail" on the LIVE board (16 real cards). Wording only. `shots/02-app-shell.png`. Severity LOW.
* Closer desk screens are honest: closer-dashboard "No closer-day pipeline endpoint yet"; my-numbers "$0 · No monthly deposits target in staff_targets", "Numbers come from /api/read/my-numbers. Missing stays a dash"; closer-call needs `?client_id=`. `shots/05,06,07`. Not a finding — matches screen-audit-2026-08-16 "partial / honest empty".

### Doc gaps (intended vs actual)

`role-closer-intended.md` (after-the-fact, 2026-08-02) vs `role-closer-actual.md` (generated from code):

* reach counts differ: Campaigns 6→8, Creative Factory 4→7, The dashboard 4→6, Reading data 19→36, Everything else 10→22.
* reach groups missing from intended entirely: chat (3), climate (2), public (3), repair (2), social (3).
* blocked counts differ: Signing in and out 1→3, Reading data 7→10, Everything else 5→9.
* blocked groups missing from intended entirely: chat (1), company-brain (2), demo (2), partner-brand (1), proxy (2), staff (2).
* Intended file names groups + counts only — no route names — so it cannot be used as step-level ground truth on its own. Batch 2 used `-actual.md` for routes and reports the drift above as DOC-GAP.
* `-actual.md` itself is wrong where a handler checks role inside the body (block 1): `/api/repair/exceptions`, `/api/dashboard/seed`.
