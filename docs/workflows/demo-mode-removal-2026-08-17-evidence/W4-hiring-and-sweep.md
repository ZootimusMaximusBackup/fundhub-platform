# W4 — Hiring demo candidates + whole-repo demo sweep

Read-only map. Nothing deleted. Written by the main thread from the W4 agent's
return (the agent ran without write tools).

## JOB ONE — Hiring demo candidates

### 1. Screen and handlers
- `public/app/hiring.html` (one file, ~2700 lines, all logic in-page).
- `wireHiring()` at `:2563` fetches five endpoints in parallel:
  `api/hiring/candidates.mjs` (`:2586`), `postings.mjs` (`:2596`),
  `decisions.mjs` (`:2601`), `bench.mjs` (`:2611`), **plus `/api/demo/mode`** (`:2579-2582`).
- Role gate: `ROLE_SETS.HIRING = new Set(["owner","admin"])` — `src/http/read-api.mjs:146`.

### 2. Where demo candidates come from
**Real database rows**, written by the Demo Mode seeder. Not hardcoded, not a fixture.
- `src/demo/seed-ui-coverage.mjs:216-220` — hardcoded array of 3 names inside the seeder.
- `:223-227` — `INSERT INTO candidates (… source_detail, is_demo) … 'platform_demo', true`.
- `:231-238` — `INSERT INTO candidate_applications … answers '{"demo":true}'`.
- `:210-214` — `INSERT INTO hiring_job_postings … external_id 'DEMO-POST-CLOSER' … is_demo true`.
- Reached only via `platform-seed.mjs:264` ← `setDemoMode(enabled:true)` `:300` ← `api/demo/mode.mjs:17`.
- The **only** other `INSERT INTO candidates` is the real intake path `src/hiring/pipeline.mjs:81`.
- Separate hardcoded `SAMPLE_APPS` / `SAMPLE_POSTINGS` / `SAMPLE_DECISIONS` at
  `hiring.html:901, 1330, 1380` are used **only** for the offline `fh_demo`
  localStorage session (`:2567-2569`) — not Demo Mode. See Bucket C / B5.

### 3. How a candidate is marked demo — THE MISMATCH
The database has a column. **The API does not return it.** The screen guesses.
- Column `candidates.is_demo` — `db/migrations/153_demo_ui_coverage.sql:8`.
- `candidate_applications` has **no** `is_demo` column at all (`seed-ui-coverage.mjs:232`).
- `api/hiring/candidates.mjs:42-43` — the SELECT carries `c.source_detail` but
  **never `c.is_demo`**.
- So `public/app/hiring.html:2549-2552` matches heuristically:
  `r.source_detail === 'platform_demo'` OR `/^DEMO[\s—-]/` on the name.
- Both marks are written by the seeder, so it works today — but it is a string
  match, not a column read. Documented honestly at `hiring.html:2543-2548`.
- **Risk:** any real candidate named "DEMO …" or sourced `platform_demo` is
  silently hidden and uncounted.

### 4. Filters out, or shows deliberately? — BOTH
**(a) Board visibility — hidden by default, shown only when Demo Mode is ON.**
- `hiring.html:1726` `var SHOW_DEMO_ROWS = false;`
- `:1730` board filter, `:1829` review-queue filter.
- Flips true **only** from `GET /api/demo/mode → demo_mode_enabled` (`:2579-2582`)
  or an offline `fh_demo` session (`:2565-2566`).
- When shown they carry a grey `demo row` badge (`:1761`, `:1850`).

**(b) Numbers — always excluded, regardless of the toggle.**
- `:1634` `demoApps()`, `:1636-1654` `benchLessDemo()` — server bench totals are
  decremented client-side because `api/hiring/bench.mjs` counts demo
  applications with the real ones.
- `:1663, 1666-1669, 1712-1714, 1813-1820, 1871-1875` — every stat subtracts or
  excludes demo rows, with a "N demo rows not counted" note.

### 5. What Hiring shows if demo candidates go away
- **The numbers do not change at all** — they already exclude demo rows.
- The board shows real rows from the real intake path.
- **Would it be empty?** Only if `candidates` has no non-demo rows. **UNVERIFIED
  — needs a database query.** There is no non-demo candidate seed anywhere in
  `db/seed/` or `db/migrations/`, so if nobody has applied through the real
  form, the board is already empty today with Demo Mode off.
  `SELECT count(*) FROM candidates WHERE NOT is_demo` answers it.
- The screen has an honest empty state. It will not break.

### 6. Tests
**None.** `src/hiring/*` and `api/hiring/*` contain **zero** occurrences of
`demo`. `e2e/demo-mode.spec.mjs` does not list `hiring.html`. The `isDemoRow`
heuristic and the `benchLessDemo` subtraction are untested.

---

## BUCKET A — part of Demo Mode, safe to delete with it

- `public/app/sample-data.html` — the screen (and its `:376,411,419,426,437` calls).
- `api/demo/mode.mjs` — **but see Bucket B, four other UIs read it.**
- `netlify/functions/api.mjs:131` (import) and `:498` (`"demo/mode": demoMode`) —
  must move with the handler; `src/http/routes.test.mjs` guards both directions.
- `src/demo/platform-seed.mjs:286-304` `setDemoMode`, `:306-329` `getDemoModeStatus`,
  `:343+` `wipeDemoData`.
- `src/demo/roster.mjs`, `src/demo/seed-ui-coverage.mjs`, `src/demo/money-snapshot.mjs`.
- `src/demo/set-demo-mode.test.mjs`, `src/demo/platform-seed.pg.test.mjs`.
- `db/migrations/149_demo_pipeline_cards.sql`, `153_demo_ui_coverage.sql` — already applied.
- `public/app/shell.js:1722-1775` `mountDemoBanner`; `:27` BETA_PAGES; `:40` ALL;
  `:135-141` OWNER_ADMIN_ONLY; `SIDEBAR_HTML` at `:31`.
- `public/app/ops-admin.html:345-356, 1060-1110` — duplicate ON/OFF panel + link.
- `public/app/sidebar.fragment.html:60` and **34 inline sidebars** — all must
  change together via `scripts/sync-sidebar.mjs` or
  `src/http/app-nav-reachability.test.mjs` goes red.
- `scripts/build-artifact.mjs:74,105,106`; `scripts/build-crm-artifact.mjs:37`;
  `scripts/artifact-shell.html:119,121`.
- `e2e/demo-mode.spec.mjs`.

---

## BUCKET B — DELETING BREAKS SOMETHING ELSE

### B1. `is_demo` is load-bearing for money correctness across the whole app
Twenty production readers. Removing the column breaks all of them with SQL errors:

`api/read/invoices.mjs:31` · `api/read/commissions.mjs:31` · `api/chat/peers.mjs:26` ·
`api/read/staff.mjs:23-33,41,71` · `api/read/tradelines.mjs:153-159,188` ·
`api/dashboard/clients.mjs:20,46,75-85` · `api/dashboard/pipeline.mjs:45,53,83-104` ·
`src/sales/metrics.mjs:58,105,588-597,612-642` · `src/sales/offer-stack.mjs:23,63,75,115,146,240` ·
`src/shifts/store.mjs:233` · `src/lenders/store.mjs:37-38,56,85-86,357-385` ·
**`src/lenders/match.mjs:132,141-153,194` (matcher refuses demo lenders for real
clients — compliance-relevant)** · `src/calculators/deal-funding.mjs:17-19,133,145,272` ·
`src/galaxy/company-activity.mjs:88,117,152,161-190` · `src/contracts/upload.mjs:171` ·
**`src/demo/exclude-demo.mjs` — imported by 8 production modules above. NOT
deletable with the screen.**

### B2. `orgs.demo_mode_enabled` is read by production screens that are not the Demo Mode screen
- `db/migrations/148_demo_mode.sql:1` — already applied; §12 says a NEW migration must supersede.
- `src/demo/exclude-demo.mjs:4-8` — the single reader; feeds 8 production modules.
- `public/app/hiring.html:2579-2582` — **Hiring** flips `SHOW_DEMO_ROWS` from it.
- `public/app/shell.js:1732` — the banner on every CRM screen.
- `public/app/ops-admin.html:1090,1104` — second toggle UI.
- `public/app/demo-client-bootstrap.js:30-33` — loaded by **5 screens**
  (`client-control-panel.html:315`, `finance-os.html:20`, `closer-dashboard.html:195`,
  `documents.html:105`, `closer-call.html:13`). Deleting the script 404s all five.
- `public/app/galaxy.html:1793,1821` — empty state says "Turn Demo Mode on
  (Admin → Demo Mode) to seed open shifts". **Copy points at the deleted screen.**

### B3. `/api/demo/simulate` — a DIFFERENT feature in the same folder
- `api/demo/simulate.mjs`, `netlify/functions/api.mjs:130,497`, `src/demo/simulate-client.mjs`.
- **`public/app/finance-os.html:1003,1027` — the "Load simulated data" button.**
- `src/verification/journeys/funding.mjs:7,219-233,255,331,344` — the funding
  verification journey depends on it.
- `src/underwrite/underwriteiq.pg.test.mjs:27,62`; `src/http/session-six-items.test.mjs:5,35`.
- `src/chat/platform-help.mjs:55-59` — help topic tells users about it.

**Do not delete `api/demo/simulate.mjs` or `src/demo/simulate-client.mjs` with the screen.**

### B4. Demo LOGINS — a wholly separate subsystem, same word
- `src/auth/demo-logins.mjs:40` — `DEMO_ENV_VAR = "DEMO_LOGINS_ENABLED"`.
- `src/auth/demo-roster.mjs:41,51,77-102` — 7 demo staff, 3 demo accounts.
- `src/auth/login.mjs:94-146`; `src/auth/account-session.mjs:148-180`;
  `api/auth/login.mjs:15-16,27-68,140`; `public/login.html` (64 refs);
  `public/portal-login.html:146-151` — the login-page role switcher.
- `db/migrations/094_demo_logins.sql`, `112_sales_manager_role.sql:40-87`,
  `173_specialist_role_name.sql:11-12` — all applied.
- `src/http/demo-logins.test.mjs` (161 refs), `src/http/demo-logins.pg.test.mjs` (57 refs).
- **`scripts/journeys/generate.test.mjs:262-268` fails if `src/auth/demo-roster.mjs`
  stops existing** — inverted guard.
- `scripts/db/demo-password-hash.mjs:14-34`.

**Critical coupling:** `src/demo/platform-seed.mjs:31-32` throws
`demo_seed_requires_demo_staff` without a demo staff row. **Demo Mode seeding
depends on the demo logins system.**

### B5. Offline `fh_demo` localStorage mock — a THIRD, unrelated "demo mode"
`public/fh.js:7-209` — client-side offline fallback, own `DEMO_USERS` (`:10-18`),
own fake router, sets `localStorage.fh_demo`. Read by ~20 screens
(`public/app/data.js:59-66,92`, `hiring.html:2507,2564`, `shell.js:894-895,903,952-953`,
and more). Cleared by `crm.html:10-11`, `login.html:191-192`, `portal-login.html:150-151`.
Guarded by `src/http/crm-html.test.mjs:11-15`, `src/http/data-js.test.mjs:25-237`,
`src/http/demo-logins.test.mjs:361-363,565-571`, `src/http/pipeline-screen.test.mjs:124`.

**Deleting the Demo Mode screen does not touch this, and it must not be swept up.**

### B6. Wipe-trigger migrations — the guard half is production behaviour
`db/migrations/150_demo_wipe_allow.sql`, `151_demo_wipe_allow_more.sql`,
`152_demo_wipe_by_client.sql` rewrite no-delete triggers so `is_demo` rows can be
deleted **while real rows stay undeletable**. `154_no_bare_rls_again.sql` is
general RLS hygiene, not demo-only. `096_demo_client_entitlements.sql`.
All applied and listed in `db/expected-migrations.mjs:79,81,133-138`.
**§12: a new migration must supersede, and `npm run migrations:manifest` must be
re-run or CI fails at `.github/workflows/tests.yml:269-276`.**

### B7. Retention policy carries a claim that is now false
`src/retention/classes.mjs:45` says "*** THERE IS NO is_demo COLUMN ANYWHERE IN
THIS SCHEMA ***". Migrations 094/148/153 added it to 40+ tables. Same stale claim
baked into `db/migrations/100_retention_policy.sql:225-227,335` as a COMMENT.
Deleting Demo Mode does not break retention, but the comments are wrong today.

### B8. Tests that go red
`src/http/routes.test.mjs` · `src/http/app-nav-reachability.test.mjs:41-49` ·
`src/lenders/demo-gate.pg.test.mjs` (42 refs) · `src/galaxy/company-activity.pg.test.mjs:10,46-93` ·
`src/galaxy/company-activity.test.mjs:25-26` · `src/sales/metrics.test.mjs:70` ·
`src/lenders/match.test.mjs:99-106` · `src/calculators/deal-funding.test.mjs:170` ·
`src/shifts/store.test.mjs:163-166` · `src/demo/exclude-demo.test.mjs:3-7` ·
`src/http/staff-invite.test.mjs:40` · `src/http/campaign-endpoints.pg.test.mjs:93` ·
`src/verification/journeys/cross-cutting.mjs:276-285` · `src/verification/report.mjs:223` ·
`scripts/comprehensive-sandbox-gauntlet.mjs:90-111` · `scripts/sync-sidebar.mjs:47`

**§12 note:** `npm test` = `scripts/run-suite.mjs:50`, globbing `src/` and
`scripts/` only. `api/**` tests never run; `e2e/` runs only under
`npm run test:e2e` (`.github/workflows/tests.yml:182`).

---

## BUCKET C — "demo" means something else. DO NOT DELETE.

- `api/agents.mjs:7,15,34,127,290-311` — **demote** (Agent Editor promote/demote).
- `src/workflows/cards.test.mjs:36,49`; `src/handlers/client-lifecycle.mjs:243`;
  `client-lifecycle.test.mjs:284`; `src/handlers/comms.mjs:238` — card stage demotion.
- `src/banking/cashflow-seam.mjs:17`; `src/banking/store-seam.test.mjs:145` — demoted bills.
- `src/compliance/targeting.mjs:65` — "a neighbourhood is a **demo**graphic".
- `src/privacy/erasure.mjs:148`; `src/journeys/runner/diff.mjs:11`;
  `src/shifts/store.mjs:252` — "**demo**nstrated".
- `public/app/proxy-apply.js:127,214,234,266-326` — `hideModal`, case-insensitive false positive.
- `public/app/calendar.html:99,218-226` and `public/app/messaging.html:299-309` —
  `.demozone` / `.demo-div` CSS, the **demonstration-states** drawer. Not Demo Mode.
- `public/app/pipeline.html:550,580,615` — the demonstration strip.
- `public/app/chat-widget.js:63,250` — `opts.demo` widget preview flag.
- `src/banking/mock.mjs:69` — a comment.
- `api/dashboard/seed.mjs:5,33` — staging convenience seeder, `sample+…@fundhub.demo`.
- `public/404.html:69` — link copy.
- `docs/journeys/README.md:59`, `CHANGELOG.md:50,59,78` — historical narrative.

---

## Specific checks

**Demo-only column/migration:** `db/migrations/148_demo_mode.sql:1`
(`orgs.demo_mode_enabled`) is the only genuinely Demo-Mode-only one. `is_demo` is
**not** demo-only in effect — 20+ production readers depend on it (B1).

**Env var only demo reads:** `DEMO_LOGINS_ENABLED` (`src/auth/demo-logins.mjs:40`)
— belongs to demo LOGINS (B4), not the screen. Grep for `process.env.*DEMO*`
across `src/ api/ netlify/ scripts/ db/ .github/ netlify.toml` returns **nothing**;
it is read via an injected `env` object (`:56`). `.env` could not be read (sandbox
denied) — an undiscovered `DEMO_*` key cannot be ruled out.

**ROUTES entries:** `:130`/`:497` `demo/simulate` — **Bucket B**. `:131`/`:498`
`demo/mode` — Bucket A but four other UIs read it. `:245` "demote" — Bucket C.

**Intended journeys:** exactly one hit —
`docs/journeys/role-sales-manager-intended.md:19`, and it describes the **demo
LOGIN** (B4), not the Demo Mode screen. **No intended journey describes Demo Mode.**
If scope stays on the screen, no intended journey is touched. Deleting the demo
login roster WOULD contradict it — and `scripts/journeys/generate.test.mjs:262-268`
hard-fails if `src/auth/demo-roster.mjs` stops existing.

---

## Ambiguities not guessed

1. Does production `candidates` hold any non-demo rows? Determines whether
   Hiring's board is empty after removal. Needs a query.
2. `.env` / `.env.example` unreadable from this session.
3. `api/demo/mode.mjs` and `api/demo/simulate.mjs` share a folder but are
   **different features**. Deleting the folder wholesale breaks Finance OS and
   the funding verification journey.
4. Whether Chris wants the orange banner (`shell.js:1722`) and the ops-admin
   duplicate toggle (`ops-admin.html:345-356`) removed too — he named the screen
   and the nav entry only.
