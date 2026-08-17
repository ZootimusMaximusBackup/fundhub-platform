# BOARD-UPDATE-B — role-owner re-verify on LIVE (agent B, claude-fable-5 reverify)

Board: `docs/workflows/fable-audit-2026-08-16.md`. Line numbers are as of the board at commit 2b1eed0 (read 2026-08-17T05:37Z). Agent B did not edit the board. Parent applies.

Ran 2026-08-17T05:38–05:42Z against https://fundhub.ai (shell.js fingerprint `role !== "owner" && role !== "admin"` count = 1, commit 2b1eed0) as owner@fundhub.ai. Evidence root: `docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/`.

---

## Fixed rows

### 1) Ticket 2 — Staff & Teams footer "[object Promise]" → CONFIRMED-FIXED

**Failure block, lines 882–886 — original (verbatim):**

```
**role-owner · S5 UI walk — Staff & Teams footer prints "[object Promise]" (LOW)**
- Expected: footer strip says "live roster · N staff · …".
- Observed (re-run 2026-08-17, owner@fundhub.ai, localhost:8888 `/app/staff-teams.html`): footer `live roster · 1 staff · signed-in user not on roster · consent 0/1` (not `[object Promise]`). Roster: Chris Stanbridge, OWNER. Paint callback returns that string; `applyMyShift` still runs.
- Evidence: `role-owner/fixed/staff-teams-shot.png`, `role-owner/fixed/staff-teams-footer.json`.
- Status: FIXED-UNCLICKED.
```

**Proposed replacement:**

```
**role-owner · S5 UI walk — Staff & Teams footer prints "[object Promise]" (LOW)**
- Expected: footer strip says "live roster · N staff · …".
- Observed (re-verify 2026-08-17T05:38Z, owner@fundhub.ai, LIVE https://fundhub.ai `/app/staff-teams.html`, real Chromium via /login.html): footer `#fh-data-banner` = `live roster · 1 staff · signed-in user not on roster · consent 0/1` — no "[object Promise]", starts with "live roster". GET /api/read/staff?limit=200 → 200. Roster table 1 row. 8 API calls on the screen, 0 4xx/5xx, 0 console errors.
- Evidence: `role-owner/reverify/staff-teams-shot.png`, `role-owner/reverify/staff-teams-footer.json`, `role-owner/reverify/staff-teams-capture.mjs`.
- Status: CONFIRMED-FIXED (claude-fable-5 reverify).
```

**Ticket table, line 1084 — original (verbatim):**

```
| 2 | Staff & Teams footer prints [object Promise] | role-owner / owner@fundhub.ai | `public/app/staff-teams.html` | FIXED-UNCLICKED |
```

**Proposed replacement:**

```
| 2 | Staff & Teams footer prints [object Promise] | role-owner / owner@fundhub.ai | `public/app/staff-teams.html` | CONFIRMED-FIXED (live, role-owner/reverify/staff-teams-footer.json) |
```

### 2) Ticket 4 — Ops & Admin compliance gate → CONFIRMED-FIXED (COMPLIANCE REVIEW REQUIRED label stays)

**Failure block, lines 871–875 — original (verbatim):**

```
**role-owner · S5 UI walk — Ops & Admin compliance gate never loads (MEDIUM)**
- Expected: ops-admin.html "Compliance gate — messages it stopped" lists blocked messages (empty state if none). Never stuck on Loading.
- Observed (re-run 2026-08-17, owner@fundhub.ai, localhost:8888 `/app/ops-admin.html`): table `CLIENT CHANNEL REASON WHEN No messages stopped by the compliance gate`. `hasLoading: false`.
- Evidence: `role-owner/fixed/ops-admin-shot.png`, `role-owner/fixed/messages-network.json`.
- Status: FIXED-UNCLICKED. COMPLIANCE REVIEW REQUIRED.
```

**Proposed replacement:**

```
**role-owner · S5 UI walk — Ops & Admin compliance gate never loads (MEDIUM)**
- Expected: ops-admin.html "Compliance gate — messages it stopped" lists blocked messages (empty state if none). Never stuck on Loading.
- Observed (re-verify 2026-08-17T05:38Z, owner@fundhub.ai, LIVE https://fundhub.ai `/app/ops-admin.html`, real Chromium): GET /api/read/messages?status=blocked&limit=30 → 200 `{ok:true,count:0,items:[]}` (keys ok/count/limit/offset/hasMore/items). Panel `#compliance-blocked-table`: header CLIENT/CHANNEL/REASON/WHEN + "No messages stopped by the compliance gate"; hasLoading=false; 0 data rows. Other owner reads on the screen: read/staff 200, read/failed-events 200, read/invoices 200; 0 API 4xx/5xx, 0 console errors. Direct API with bearer token (POST /api/auth/login → GET same URL): 200, ok=true, items length 0. Footer strip: "live compliance gate · 0 blocked".
- Evidence: `role-owner/reverify/ops-admin-shot.png`, `role-owner/reverify/messages-network.json`, `role-owner/reverify/messages-api.json`, `role-owner/reverify/messages-capture.mjs`.
- Status: CONFIRMED-FIXED (claude-fable-5 reverify). COMPLIANCE REVIEW REQUIRED.
```

**Ticket table, line 1086 — original (verbatim):**

```
| 4 | compliance gate /api/read/messages?status=blocked 400 | role-owner / owner@fundhub.ai | `api/read/messages.mjs`, `src/http/messages-read.pg.test.mjs` | FIXED-UNCLICKED |
```

**Proposed replacement:**

```
| 4 | compliance gate /api/read/messages?status=blocked 400 | role-owner / owner@fundhub.ai | `api/read/messages.mjs`, `src/http/messages-read.pg.test.mjs` | CONFIRMED-FIXED (live 200; role-owner/reverify/messages-api.json) — COMPLIANCE REVIEW REQUIRED |
```

---

## Spot-checks (PASS rows re-run on live)

| Board line(s) | Step | Original status | Verdict | Observed (this run) | Evidence |
|---|---|---|---|---|---|
| 574 (findings) / 825 (section) | S1 sign in | PASS | PASS-STILL | Login page rendered; browser sign-in left login.html; localStorage fh_role=owner; 0 API 4xx/5xx, 0 console errors on sign-in. Direct POST /api/auth/login 200 ok=true token present role=owner (messages-api.json). | reverify/ui-walk.json login · reverify/shots/00-login-page.png · reverify/shots/01-landing.png · reverify/messages-api.json |
| 575 (findings) / 826 (section) | S1b landing | PASS | PASS-STILL | Landed /app/command-center.html "Fundhub — Command Center"; chip "TEST — Owner Role · owner · 34 tabs · LIVE"; 0 API 4xx/5xx, 0 console errors; sidebar present at once (appShellUrl = same page, no fallback). Meta "16 active clients · 0 moved forward today · counts only"; Holds "No holds"; every stage rail shows numeric counts (no dashes) — command-center detail is agent A's row. | reverify/shots/01-landing.png · reverify/shots/02-app-shell.png · reverify/ui-walk.json landing |
| 604 (findings) / 855 (section) | S5 UI walk overall | PASS (partial) — 4 screens with findings | CHANGED-NOT-REGRESSION (better: 31/33 clean vs 30) | 34 visible / 34 links (command-center.html listed twice → 33 unique screens opened; the original run's json also had 33 unique screens); 0 bounced; 0 403; 0 5xx. Screens with any API 4xx: campaign-manager only (5× 400, unchanged). Screens with console errors: campaign-manager (5× "Failed to load resource 400"), hiring (1 pageerror). ops-admin and staff-teams now clean. No NEW failing endpoint on any previously-clean screen. | reverify/ui-walk.md · reverify/ui-walk.json · reverify/shots/03..35 |
| 604 / 855 / 877–880 | S5 campaign-manager | LOW (not regression) | PASS-STILL (unchanged LOW) | 5× GET /api/campaigns/{action-log,connections,list,fatigue,spend}?state=all → 400 partner_id_required; screen still shows sample book "Ironwood Capital Group" with KPI tiles and footer "spend:badrequest · list:badrequest · fatigue:badrequest · conn:badrequest · log:badrequest". Identical to original. | reverify/shots/25-campaign-manager.html.png · reverify/ui-walk.md row campaign-manager |
| 604 / 855 / 865–869 | S5 hiring.html console | MEDIUM (ticket 3, FIXED-UNCLICKED — graded by agent A) | reported only | 0 API 4xx/5xx. Console: 1 pageerror `Cannot read properties of undefined (reading 'label')` (original was `null (reading 'length')` — that one is gone). Yellow footer bar still "loading hiring…". KPI tiles render live values (bench 0/12, open applications 3, needs a human 3, postings 1/1). Board below the fold not checked by B. | reverify/shots/30-hiring.html.png · reverify/ui-walk.md row hiring |

### Proposed replacement for line 604 (findings table, columns Journey | Step | Expected | Observed | Evidence | Severity | Model)

Original (verbatim):

```
| role-owner | S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 34 visible / 34 links (= ROLE_TABS.owner '*'); 34 opened, 0 bounced, 0 forbidden. Failing: ops-admin GET /api/read/messages?status=blocked → 400 (handler needs conversation_id, api/read/messages.mjs:54-59 vs ops-admin.html:862; panel 'Loading blocked messages…' forever; period label hardcoded 'Jul 20–26') MEDIUM; hiring.html pageerror null.length — live rows flags:null, hiring.html:1808 via mapCandidateRow :2572, board never renders, footer 'loading hiring…' MEDIUM; campaign-manager 5× 400 partner_id_required, sample book shown LOW; staff-teams footer '[object Promise]' (staff-teams.html:998 returns Promise to FHData.wire) LOW. 30/34 clean | docs/workflows/e2e-verify-run5-evidence/role-owner/ui-walk.md · shots/20-ops-admin.html.png · shots/30-hiring.html.png · shots/25-campaign-manager.html.png · shots/29-staff-teams.html.png | MEDIUM | claude-fable-5 |
```

Proposed:

```
| role-owner | S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | LIVE re-verify 2026-08-17T05:39Z: 34 visible / 34 links (= ROLE_TABS.owner '*'; command-center listed twice → 33 unique screens); 33 opened, 0 bounced, 0 forbidden, 0 5xx. ops-admin: read/messages?status=blocked → 200, panel shows empty state — CONFIRMED-FIXED (period label still 'Jul 20–26'). staff-teams: footer 'live roster · 1 staff · …' — CONFIRMED-FIXED. hiring: pageerror now 'undefined (reading label)' (old null.length gone), footer 'loading hiring…' still shows, KPI tiles render — see ticket 3 (agent A). campaign-manager: 5× 400 partner_id_required, sample book shown — unchanged LOW. 31/33 clean (was 30) | docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/ui-walk.md · reverify/shots/20-ops-admin.html.png · reverify/shots/30-hiring.html.png · reverify/shots/25-campaign-manager.html.png · reverify/shots/29-staff-teams.html.png | CHANGED-NOT-REGRESSION (LOW remaining: campaign-manager; hiring per ticket 3) | claude-fable-5 (reverify) |
```

### Proposed replacement for line 855 (section table, columns Step | Expected | Observed | Evidence | Result)

Original (verbatim):

```
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 34 visible / 34 links (matches ROLE_TABS.owner="*"; chip says 34 tabs). 34 screens opened, 0 bounced, 0 forbidden (403) calls. Failing endpoints: ops-admin.html GET /api/read/messages?status=blocked → 400 (1); campaign-manager.html 5× GET /api/campaigns/* → 400 partner_id_required. Console: hiring.html pageerror "Cannot read properties of null (reading 'length')" (board never renders, footer stuck "loading hiring…"); staff-teams.html footer strip shows "[object Promise]". 30/34 screens clean | ui-walk.md · shots/03..35 | PASS (partial) — 4 screens with findings |
```

Proposed:

```
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | LIVE re-verify 2026-08-17T05:39Z (claude-fable-5 reverify): 34 visible / 34 links (matches ROLE_TABS.owner="*"; chip says 34 tabs; command-center listed twice → 33 unique screens). 33 screens opened, 0 bounced, 0 forbidden (403), 0 5xx. Failing endpoints: only campaign-manager.html 5× GET /api/campaigns/* → 400 partner_id_required (unchanged). ops-admin.html now 0 API fails (read/messages?status=blocked → 200, empty state shown). staff-teams.html footer "live roster · 1 staff · signed-in user not on roster · consent 0/1" (no "[object Promise]"). Console: hiring.html pageerror "Cannot read properties of undefined (reading 'label')" (old null.length gone; footer still "loading hiring…"). 31/33 screens clean | reverify/ui-walk.md · reverify/shots/03..35 · reverify/staff-teams-footer.json · reverify/messages-network.json | PASS (partial) — 2 screens with findings (campaign-manager LOW unchanged; hiring per ticket 3) — CHANGED-NOT-REGRESSION |
```

### Lines 574 / 575 / 825 / 826 (S1 sign in, S1b landing)

PASS-STILL. No text change needed; if the parent wants a live re-verify stamp, append to Evidence: ` · reverify/ui-walk.json (2026-08-17T05:39Z, PASS-STILL, claude-fable-5 reverify)`.
