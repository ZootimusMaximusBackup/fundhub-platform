# Button + UI validation audit — 2026-08-21

## Mode

**Auditor · read-only · findings only · dated 2026-08-21**

- Skill path: `fundhub-ui-auditor` + `fundhub-auditor` discovery discipline
- Rulebook: `docs/UI-STANDARDS.md` (especially **§5 Every visible control works**)
- Markups: `audit-screenshot-markups.mdc` (`*-MARKED.png` required on findings)
- Order: `redundancy-before-ui-polish.mdc` — prove controls; do **not** polish or KILL during this audit
- **No fixes. No app code edits. No commits from this batch until Chris names fixes.**

## Status

**STOP after W0 — waiting for Chris GO before W1–W4 click runs.**

W0 wrote this board + empty evidence folders + a static control inventory. Click validation has **not** started.

## Stale boards (do not treat as truth)

| Board | Why stale |
|---|---|
| Aug 17 UI audit (`docs/workflows/ui-audit-*` / related) | OUT OF DATE — nav, survivors, and wiring moved |
| Aug 20 full-system / full-e2e crawl boards | OUT OF DATE — do not reuse PASS/FAIL as current |
| `docs/workflows/simplify-decision-research-2026-08-20.md` | Use **only** for which items were KILL’d / protected Present flow — **not** as current button PASS/FAIL |

**This file is the source of truth for the 2026-08-21 button + UI validation batch.**

## Inventory source (TODAY)

- Survivor list derived from `public/app/shell.js` `ALL` + role maps (`ROLE_TABS` / `allowedFor` / `NAV_HIDDEN` / `ADMIN_BLOCKED`)
- Static control labels from HTML + companion `.js` where present — **handlers not invented**
- Machine inventory: `docs/workflows/button-ux-validation-2026-08-21-evidence/w0/control-inventory.json`
- JS-heavy screens include a **LIVE-EXPAND** row: click agents must list newly painted controls before marking the screen done
- Counts below are **UNVERIFIED inventory**, not pass scores

### Survivor screens in `ALL` (31)

- `closer-dashboard.html`
- `my-numbers.html`
- `sales-floor.html`
- `pipeline.html`
- `client-control-panel.html`
- `messaging.html`
- `calendar.html`
- `documents.html`
- `company-brain.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `ops-admin.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `galaxy.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `agent-editor.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `automations.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `products-commissions.html`
- `staff-teams.html`
- `inquiry-remover.html`
- `affiliate.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `client-portal.html`
- `partner-galaxy.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `brand-studio.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `campaign-manager.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `social-studio.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `creative-factory.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `hiring.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `finance-os.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `journeys.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `template-editor.html`
- `contracts.html`
- `lenders.html`
- `content-admin.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*
- `consent-capture.html` *(URL ok · **NAV_HIDDEN** — must stay off rail)*

### On-rail menu survivors (after `NAV_HIDDEN` filter) — 15

- `closer-dashboard.html`
- `my-numbers.html`
- `sales-floor.html`
- `pipeline.html`
- `client-control-panel.html`
- `messaging.html`
- `calendar.html`
- `documents.html`
- `products-commissions.html`
- `staff-teams.html`
- `inquiry-remover.html`
- `client-portal.html`
- `template-editor.html`
- `contracts.html`
- `lenders.html`

### Protected off-`ALL` (prove only — never remove)

- `present.html` — Present / screen-share deck
- `closer-call.html` — legacy call URL; **redirects to** `closer-dashboard.html` (call cockpit lives there)
- Closer context chain: call/Present disposition → `call_outcomes` → context fetch → agent prompt — **prove end-to-end; do not redesign**

### Extra off-nav reachable pages (sequence + prove)

- `soft-pull-approve.html`
- `payment-success.html`

**Sequenced screen total for W1–W3:** 35 (31 `ALL` + 2 protected + 2 extra)

**Approx control steps listed:** 500 (includes open-URL + LIVE-EXPAND rows; Status blank = UNVERIFIED)

## Decommissioned / KILL appendix — must stay off nav

### Absorbed into `finance-os.html` (files absent under `public/app/`)

- `money-map.html`, `banking-surface.html`, `card-stack.html`, `bank-accounts.html`, `bills-cashflow.html`, `banking-entry.html`, `finance-command.html`, `finance-add.html`
- `subscriptions.html` (absent)

### Other removed desks (absent)

- `alerts.html`, `deal-model.html`, `command-center.html`, `beta-owner-command-center.html`

### `NAV_HIDDEN` (2026-08-19 kill pass) — URL may still open; **rail row must stay hidden**

- `finance-os.html`
- `consent-capture.html`
- `company-brain.html`
- `galaxy.html`
- `partner-galaxy.html`
- `ops-admin.html`
- `automations.html`
- `journeys.html`
- `brand-studio.html`
- `campaign-manager.html`
- `social-studio.html`
- `creative-factory.html`
- `hiring.html`
- `affiliate.html`
- `agent-editor.html`
- `content-admin.html`

### `ADMIN_BLOCKED` — admin must not open

- `client-portal.html`, `affiliate.html`, `partner-galaxy.html`

### Simplify research KILL themes (context only — re-prove live; do not assume already applied)

From `simplify-decision-research-2026-08-20.md`: KILL extra displays/actions (pipeline archive top-bar duplicate, specialist list duplicates, portal demo state toggles, sales-floor static Flag fallback, staff Active/Clock fake switches, pipeline dead Apply path, weak staff document doors, etc.). W1–W4 mark **FAIL** if a KILL’d control is still visible/clickable; do not “fix” by removing it in this pass.

## Safety rails (all click workflows)

- **No** real charge / checkout against live cards
- **No** real credit pull (soft or hard)
- **No** letter mail / print-mail
- **No** archive / permanent delete / purge on live files
- **No** commission/rate edits that write production rules
- **No** contract sign / send on live clients
- **No** live outbound SMS/email/publish/Meta sync
- **e2e fixtures only** (`e2e+aff-*@`, `e2e+wl-*@` and other existing e2e test accounts from gitignored `.env`)
- **Never** live file `9af65808-…`
- Unsafe controls: Status = `SKIP` or presence-only observation unless a safe e2e dry path exists; still record Expected vs Observed
- Evidence: 1440 + 390 screenshots; findings need `*-MARKED.png`

## Parallel split

| Workflow | Owns | Depends |
|---|---|---|
| **W0** | Board + evidence dirs + static inventory | **done** (this agent) |
| **W1** | Sales desk clicks | Needs Chris **GO**; no dep on W2–W4 |
| **W2** | File-work clicks | Needs Chris **GO**; parallel with W1 |
| **W3** | Ops + portals clicks | Needs Chris **GO**; parallel with W1–W2 |
| **W4** | Auth / roles / killed-page proofs | Needs Chris **GO**; can parallel; soft-dep on W1–W3 screen list only |

**No dependencies between W1–W4 click work — all parallel after GO.**

### Copy-paste prompts (for Chris to launch after GO)

<details><summary>W1 — Sales desk</summary>

```
You are W1 for docs/workflows/button-ux-validation-2026-08-21.md.
Mode: Auditor read-only. No fixes. No app edits. No commits.
Claim W1 on the board. Click-validate every control in the W1 tables (pipeline, closer-dashboard, my-numbers, sales-floor, calendar, present, closer-call redirect).
Follow Safety rails. e2e fixtures only. Never live file 9af65808-…
UI-STANDARDS §5: every visible control works or FAIL/DEAD. Mark Status + Evidence path. Marked screenshots required.
Protected Present/call cockpit: prove only, never remove.
LIVE-EXPAND rows: inventory JS-painted controls before finishing a screen.
Stop when W1 tables filled. Do not start fixes.
```

</details>

<details><summary>W2 — File work</summary>

```
You are W2 for docs/workflows/button-ux-validation-2026-08-21.md.
Mode: Auditor read-only. No fixes. No app edits. No commits.
Claim W2. Click-validate W2 tables (client-control-panel, messaging, documents, inquiry-remover, lenders, consent-capture, soft-pull-approve, finance-os).
Safety rails apply — no credit pull, letter mail, archive, live outbound, charges.
e2e fixtures only. Never live file 9af65808-…
§5 FAIL/DEAD on dead/403 controls. Marked evidence. LIVE-EXPAND as needed.
Stop when W2 done.
```

</details>

<details><summary>W3 — Ops + portals</summary>

```
You are W3 for docs/workflows/button-ux-validation-2026-08-21.md.
Mode: Auditor read-only. No fixes. No app edits. No commits.
Claim W3. Click-validate W3 tables (ops-admin, galaxy, company-brain, agent-editor, automations, journeys, template-editor, products-commissions, staff-teams, contracts, campaign-manager, social-studio, creative-factory, content-admin, hiring, brand-studio, partner-galaxy, client-portal, affiliate, payment-success).
Safety rails: no rate edits, publish, Meta sync, live outbound, charges.
e2e fixtures / partner e2e only. Marked evidence. LIVE-EXPAND as needed.
Stop when W3 done.
```

</details>

<details><summary>W4 — Auth / roles / killed pages</summary>

```
You are W4 for docs/workflows/button-ux-validation-2026-08-21.md.
Mode: Auditor read-only. No fixes. No app edits. No commits.
Claim W4. Run the W4 role/kill tables: login/router, role home bounce, NAV_HIDDEN off-rail, ADMIN_BLOCKED, decommissioned URL 404/absence, partner Campaigns row stays absent.
Do not reuse Aug 17/20 PASS/FAIL. Fresh evidence only.
Stop when W4 done.
```

</details>

## Task claim table

| Workflow | Owner | Status |
|---|---|---|
| W0 | this agent (board writer) | **claimed → done** |
| W1 Sales desk | — | **pending** (waiting GO) |
| W2 File work | — | **pending** (waiting GO) |
| W3 Ops + portals | — | **pending** (waiting GO) |
| W4 Auth / roles / killed | — | **pending** (waiting GO) |

## Findings log (fill during W1–W4 — empty at W0)

| Screen | Role | Standard | Expected | Observed | Evidence | Severity |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## W1 sequences — Sales desk

### `pipeline.html`

- Workflow inventory rows: **17** · static controls extracted: **15**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| pipeline-S01 | pipeline.html | Open /app/pipeline.html | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w1/shots/pipeline/ |
| pipeline-S02 | pipeline.html | Board (#lensBoard) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S03 | pipeline.html | Fulfillment (#lensFulfillment) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S04 | pipeline.html | ⚟ Filter 0 (#filterBtn) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S05 | pipeline.html | New Client (#fhNewClient) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S06 | pipeline.html | Clear all (#filterClear) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S07 | pipeline.html | Archive (#fhDrawerDel) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | N — May archive/destroy live data | Presence-only / SKIP on live — use e2e fixture if must prove |  | w1/shots/pipeline/ |
| pipeline-S08 | pipeline.html | Close (#fhDrawerClose) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S09 | pipeline.html | Show all (#fhLensClear) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S10 | pipeline.html | Cancel (#fhDelCancel) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S11 | pipeline.html | Archive (#fhDelGo) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | N — May archive/destroy live data | Presence-only / SKIP on live — use e2e fixture if must prove |  | w1/shots/pipeline/ |
| pipeline-S12 | pipeline.html | Cancel (#fhNewCancel) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S13 | pipeline.html | Save (#fhNewGo) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S14 | pipeline.html | #fh-side-nav (#fh-side-nav) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S15 | pipeline.html | #boardStatus (#boardStatus) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S16 | pipeline.html | #board (#board) | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/pipeline/ |
| pipeline-S17 | pipeline.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ (owner/admin/closer/advisor/setter/inquiry/sales_mgr) | Y — discover only | Append missing controls before marking screen done |  | w1/shots/pipeline/ |

### `closer-dashboard.html`

- Workflow inventory rows: **35** · static controls extracted: **33**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| closer-dashboard-S01 | closer-dashboard.html | Open /app/closer-dashboard.html | closer (+ staff surface roles); home for closer | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S02 | closer-dashboard.html | No call link on this appointment (#fh-join) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S03 | closer-dashboard.html | Present (#fh-present) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S04 | closer-dashboard.html | Send contract (#fh-send-contract) | closer (+ staff surface roles); home for closer | N — May start contract sign/send | Presence-only / SKIP on live — use e2e fixture if must prove |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S05 | closer-dashboard.html | Send (#fh-contract-go) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S06 | closer-dashboard.html | Copy link (#fh-contract-copy) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S07 | closer-dashboard.html | 1 Deposit | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S08 | closer-dashboard.html | 2 Downsell | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S09 | closer-dashboard.html | 3 Callback | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S10 | closer-dashboard.html | 4 No show | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S11 | closer-dashboard.html | 5 Not a fit | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S12 | closer-dashboard.html | Price | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S13 | closer-dashboard.html | Amount low | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S14 | closer-dashboard.html | Spouse | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S15 | closer-dashboard.html | Timing | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S16 | closer-dashboard.html | Wants guarantee | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S17 | closer-dashboard.html | None | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S18 | closer-dashboard.html | Save · next call | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S19 | closer-dashboard.html | #calcGate (#calcGate) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S20 | closer-dashboard.html | #fh-side-nav (#fh-side-nav) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S21 | closer-dashboard.html | #fh-temp-chip (#fh-temp-chip) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S22 | closer-dashboard.html | #fh-join (#fh-join) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S23 | closer-dashboard.html | #fh-present (#fh-present) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S24 | closer-dashboard.html | #fh-send-contract (#fh-send-contract) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S25 | closer-dashboard.html | #fh-contract-panel (#fh-contract-panel) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S26 | closer-dashboard.html | #fh-contract-tpl (#fh-contract-tpl) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S27 | closer-dashboard.html | #fh-contract-blanks (#fh-contract-blanks) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S28 | closer-dashboard.html | #fh-contract-go (#fh-contract-go) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S29 | closer-dashboard.html | #fh-contract-copy (#fh-contract-copy) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S30 | closer-dashboard.html | #fh-contract-link (#fh-contract-link) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S31 | closer-dashboard.html | #fh-contract-msg (#fh-contract-msg) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S32 | closer-dashboard.html | #calcTitle (#calcTitle) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S33 | closer-dashboard.html | #calcClientName (#calcClientName) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S34 | closer-dashboard.html | #calcGrid (#calcGrid) | closer (+ staff surface roles); home for closer | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/closer-dashboard/ |
| closer-dashboard-S35 | closer-dashboard.html | LIVE-EXPAND: any JS-painted controls not in static list | closer (+ staff surface roles); home for closer | Y — discover only | Append missing controls before marking screen done |  | w1/shots/closer-dashboard/ |

### `my-numbers.html`

- Workflow inventory rows: **4** · static controls extracted: **2**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| my-numbers-S01 | my-numbers.html | Open /app/my-numbers.html | closer, owner, admin | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w1/shots/my-numbers/ |
| my-numbers-S02 | my-numbers.html | #fh-side-nav (#fh-side-nav) | closer, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/my-numbers/ |
| my-numbers-S03 | my-numbers.html | #fh-stage (#fh-stage) | closer, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/my-numbers/ |
| my-numbers-S04 | my-numbers.html | LIVE-EXPAND: any JS-painted controls not in static list | closer, owner, admin | Y — discover only | Append missing controls before marking screen done |  | w1/shots/my-numbers/ |

### `sales-floor.html`

- Workflow inventory rows: **16** · static controls extracted: **14**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| sales-floor-S01 | sales-floor.html | Open /app/sales-floor.html | sales_manager, owner, admin | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w1/shots/sales-floor/ |
| sales-floor-S02 | sales-floor.html | Previous closer (#fh-closer-prev) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S03 | sales-floor.html | Next closer (#fh-closer-next) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S04 | sales-floor.html | fh-flag-mkt (#fh-flag-mkt) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S05 | sales-floor.html | Today\'s recordings (#fh-recordings-jump) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S06 | sales-floor.html | #fh-side-nav (#fh-side-nav) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S07 | sales-floor.html | #fh-stage (#fh-stage) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S08 | sales-floor.html | #fh-offer-stack (#fh-offer-stack) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S09 | sales-floor.html | #fh-closer-focus (#fh-closer-focus) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S10 | sales-floor.html | #fh-recordings (#fh-recordings) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S11 | sales-floor.html | #fh-closer-prev (#fh-closer-prev) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S12 | sales-floor.html | #fh-closer-next (#fh-closer-next) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S13 | sales-floor.html | #fh-flag-mkt (#fh-flag-mkt) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S14 | sales-floor.html | #fh-recordings-jump (#fh-recordings-jump) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S15 | sales-floor.html | #fh-drive-refresh (#fh-drive-refresh) | sales_manager, owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/sales-floor/ |
| sales-floor-S16 | sales-floor.html | LIVE-EXPAND: any JS-painted controls not in static list | sales_manager, owner, admin | Y — discover only | Append missing controls before marking screen done |  | w1/shots/sales-floor/ |

### `calendar.html`

- Workflow inventory rows: **7** · static controls extracted: **5**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| calendar-S01 | calendar.html | Open /app/calendar.html | staff+ | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w1/shots/calendar/ |
| calendar-S02 | calendar.html | No call link on this appointment (#unJoin) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/calendar/ |
| calendar-S03 | calendar.html | No client linked (#unFile) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/calendar/ |
| calendar-S04 | calendar.html | #fh-side-nav (#fh-side-nav) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/calendar/ |
| calendar-S05 | calendar.html | #unJoin (#unJoin) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/calendar/ |
| calendar-S06 | calendar.html | #unFile (#unFile) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/calendar/ |
| calendar-S07 | calendar.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ | Y — discover only | Append missing controls before marking screen done |  | w1/shots/calendar/ |

### `present.html`

- Workflow inventory rows: **11** · static controls extracted: **9**
- Note: **PROTECTED** — prove only, never remove

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| present-S01 | present.html | Open /app/present.html | PROTECTED Present deck — closer flow | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w1/shots/present/ |
| present-S02 | present.html | Back | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S03 | present.html | Reframes | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S04 | present.html | Next screen | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S05 | present.html | #fh-cost (#fh-cost) | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S06 | present.html | #fh-ebook (#fh-ebook) | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S07 | present.html | #fh-sale-motion (#fh-sale-motion) | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S08 | present.html | #fh-contract-tpl (#fh-contract-tpl) | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S09 | present.html | #fh-contract-link (#fh-contract-link) | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S10 | present.html | #fh-repair-paid (#fh-repair-paid) | PROTECTED Present deck — closer flow | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w1/shots/present/ |
| present-S11 | present.html | LIVE-EXPAND: any JS-painted controls not in static list | PROTECTED Present deck — closer flow | Y — discover only | Append missing controls before marking screen done |  | w1/shots/present/ |

### `closer-call.html`

- Workflow inventory rows: **2** · static controls extracted: **36**
- Note: **PROTECTED** — prove only, never remove

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| closer-call-S01 | closer-call.html | Open /app/closer-call.html | PROTECTED redirect → closer-dashboard.html | Y — load only | Redirects to closer-dashboard.html (same query/hash) |  | w1/shots/closer-call/ |
| closer-call-S02 | closer-call.html | Confirm redirect target | PROTECTED redirect → closer-dashboard.html | Y — observe only | Lands on closer-dashboard.html with client context preserved if query present |  | w1/shots/closer-call/ |

## W2 sequences — File work

### `client-control-panel.html`

- Workflow inventory rows: **26** · static controls extracted: **24**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| client-control-panel-S01 | client-control-panel.html | Open /app/client-control-panel.html | staff+ | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w2/shots/client-control-panel/ |
| client-control-panel-S02 | client-control-panel.html | Copy link (#ccp-approve-copy) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S03 | client-control-panel.html | Pull TransUnion → (#ccp-pull-tu) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S04 | client-control-panel.html | Pull Experian → (#ccp-pull-ex) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S05 | client-control-panel.html | Pull Equifax → (#ccp-pull-eq) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S06 | client-control-panel.html | Generate Apps → (#ccp-generate-apps) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S07 | client-control-panel.html | Issue Inquiry Removal → (#ccp-issue-ir) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S08 | client-control-panel.html | Agent context collapsed by default ⌄ | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S09 | client-control-panel.html | Credit &amp; Hold Status collapsed ⌄ | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S10 | client-control-panel.html | Details collapsed by default ⌄ | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S11 | client-control-panel.html | Save notes (#notes-save) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S12 | client-control-panel.html | Documents collapsed by default ⌄ | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S13 | client-control-panel.html | Open Bank Inbox ↗ (#ccp-bank-inbox-open) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S14 | client-control-panel.html | System Facts collapsed ⌄ | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S15 | client-control-panel.html | Record consent for this client ↗ (#ccp-consent-link) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S16 | client-control-panel.html | Open Pipeline ↗ (#ccp-link-pipeline) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S17 | client-control-panel.html | Open Closer Deck ↗ (#ccp-link-present) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S18 | client-control-panel.html | Open Messaging ↗ (#ccp-link-messaging) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S19 | client-control-panel.html | Open Inquiry Remover ↗ (#ccp-link-ir) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S20 | client-control-panel.html | Open Funding Matrix ↗ (#ccp-link-lenders) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S21 | client-control-panel.html | Open Credit Snapshot ↗ (#ccp-link-present2) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S22 | client-control-panel.html | #fh-side-nav (#fh-side-nav) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S23 | client-control-panel.html | #fh-funding-apply (#fh-funding-apply) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S24 | client-control-panel.html | #fh-funding-apply-status (#fh-funding-apply-status) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S25 | client-control-panel.html | #fh-funding-apply-list (#fh-funding-apply-list) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/client-control-panel/ |
| client-control-panel-S26 | client-control-panel.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ | Y — discover only | Append missing controls before marking screen done |  | w2/shots/client-control-panel/ |

### `messaging.html`

- Workflow inventory rows: **10** · static controls extracted: **8**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| messaging-S01 | messaging.html | Open /app/messaging.html | staff+ | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w2/shots/messaging/ |
| messaging-S02 | messaging.html | All &mdash; | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S03 | messaging.html | Needs reply &mdash; | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S04 | messaging.html | Send (#sendBtn) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S05 | messaging.html | Reference who-sent-it colour key ▾ (#demoToggle) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S06 | messaging.html | Their file &#8599; (# + encodeURIComponent(row.client_id) +       ) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S07 | messaging.html | #fh-side-nav (#fh-side-nav) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S08 | messaging.html | #sendBtn (#sendBtn) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S09 | messaging.html | #sendStatus (#sendStatus) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/messaging/ |
| messaging-S10 | messaging.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ | Y — discover only | Append missing controls before marking screen done |  | w2/shots/messaging/ |

### `documents.html`

- Workflow inventory rows: **8** · static controls extracted: **6**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| documents-S01 | documents.html | Open /app/documents.html | staff+ | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w2/shots/documents/ |
| documents-S02 | documents.html | Pending only (#pendingBtn) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/documents/ |
| documents-S03 | documents.html | Open PDF | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/documents/ |
| documents-S04 | documents.html | Remind | staff+ | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w2/shots/documents/ |
| documents-S05 | documents.html | Void | staff+ | N — May archive/destroy live data | Presence-only / SKIP on live — use e2e fixture if must prove |  | w2/shots/documents/ |
| documents-S06 | documents.html | #fh-side-nav (#fh-side-nav) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/documents/ |
| documents-S07 | documents.html | #pendingBtn (#pendingBtn) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/documents/ |
| documents-S08 | documents.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ | Y — discover only | Append missing controls before marking screen done |  | w2/shots/documents/ |

### `inquiry-remover.html`

- Workflow inventory rows: **20** · static controls extracted: **18**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| inquiry-remover-S01 | inquiry-remover.html | Open /app/inquiry-remover.html | staff+ | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S02 | inquiry-remover.html | Inquiries (#tab-inquiries) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S03 | inquiry-remover.html | Repair (#tab-repair) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S04 | inquiry-remover.html | Equifax 0 none in queue | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S05 | inquiry-remover.html | TransUnion 0 none in queue | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S06 | inquiry-remover.html | Experian 0 none in queue | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S07 | inquiry-remover.html | Close | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S08 | inquiry-remover.html | Send this one (#repairLetterSendOne) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S09 | inquiry-remover.html | Cancel | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S10 | inquiry-remover.html | Pull (#repairPullGo) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S11 | inquiry-remover.html | Retry (#repairRetry) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S12 | inquiry-remover.html | Mark as checked | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S13 | inquiry-remover.html | Send | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S14 | inquiry-remover.html | Stage | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S15 | inquiry-remover.html | Soft pull | staff+ | N — May trigger credit pull | Presence-only / SKIP on live — use e2e fixture if must prove |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S16 | inquiry-remover.html | Clean personal info | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S17 | inquiry-remover.html | Enroll | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S18 | inquiry-remover.html | Open Experian upload ↗ | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S19 | inquiry-remover.html | #fh-side-nav (#fh-side-nav) | staff+ | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/inquiry-remover/ |
| inquiry-remover-S20 | inquiry-remover.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ | Y — discover only | Append missing controls before marking screen done |  | w2/shots/inquiry-remover/ |

### `lenders.html`

- Workflow inventory rows: **24** · static controls extracted: **22**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| lenders-S01 | lenders.html | Open /app/lenders.html | owner, admin, funding_advisor | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w2/shots/lenders/ |
| lenders-S02 | lenders.html | Lender list | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S03 | lenders.html | Bureau mismatch queue | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S04 | lenders.html | AI bureau config | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S05 | lenders.html | Apply filters (#btnFilter) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S06 | lenders.html | Export CSV (#btnExport) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S07 | lenders.html | Import CSV (#btnImportToggle) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S08 | lenders.html | Add blank row (#btnAdd) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S09 | lenders.html | Import now (#btnImportRun) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S10 | lenders.html | Cancel (#btnImportCancel) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S11 | lenders.html | Add bureau row (#btnAddBureau) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S12 | lenders.html | Save | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S13 | lenders.html | Confirm | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S14 | lenders.html | Corrected | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S15 | lenders.html | Dismiss | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S16 | lenders.html | #fh-side-nav (#fh-side-nav) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S17 | lenders.html | #btnFilter (#btnFilter) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S18 | lenders.html | #btnExport (#btnExport) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S19 | lenders.html | #btnImportToggle (#btnImportToggle) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S20 | lenders.html | #btnAdd (#btnAdd) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S21 | lenders.html | #btnImportRun (#btnImportRun) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S22 | lenders.html | #btnImportCancel (#btnImportCancel) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S23 | lenders.html | #btnAddBureau (#btnAddBureau) | owner, admin, funding_advisor | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/lenders/ |
| lenders-S24 | lenders.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin, funding_advisor | Y — discover only | Append missing controls before marking screen done |  | w2/shots/lenders/ |

### `consent-capture.html`

- Workflow inventory rows: **7** · static controls extracted: **5**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| consent-capture-S01 | consent-capture.html | Open /app/consent-capture.html | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w2/shots/consent-capture/ |
| consent-capture-S02 | consent-capture.html | They ticked a box Use when they clicked to agree and typed nothing. | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/consent-capture/ |
| consent-capture-S03 | consent-capture.html | Clear (#ccSignClear) | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/consent-capture/ |
| consent-capture-S04 | consent-capture.html | Record consent (#ccSubmit) | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/consent-capture/ |
| consent-capture-S05 | consent-capture.html | Withdraw | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/consent-capture/ |
| consent-capture-S06 | consent-capture.html | #fh-side-nav (#fh-side-nav) | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/consent-capture/ |
| consent-capture-S07 | consent-capture.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin, closer, funding_advisor · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w2/shots/consent-capture/ |

### `soft-pull-approve.html`

- Workflow inventory rows: **3** · static controls extracted: **1**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| soft-pull-approve-S01 | soft-pull-approve.html | Open /app/soft-pull-approve.html | soft-pull approval path (off-nav) | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w2/shots/soft-pull-approve/ |
| soft-pull-approve-S02 | soft-pull-approve.html | I agree — submit soft-pull approval (#go) | soft-pull approval path (off-nav) | N — May trigger credit pull | Presence-only / SKIP on live — use e2e fixture if must prove |  | w2/shots/soft-pull-approve/ |
| soft-pull-approve-S03 | soft-pull-approve.html | LIVE-EXPAND: any JS-painted controls not in static list | soft-pull approval path (off-nav) | Y — discover only | Append missing controls before marking screen done |  | w2/shots/soft-pull-approve/ |

### `finance-os.html`

- Workflow inventory rows: **3** · static controls extracted: **1**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| finance-os-S01 | finance-os.html | Open /app/finance-os.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w2/shots/finance-os/ |
| finance-os-S02 | finance-os.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w2/shots/finance-os/ |
| finance-os-S03 | finance-os.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w2/shots/finance-os/ |

## W3 sequences — Ops + portals

### `ops-admin.html`

- Workflow inventory rows: **9** · static controls extracted: **7**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| ops-admin-S01 | ops-admin.html | Open /app/ops-admin.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/ops-admin/ |
| ops-admin-S02 | ops-admin.html | Last 7 Days ▾ (#period-btn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S03 | ops-admin.html | Money KPIs · AR · compliance | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S04 | ops-admin.html | People staff, comp &amp; consent | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S05 | ops-admin.html | Send what is waiting (#outboxSend) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S06 | ops-admin.html | Pause sending (#outboxToggle) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S07 | ops-admin.html | Email unsent invoices (#outboxInvoices) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S08 | ops-admin.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/ops-admin/ |
| ops-admin-S09 | ops-admin.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/ops-admin/ |

### `galaxy.html`

- Workflow inventory rows: **3** · static controls extracted: **1**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| galaxy-S01 | galaxy.html | Open /app/galaxy.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/galaxy/ |
| galaxy-S02 | galaxy.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/galaxy/ |
| galaxy-S03 | galaxy.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/galaxy/ |

### `company-brain.html`

- Workflow inventory rows: **13** · static controls extracted: **11**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| company-brain-S01 | company-brain.html | Open /app/company-brain.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/company-brain/ |
| company-brain-S02 | company-brain.html | New chat (#newChat) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S03 | company-brain.html | Show your chats (#railToggle) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S04 | company-brain.html | Documents 0 (#docsBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S05 | company-brain.html | Add a document (#attachBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S06 | company-brain.html | Send (#askBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S07 | company-brain.html | Close documents (#docsClose) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S08 | company-brain.html | Refresh (#refreshDocs) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S09 | company-brain.html | Refresh (#refreshReviews) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S10 | company-brain.html | Approve | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S11 | company-brain.html | Turn down | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S12 | company-brain.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/company-brain/ |
| company-brain-S13 | company-brain.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/company-brain/ |

### `agent-editor.html`

- Workflow inventory rows: **11** · static controls extracted: **9**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| agent-editor-S01 | agent-editor.html | Open /app/agent-editor.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/agent-editor/ |
| agent-editor-S02 | agent-editor.html | Promote to live (#promoteBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S03 | agent-editor.html | Return to shadow (#demoteBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S04 | agent-editor.html | Save agent (#saveBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S05 | agent-editor.html | Revert (#revertBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S06 | agent-editor.html | ✓ '+e+' | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S07 | agent-editor.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S08 | agent-editor.html | #saveBtn (#saveBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S09 | agent-editor.html | #revertBtn (#revertBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S10 | agent-editor.html | #saveNote (#saveNote) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/agent-editor/ |
| agent-editor-S11 | agent-editor.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/agent-editor/ |

### `automations.html`

- Workflow inventory rows: **3** · static controls extracted: **1**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| automations-S01 | automations.html | Open /app/automations.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/automations/ |
| automations-S02 | automations.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/automations/ |
| automations-S03 | automations.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/automations/ |

### `journeys.html`

- Workflow inventory rows: **28** · static controls extracted: **26**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| journeys-S01 | journeys.html | Open /app/journeys.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/journeys/ |
| journeys-S02 | journeys.html | Undo (#undo) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S03 | journeys.html | Save version (#savever) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S04 | journeys.html | Test against the code (#runreal) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S05 | journeys.html | Apply to code (#apply) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S06 | journeys.html | Step | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S07 | journeys.html | Simulate | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S08 | journeys.html | History | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S09 | journeys.html | Add a step here | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S10 | journeys.html | Make the change (#asksend) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S11 | journeys.html | Throw it away (#reject) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S12 | journeys.html | Keep it (#accept) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S13 | journeys.html | Discard (#discard) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S14 | journeys.html | Apply to code (#applybar) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S15 | journeys.html | Move up | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S16 | journeys.html | Move down | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S17 | journeys.html | Delete | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S18 | journeys.html | Make the change (#sgo) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S19 | journeys.html | Run from here (#runhere) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S20 | journeys.html | Stop (#simstop) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S21 | journeys.html | Run the journey (#simstart) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S22 | journeys.html | Roll back to this | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S23 | journeys.html | Reverted | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S24 | journeys.html | Put it back | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S25 | journeys.html | Close (#runclose) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S26 | journeys.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S27 | journeys.html | #savever (#savever) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/journeys/ |
| journeys-S28 | journeys.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/journeys/ |

### `template-editor.html`

- Workflow inventory rows: **20** · static controls extracted: **18**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| template-editor-S01 | template-editor.html | Open /app/template-editor.html | staff+ (approve card owner/admin only) | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w3/shots/template-editor/ |
| template-editor-S02 | template-editor.html | Save wording (#saveBtn) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S03 | template-editor.html | Undo my changes (#revertBtn) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S04 | template-editor.html | Approve this wording (#apprBtn) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S05 | template-editor.html | Previous (#tplPrev) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S06 | template-editor.html | = pages - 1 ? " disabled" : "") + '>Next (#tplNext) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S07 | template-editor.html | #fh-side-nav (#fh-side-nav) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S08 | template-editor.html | #tplList (#tplList) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S09 | template-editor.html | #saveBtn (#saveBtn) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S10 | template-editor.html | #revertBtn (#revertBtn) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S11 | template-editor.html | #saveMsg (#saveMsg) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S12 | template-editor.html | #apprCard (#apprCard) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S13 | template-editor.html | #apprState (#apprState) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S14 | template-editor.html | #apprRead (#apprRead) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S15 | template-editor.html | #apprBtn (#apprBtn) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S16 | template-editor.html | #apprMsg (#apprMsg) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S17 | template-editor.html | #tplPager (#tplPager) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S18 | template-editor.html | #tplPrev (#tplPrev) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S19 | template-editor.html | #tplNext (#tplNext) | staff+ (approve card owner/admin only) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/template-editor/ |
| template-editor-S20 | template-editor.html | LIVE-EXPAND: any JS-painted controls not in static list | staff+ (approve card owner/admin only) | Y — discover only | Append missing controls before marking screen done |  | w3/shots/template-editor/ |

### `products-commissions.html`

- Workflow inventory rows: **13** · static controls extracted: **11**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| products-commissions-S01 | products-commissions.html | Open /app/products-commissions.html | owner, admin, sales_manager | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w3/shots/products-commissions/ |
| products-commissions-S02 | products-commissions.html | View payout ledger → (#ledgerLink) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S03 | products-commissions.html | Products | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S04 | products-commissions.html | Commission rules | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S05 | products-commissions.html | ← Back to rules (#ledgerBack) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S06 | products-commissions.html | Save (#edSave) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S07 | products-commissions.html | Cancel (#edCancel) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S08 | products-commissions.html | See these payouts → | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S09 | products-commissions.html | Change rate | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S10 | products-commissions.html | Close v'+av.v+' · open v'+(av.v+1)+' | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S11 | products-commissions.html | Cancel | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S12 | products-commissions.html | #fh-side-nav (#fh-side-nav) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/products-commissions/ |
| products-commissions-S13 | products-commissions.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin, sales_manager | Y — discover only | Append missing controls before marking screen done |  | w3/shots/products-commissions/ |

### `staff-teams.html`

- Workflow inventory rows: **13** · static controls extracted: **11**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| staff-teams-S01 | staff-teams.html | Open /app/staff-teams.html | owner, admin, sales_manager | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w3/shots/staff-teams/ |
| staff-teams-S02 | staff-teams.html | Roster | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S03 | staff-teams.html | Permissions | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S04 | staff-teams.html | Clock &amp; consent | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S05 | staff-teams.html | Telemetry | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S06 | staff-teams.html | Permissions → (#toAdvanced) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S07 | staff-teams.html | Refresh (#teleRefresh) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S08 | staff-teams.html | Save (#edSave) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S09 | staff-teams.html | Cancel (#edCancel) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S10 | staff-teams.html | Reset password (#edReset) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S11 | staff-teams.html | Revoke login (#edDeact) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S12 | staff-teams.html | #fh-side-nav (#fh-side-nav) | owner, admin, sales_manager | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/staff-teams/ |
| staff-teams-S13 | staff-teams.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin, sales_manager | Y — discover only | Append missing controls before marking screen done |  | w3/shots/staff-teams/ |

### `contracts.html`

- Workflow inventory rows: **24** · static controls extracted: **22**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| contracts-S01 | contracts.html | Open /app/contracts.html | owner, admin | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w3/shots/contracts/ |
| contracts-S02 | contracts.html | Upload a PDF (#btnUpload) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S03 | contracts.html | New wording (#btnNewTpl) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S04 | contracts.html | Add a blank (#btnAddField) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S05 | contracts.html | Save (#btnSaveTpl) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S06 | contracts.html | Archive (#btnArchive) | owner, admin | N — May archive/destroy live data | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/contracts/ |
| contracts-S07 | contracts.html | Cancel (#btnCancelTpl) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S08 | contracts.html | Add a signer (#btnAddSigner) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S09 | contracts.html | Save boxes (#btnSaveFields) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S10 | contracts.html | Remove this box (#bpDel) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S11 | contracts.html | #fh-side-nav (#fh-side-nav) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S12 | contracts.html | #tplCard (#tplCard) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S13 | contracts.html | #btnUpload (#btnUpload) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S14 | contracts.html | #btnNewTpl (#btnNewTpl) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S15 | contracts.html | #tplList (#tplList) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S16 | contracts.html | #tplEditor (#tplEditor) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S17 | contracts.html | #btnAddField (#btnAddField) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S18 | contracts.html | #btnSaveTpl (#btnSaveTpl) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S19 | contracts.html | #btnArchive (#btnArchive) | owner, admin | N — May archive/destroy live data | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/contracts/ |
| contracts-S20 | contracts.html | #btnCancelTpl (#btnCancelTpl) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S21 | contracts.html | #tplMsg (#tplMsg) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S22 | contracts.html | #btnAddSigner (#btnAddSigner) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S23 | contracts.html | #btnSaveFields (#btnSaveFields) | owner, admin | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/contracts/ |
| contracts-S24 | contracts.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin | Y — discover only | Append missing controls before marking screen done |  | w3/shots/contracts/ |

### `campaign-manager.html`

- Workflow inventory rows: **25** · static controls extracted: **23**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| campaign-manager-S01 | campaign-manager.html | Open /app/campaign-manager.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/campaign-manager/ |
| campaign-manager-S02 | campaign-manager.html | Reload (#reloadBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S03 | campaign-manager.html | Pull campaigns, ad sets, ads and spend from Meta. (#syncMetaBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S04 | campaign-manager.html | Close campaign detail (#dwClose) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S05 | campaign-manager.html | ‹ prev (#cPrev) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S06 | campaign-manager.html | next › (#cNext) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S07 | campaign-manager.html | Stop spending | owner, admin · NAV_HIDDEN | N — May edit live rates/spend | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/campaign-manager/ |
| campaign-manager-S08 | campaign-manager.html | Start spending again | owner, admin · NAV_HIDDEN | N — May edit live rates/spend | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/campaign-manager/ |
| campaign-manager-S09 | campaign-manager.html | Change daily budget | owner, admin · NAV_HIDDEN | N — May edit live rates/spend | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/campaign-manager/ |
| campaign-manager-S10 | campaign-manager.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S11 | campaign-manager.html | #reloadBtn (#reloadBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S12 | campaign-manager.html | #syncMetaBtn (#syncMetaBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S13 | campaign-manager.html | #syncMetaMsg (#syncMetaMsg) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S14 | campaign-manager.html | #dwTitle (#dwTitle) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S15 | campaign-manager.html | #dwSub (#dwSub) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S16 | campaign-manager.html | #dwClose (#dwClose) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S17 | campaign-manager.html | #dwBody (#dwBody) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S18 | campaign-manager.html | #cPrev (#cPrev) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S19 | campaign-manager.html | #cNext (#cNext) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S20 | campaign-manager.html | #dwCursor (#dwCursor) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S21 | campaign-manager.html | #dwDays (#dwDays) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S22 | campaign-manager.html | #dwMetrics (#dwMetrics) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S23 | campaign-manager.html | #dwChart (#dwChart) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S24 | campaign-manager.html | #dwTip (#dwTip) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/campaign-manager/ |
| campaign-manager-S25 | campaign-manager.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/campaign-manager/ |

### `social-studio.html`

- Workflow inventory rows: **30** · static controls extracted: **28**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| social-studio-S01 | social-studio.html | Open /app/social-studio.html | partner, owner, admin · NAV_HIDDEN staff | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/social-studio/ |
| social-studio-S02 | social-studio.html | Write a post (#composeTop) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S03 | social-studio.html | Connected accounts — — | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S04 | social-studio.html | Waiting to post — — | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S05 | social-studio.html | Needs a rewrite — — | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S06 | social-studio.html | Could not be sent — — | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S07 | social-studio.html | Sent — — | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S08 | social-studio.html | Write 3 posts for me (#ssGenBtn) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S09 | social-studio.html | Connect Facebook (#oauthFb) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S10 | social-studio.html | Connect Instagram (#oauthIg) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S11 | social-studio.html | Connect LinkedIn (#oauthLi) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S12 | social-studio.html | Check the wording (#runScreen) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S13 | social-studio.html | Queue post (#queueBtn) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S14 | social-studio.html | Send anything due now (#publishDueBtn) | partner, owner, admin · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/social-studio/ |
| social-studio-S15 | social-studio.html | Clear the form (#clearComposer) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S16 | social-studio.html | Waiting 0 | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S17 | social-studio.html | Needs a rewrite 0 | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S18 | social-studio.html | Could not be sent 0 | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S19 | social-studio.html | Sent 0 | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S20 | social-studio.html | Send history 0 | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S21 | social-studio.html | Close (#drawerClose) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S22 | social-studio.html | Approve it | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S23 | social-studio.html | Refuse it | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S24 | social-studio.html | Queue it | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S25 | social-studio.html | Throw it away | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S26 | social-studio.html | See the details | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S27 | social-studio.html | Throw this post away | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S28 | social-studio.html | #fh-side-nav (#fh-side-nav) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S29 | social-studio.html | #approvalBody (#approvalBody) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/social-studio/ |
| social-studio-S30 | social-studio.html | LIVE-EXPAND: any JS-painted controls not in static list | partner, owner, admin · NAV_HIDDEN staff | Y — discover only | Append missing controls before marking screen done |  | w3/shots/social-studio/ |

### `creative-factory.html`

- Workflow inventory rows: **26** · static controls extracted: **24**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| creative-factory-S01 | creative-factory.html | Open /app/creative-factory.html | partner, owner, admin · NAV_HIDDEN staff | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/creative-factory/ |
| creative-factory-S02 | creative-factory.html | Enqueue generation (#genBtn) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S03 | creative-factory.html | Run queued jobs now (#runJobsBtn) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S04 | creative-factory.html | Approve | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S05 | creative-factory.html | Reject | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S06 | creative-factory.html | Archive | partner, owner, admin · NAV_HIDDEN staff | N — May archive/destroy live data | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/creative-factory/ |
| creative-factory-S07 | creative-factory.html | Close detail (#dwClose) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S08 | creative-factory.html | ‹ prev | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S09 | creative-factory.html | next › | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S10 | creative-factory.html | all' + cnt(jobs.length) + ' | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S11 | creative-factory.html | =0?'on':'') + '">' + st + cnt(n) + ' | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S12 | creative-factory.html | Approve this brand | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S13 | creative-factory.html | Send it back | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S14 | creative-factory.html | Open the full creative | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S15 | creative-factory.html | #fh-side-nav (#fh-side-nav) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S16 | creative-factory.html | #apprRail (#apprRail) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S17 | creative-factory.html | #apprLimit (#apprLimit) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S18 | creative-factory.html | #apprTable (#apprTable) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S19 | creative-factory.html | #apprBody (#apprBody) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S20 | creative-factory.html | #apprPager (#apprPager) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S21 | creative-factory.html | #flagBody (#flagBody) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S22 | creative-factory.html | #dwEyebrow (#dwEyebrow) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S23 | creative-factory.html | #dwTitle (#dwTitle) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S24 | creative-factory.html | #dwClose (#dwClose) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S25 | creative-factory.html | #dwBody (#dwBody) | partner, owner, admin · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/creative-factory/ |
| creative-factory-S26 | creative-factory.html | LIVE-EXPAND: any JS-painted controls not in static list | partner, owner, admin · NAV_HIDDEN staff | Y — discover only | Append missing controls before marking screen done |  | w3/shots/creative-factory/ |

### `content-admin.html`

- Workflow inventory rows: **8** · static controls extracted: **6**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| content-admin-S01 | content-admin.html | Open /app/content-admin.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/content-admin/ |
| content-admin-S02 | content-admin.html | Save changes (#saveBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/content-admin/ |
| content-admin-S03 | content-admin.html | Choose file (#chooseBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/content-admin/ |
| content-admin-S04 | content-admin.html | Upload (#doUpload) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/content-admin/ |
| content-admin-S05 | content-admin.html | Clear (#clearUpload) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/content-admin/ |
| content-admin-S06 | content-admin.html | #saveBtn (#saveBtn) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/content-admin/ |
| content-admin-S07 | content-admin.html | #fh-side-nav (#fh-side-nav) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/content-admin/ |
| content-admin-S08 | content-admin.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/content-admin/ |

### `hiring.html`

- Workflow inventory rows: **13** · static controls extracted: **11**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| hiring-S01 | hiring.html | Open /app/hiring.html | owner, admin · NAV_HIDDEN | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/hiring/ |
| hiring-S02 | hiring.html | all stages '+pool.length+' | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S03 | hiring.html | all '+pool.length+' | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S04 | hiring.html | A valid kind of decision that nothing in the system produces yet. | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S05 | hiring.html | Advance (#dcAdvance) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S06 | hiring.html | Reject (#dcReject) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S07 | hiring.html | #dcTbl (#dcTbl) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S08 | hiring.html | #dcStage (#dcStage) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S09 | hiring.html | #dcAdvance (#dcAdvance) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S10 | hiring.html | #dcReason (#dcReason) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S11 | hiring.html | #dcReject (#dcReject) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S12 | hiring.html | #dcMsg (#dcMsg) | owner, admin · NAV_HIDDEN | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/hiring/ |
| hiring-S13 | hiring.html | LIVE-EXPAND: any JS-painted controls not in static list | owner, admin · NAV_HIDDEN | Y — discover only | Append missing controls before marking screen done |  | w3/shots/hiring/ |

### `brand-studio.html`

- Workflow inventory rows: **23** · static controls extracted: **21**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| brand-studio-S01 | brand-studio.html | Open /app/brand-studio.html | partner, owner, admin · NAV_HIDDEN staff menu | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/brand-studio/ |
| brand-studio-S02 | brand-studio.html | Reset (#resetBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S03 | brand-studio.html | Use text (#clearLogo) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S04 | brand-studio.html | Presets (#rampPreset) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S05 | brand-studio.html | Verify (#verifyBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S06 | brand-studio.html | copy | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S07 | brand-studio.html | copy (#copyTxt) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S08 | brand-studio.html | Create pages from selected funnels (#createPagesBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S09 | brand-studio.html | Turn on for this partner (#suiteOnBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S10 | brand-studio.html | Turn off (#suiteOffBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S11 | brand-studio.html | Write page copy (#genCopyBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S12 | brand-studio.html | Make a wordmark from the name (#genLogoBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S13 | brand-studio.html | Save &amp; apply (#saveBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S14 | brand-studio.html | Submit for approval (#submitBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S15 | brand-studio.html | Use this version | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S16 | brand-studio.html | Publish | partner, owner, admin · NAV_HIDDEN staff menu | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/brand-studio/ |
| brand-studio-S17 | brand-studio.html | Unpublish | partner, owner, admin · NAV_HIDDEN staff menu | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/brand-studio/ |
| brand-studio-S18 | brand-studio.html | #fh-side-nav (#fh-side-nav) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S19 | brand-studio.html | #approvalChip (#approvalChip) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S20 | brand-studio.html | #approvalTxt (#approvalTxt) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S21 | brand-studio.html | #saveBtn (#saveBtn) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S22 | brand-studio.html | #saveMsg (#saveMsg) | partner, owner, admin · NAV_HIDDEN staff menu | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/brand-studio/ |
| brand-studio-S23 | brand-studio.html | LIVE-EXPAND: any JS-painted controls not in static list | partner, owner, admin · NAV_HIDDEN staff menu | Y — discover only | Append missing controls before marking screen done |  | w3/shots/brand-studio/ |

### `partner-galaxy.html`

- Workflow inventory rows: **7** · static controls extracted: **5**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| partner-galaxy-S01 | partner-galaxy.html | Open /app/partner-galaxy.html | partner · NAV_HIDDEN staff | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/partner-galaxy/ |
| partner-galaxy-S02 | partner-galaxy.html | Download (#blasterBtn) | partner · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/partner-galaxy/ |
| partner-galaxy-S03 | partner-galaxy.html | #fh-side-nav (#fh-side-nav) | partner · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/partner-galaxy/ |
| partner-galaxy-S04 | partner-galaxy.html | #blasterGift (#blasterGift) | partner · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/partner-galaxy/ |
| partner-galaxy-S05 | partner-galaxy.html | #blasterBtn (#blasterBtn) | partner · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/partner-galaxy/ |
| partner-galaxy-S06 | partner-galaxy.html | #blasterStatus (#blasterStatus) | partner · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/partner-galaxy/ |
| partner-galaxy-S07 | partner-galaxy.html | LIVE-EXPAND: any JS-painted controls not in static list | partner · NAV_HIDDEN staff | Y — discover only | Append missing controls before marking screen done |  | w3/shots/partner-galaxy/ |

### `client-portal.html`

- Workflow inventory rows: **22** · static controls extracted: **20**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| client-portal-S01 | client-portal.html | Open /app/client-portal.html | client principal; owner walk (admin blocked) | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w3/shots/client-portal/ |
| client-portal-S02 | client-portal.html | Clear (#cpSignClear) | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S03 | client-portal.html | I sign to authorize Fundhub to prepare my dispute letters (#cpSignSubmit) | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S04 | client-portal.html | Ask about this | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S05 | client-portal.html | Unlock now | client principal; owner walk (admin blocked) | N — May trigger real charge / checkout | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/client-portal/ |
| client-portal-S06 | client-portal.html | Upload funding docs | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S07 | client-portal.html | Upload inquiry docs | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S08 | client-portal.html | Upload bureau response | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S09 | client-portal.html | Unlock | client principal; owner walk (admin blocked) | N — May trigger real charge / checkout | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/client-portal/ |
| client-portal-S10 | client-portal.html | Talk to an advisor | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S11 | client-portal.html | Payments | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S12 | client-portal.html | Agreements | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S13 | client-portal.html | Documents | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S14 | client-portal.html | Activity | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S15 | client-portal.html | Messages | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S16 | client-portal.html | Ask for a call | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S17 | client-portal.html | Close (#um-x) | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S18 | client-portal.html | Unlock — pay now (#um-go) | client principal; owner walk (admin blocked) | N — May trigger real charge / checkout | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/client-portal/ |
| client-portal-S19 | client-portal.html | Ask an advisor about this (#um-talk) | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S20 | client-portal.html | Close (#bm-x) | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S21 | client-portal.html | Review &amp; sign | client principal; owner walk (admin blocked) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/client-portal/ |
| client-portal-S22 | client-portal.html | LIVE-EXPAND: any JS-painted controls not in static list | client principal; owner walk (admin blocked) | Y — discover only | Append missing controls before marking screen done |  | w3/shots/client-portal/ |

### `affiliate.html`

- Workflow inventory rows: **13** · static controls extracted: **11**
- Note: **NAV_HIDDEN** (URL prove; rail must stay clean)

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| affiliate-S01 | affiliate.html | Open /app/affiliate.html | affiliate principal; owner walk · NAV_HIDDEN staff | Y — load only | Page opens via URL; NOT in rail menu (NAV_HIDDEN) |  | w3/shots/affiliate/ |
| affiliate-S02 | affiliate.html | Copy link (#copyLink) | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S03 | affiliate.html | Copy code (#copyCode) | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S04 | affiliate.html | Ask (#brainBtn) | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S05 | affiliate.html | Download Message Blaster (#blasterBtn) | affiliate principal; owner walk · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/affiliate/ |
| affiliate-S06 | affiliate.html | Referred leads | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S07 | affiliate.html | Payouts | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S08 | affiliate.html | Terms | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S09 | affiliate.html | #fh-side-nav (#fh-side-nav) | affiliate principal; owner walk · NAV_HIDDEN staff | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/affiliate/ |
| affiliate-S10 | affiliate.html | #blasterCard (#blasterCard) | affiliate principal; owner walk · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/affiliate/ |
| affiliate-S11 | affiliate.html | #blasterBtn (#blasterBtn) | affiliate principal; owner walk · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/affiliate/ |
| affiliate-S12 | affiliate.html | #blasterStatus (#blasterStatus) | affiliate principal; owner walk · NAV_HIDDEN staff | N — May send live outbound | Presence-only / SKIP on live — use e2e fixture if must prove |  | w3/shots/affiliate/ |
| affiliate-S13 | affiliate.html | LIVE-EXPAND: any JS-painted controls not in static list | affiliate principal; owner walk · NAV_HIDDEN staff | Y — discover only | Append missing controls before marking screen done |  | w3/shots/affiliate/ |

### `payment-success.html`

- Workflow inventory rows: **3** · static controls extracted: **1**

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| payment-success-S01 | payment-success.html | Open /app/payment-success.html | checkout return (off-nav) | Y — load only | Page paints for allowed role; bounce-home if blocked |  | w3/shots/payment-success/ |
| payment-success-S02 | payment-success.html | Check again (#again) | checkout return (off-nav) | Y — UI/nav — still confirm no live write | Works for role: state change or navigation; no 403; no silent no-op (UI-STANDARDS §5) |  | w3/shots/payment-success/ |
| payment-success-S03 | payment-success.html | LIVE-EXPAND: any JS-painted controls not in static list | checkout return (off-nav) | Y — discover only | Append missing controls before marking screen done |  | w3/shots/payment-success/ |

## W4 sequences — Auth / roles / killed pages

| Step ID | Screen | Control label | Role(s) | Safe to click? (Y/N + why) | Expected result | Status (blank = UNVERIFIED) | Evidence path |
|---|---|---|---|---|---|---|---|
| w4-auth-S01 | login.html /app/ | Sign in as owner e2e | owner | Y — e2e account | Lands on pipeline.html home |  | w4/shots/auth/ |
| w4-auth-S02 | /app/ | Sign in as closer e2e | closer | Y — e2e account | Lands on closer-dashboard.html |  | w4/shots/auth/ |
| w4-auth-S03 | /app/ | Sign in as sales_manager e2e | sales_manager | Y — e2e account | Lands on sales-floor.html |  | w4/shots/auth/ |
| w4-auth-S04 | /app/ | Sign in as funding_advisor e2e | funding_advisor | Y — e2e account | Lands on client-control-panel.html; Lenders visible |  | w4/shots/auth/ |
| w4-auth-S05 | rail | Owner rail vs NAV_HIDDEN list | owner | Y — observe | None of NAV_HIDDEN files appear as .navitem |  | w4/shots/nav/ |
| w4-auth-S06 | rail | Direct URL each NAV_HIDDEN screen | owner | Y — load only | Page opens (allowed) but still absent from rail |  | w4/shots/nav/ |
| w4-auth-S07 | admin rail | Admin blocked portals | admin | Y — observe/bounce | client-portal, affiliate, partner-galaxy blocked/bounce; not usable desk |  | w4/shots/admin/ |
| w4-auth-S08 | partner | Campaigns nav row | partner | Y — observe | No Campaigns row (owner-set 2026-08-18) |  | w4/shots/partner/ |
| w4-auth-S09 | decommissioned | Open money-map.html etc. | owner | Y — expect miss | 404 / absent — must not reappear in nav |  | w4/shots/killed/ |
| w4-auth-S10 | closer | Present + call cockpit reachable | closer | Y — prove open only | Present opens; closer-call redirects to dashboard; controls exist (no remove) |  | w4/shots/protected/ |

## Evidence directories

```
docs/workflows/button-ux-validation-2026-08-21-evidence/
  w0/   # inventory JSON (written)
  w1/   # sales desk shots (empty until GO)
  w2/   # file work shots
  w3/   # ops + portals shots
  w4/   # auth/roles/killed shots
```

## Open question for Chris (one)

_None blocking W0. After GO: confirm whether soft-pull-approve and payment-success stay in scope for W2/W3 or are W4-only._

---

*W0 complete 2026-08-21. Waiting for GO.*
