# W2 — Demo seeding endpoint

Read-only map. Nothing deleted, no database queried. Written by the main thread
from the W2 agent's return (the agent ran without write tools).

## 1. Handler file and route path

**There is no endpoint named "seed".** Seeding is a **side effect of the ON
toggle**: `api/demo/mode.mjs:17` calls `setDemoMode`, and
`src/demo/platform-seed.mjs:300` calls `seedPlatformDemo` only when
`enabled` is true.

**Primary:** `api/demo/mode.mjs` → `POST /api/demo/mode` with `{"enabled": true}`.

Two other seeding endpoints exist, separate handlers, flagged not claimed:
- `api/demo/simulate.mjs` → `POST /api/demo/simulate` (one simulated client,
  `src/demo/simulate-client.mjs`). This is the Finance OS "Load simulated data"
  button — `public/app/finance-os.html:1003, 1027`.
- `api/dashboard/seed.mjs` → `POST /api/dashboard/seed` (one sample client
  through the event bus, email `sample+<ts>@fundhub.demo`, `:33`).

## 2. ROUTES map — both sides present

- `netlify/functions/api.mjs:131` — `import demoMode from "../../api/demo/mode.mjs";`
- `netlify/functions/api.mjs:498` — `"demo/mode": demoMode,`

Neighbours: `:497` `"demo/simulate": demoSimulate,` and `:287`
`"dashboard/seed": dashSeed,`. All three are routed.
`src/http/routes.test.mjs:38` enforces the handler↔ROUTES invariant.

**DANGER:** `api.mjs:131` is a static top-level import. Deleting
`api/demo/mode.mjs` without also removing line 131 breaks the module and takes
down **every** `/api/*` route, not just demo. Handler file, line 131 and line
498 move in one commit or nothing ships.

## 3. What the ON toggle writes

Entry `src/demo/platform-seed.mjs:29` `seedPlatformDemo(db, { orgId })`.
Idempotent; every write is `WHERE NOT EXISTS` or count-guarded.

**Preconditions — it refuses without them:**
- `:31-32` requires demo staff rows, else throws `demo_seed_requires_demo_staff`.
  Those rows come from `db/migrations/094_demo_logins.sql:73`.
- `:38` requires an active `products` row, else `demo_seed_requires_products`.

**Demo markers — the data IS separable.** Every row carries at least `is_demo`:

| Marker | Where |
|---|---|
| `is_demo = true` boolean column, ~35 tables | `db/migrations/094_demo_logins.sql:73-74`, `148_demo_mode.sql` |
| Email `demo.client.NN@demo.fundhub.local` | `src/demo/roster.mjs:1-5` |
| `org_id` on every write | e.g. `platform-seed.mjs:73-76` |
| `DEMO` name prefix, `channel_source='platform_demo'`, tags | `platform-seed.mjs:74`, `roster.mjs:2` |
| Org toggle `orgs.demo_mode_enabled` | `platform-seed.mjs:290` |

**Tables written by `platform-seed.mjs`** (counts from `src/demo/roster.mjs`:
12 clients, 21 lenders, 11 call states):

affiliates 1 (`:43`) · partners 1 (`:45`) · lenders 21 (`:53`, `:61`) ·
clients 12 (`:73`/`:77`) · crs_results 12 (`:85`) · tradelines 36 (`:87-88`) ·
cards ≤12 (`:93`) · funding_rounds 5 (`:106`) · applications 15 (`:114`) ·
funding_closeout 2 (`:124`) · **funding_closeout_items ~4 (`:126`) — no
`is_demo` written** · sales 6 (`:136`) · sale_payments 6 (`:138`) ·
commission_ledger 8 (`:142`,`:145`) · invoices 6 (`:151`) · payment_links 6
(`:158`) · entitlements 6 (`:162`) · transactions 6 (`:164`) · conversations 4
(`:172`) · messages 12 (`:175`) · call_outcomes 43 (`:187`,`:191`) · shifts
(`:198`,`:211`) · staff_events (`:200`,`:227`) · inquiry_removal_cases 2
(`:236`) · inquiry_log 22 (`:241`) · contract_templates 0–1 (`:247`) ·
contracts 3 (`:253`) · **affiliate_referrals 1 (`:260`) — no `is_demo`, only
`notes='demo'`**

Then `:264` calls `seedUiCoverage` (`src/demo/seed-ui-coverage.mjs`):

entities 3 (`:19`/`:23`) · bank_accounts 3 (`:28`) · bank_transactions 18
(`:42`) · recurring_bills 3 (`:54`) · card_liabilities ≤3 (`:69`) · tasks 6
(`:98`,`:115`,`:119`) · documents 6 (`:132`,`:141`) · client_cards 3 (`:158`) ·
subscriptions 3 (`:163`) · staff_targets ≤8 (`:176`,`:181`) · events 5
(`:190`,`:196`) · hiring_job_postings 1 (`:212`) · **candidates 3
(`demo.hire.0N@demo.fundhub.local`, `:224`)** · **candidate_applications 3
(`:232`) — no `is_demo` column** · journeys 2 (`:249`,`:255`)

**Two integrity flags:**
- `platform-seed.mjs:10` and `seed-ui-coverage.mjs:7-10` — `q()` swallows
  **every** error and returns `{rows:[]}`. A failed insert is invisible and the
  endpoint still returns `ok: true`.
- `seed-ui-coverage.mjs:113-116` — `createTask(..., dedupeOn:"title")` could in
  principle match a pre-existing real task and stamp `is_demo=true` on it. Low
  risk: all six titles start with `"DEMO · "` (`:80-86`) and the fallback is
  scoped to `source_workflow='platform_demo'` (`:120`).

## 4. Does it delete or truncate? — YES, on DELETE

Same handler. `api/demo/mode.mjs:19-23` requires `confirm === "WIPE_DEMO_DATA"`
(`:7`, `:21`) then calls `wipeDemoData` (`src/demo/platform-seed.mjs:343`).

- No `TRUNCATE` anywhere.
- `:346` sets `orgs.demo_mode_enabled=false`.
- `:347` collects ids: `SELECT id FROM clients WHERE org_id=$1 AND is_demo` —
  the scope guard for everything after.
- `:350-385` — 33 `DELETE … WHERE org_id=$1 AND is_demo`.
- `:388-392` — candidates + candidate_applications.
- `:395-444` — 49 `DELETE … WHERE client_id=ANY($1)` on child tables. **These
  are NOT `is_demo`-filtered** — they trust the id list from `:347`. Safe as
  written, but only because that list is demo-only. Final client delete `:444`
  re-asserts `AND is_demo`.
- `:449-457` — staff_events, shifts, lenders, partners, affiliates,
  contract_templates, journeys, staff_targets, events.
- `:332-341` — `wipeQ` swallows only `42P01`/`42703`; other errors throw.
- `db/migrations/150_demo_wipe_allow.sql`, `151`, `152` exist so `is_demo` rows
  can delete (`:345` comment: `fundhub_app` cannot `DISABLE TRIGGER`).

The `POST` path never deletes.

## 5. Every caller of `/api/demo/mode`

**GET (read status, paint banner):**
- `public/app/shell.js:1732` — `mountDemoBanner`, owner/admin gated at `:1727`.
  Runs on every CRM screen.
- `public/app/demo-client-bootstrap.js:30` — gated at `:22`. Loaded by
  closer-dashboard, closer-call, finance-os, client-control-panel, documents.
- `public/app/hiring.html:2579` — **not role-gated**; sets `SHOW_DEMO_ROWS`.
- `public/app/ops-admin.html:1090` — Demo Mode panel, gated `:1084-1088`.
- `public/app/sample-data.html:419` — the Demo Mode screen, gated `:413-417`.

**POST (the seed trigger):**
- `public/app/sample-data.html:426` (buttons `:431-432`)
- `public/app/ops-admin.html:1104` (buttons `:1117-1127`, with a confirm naming
  the live-org write)

**DELETE (wipe):**
- `public/app/sample-data.html:437` — double confirm at `:434-435`.

**Tests:** `e2e/demo-mode.spec.mjs:9`, `:16` — route **mocked**, never hits the
real endpoint.

**Scripts / cron / workflows / seed files: none.** Grep over `scripts/`,
`src/workflows/`, `netlify/`, `e2e/` returned only the ROUTES imports and the
mocked e2e spec.

**Exported-symbol callers** (`seedPlatformDemo` / `setDemoMode` / `wipeDemoData`
/ `getDemoModeStatus`): `api/demo/mode.mjs:4` (only production caller),
`src/demo/platform-seed.pg.test.mjs:5`, `src/demo/set-demo-mode.test.mjs:3`,
`src/galaxy/company-activity.pg.test.mjs:10,47-49,74,93`.

## 6. Does any non-demo code path call it?

**Yes — five read callers, all demo-conditional, all fail soft.**

- `shell.js:1732` runs on every screen for owner/admin; only effect is the
  banner; `:1770` catches and no-ops.
- `demo-client-bootstrap.js:30` runs on five real CRM screens; returns without
  acting if not OK or Demo Mode off (`:34`).
- `hiring.html:2579` is in the **live** hiring load path, runs for every role,
  and `.catch(function(){})` swallows failure.

**No non-demo code path calls POST or DELETE.** The only write callers are the
two Demo Mode UI panels.

## 7. Auth gating — clean

`api/demo/mode.mjs:6` `const ROLES = new Set(["owner","admin"]);` ·
`:9-10` `requireAuth(req,res,{db})` → 401/503 · `:11` `requireRole(res,staff,ROLES)`
→ 403 (`src/http/read-api.mjs:159-167`) · `:12` `!staff.org_id` → 403.
Same gate for GET, POST and DELETE.

**CLAUDE.md §12 `requireAuth` roles bug is NOT present here.** The handler
passes only `{ db }` and gates separately with `requireRole`. Correct shape.

By contrast `api/dashboard/seed.mjs:23-29` uses `requireDashboardAccess` +
`hasRole(who,["admin"])` with a shared-secret (`DASHBOARD_SECRET`) fallback that
bypasses the session entirely — a weaker gate. Flagged for whoever owns it.

## 8. Can it write to the production database? — YES, nothing prevents it

- **No env guard, no `NODE_ENV` check, no allow-list, no staging-only flag** in
  `api/demo/mode.mjs`, `src/demo/platform-seed.mjs`,
  `src/demo/seed-ui-coverage.mjs`, or `src/demo/roster.mjs`.
- Uses the shared pool: `api/demo/mode.mjs:1` imports `db` from `src/db.mjs` —
  whatever `DATABASE_URL` the deployed function has.
- The route is live on the deploy target (`netlify/functions/api.mjs:498`).

**The whole guard set:** an authenticated owner/admin session, `staff.org_id`
scoping (cannot cross tenants), and the literal `WIPE_DEMO_DATA` string for the
wipe. The ops-admin confirm text says so plainly
(`public/app/ops-admin.html:1121-1123`: seeds fictional clients "into this live org").

Historical confirmation of live use: `docs/workflows/e2e-verify-run4.md:896`
records demo being flipped off on prod, clients going 18 → 5.

## 9. Tests

| File | Kind | Runs under `npm test`? |
|---|---|---|
| `src/demo/set-demo-mode.test.mjs` | unit, fake db | yes |
| `src/demo/platform-seed.pg.test.mjs` | pg — idempotency, money unchanged, wipe | yes, **skips without `DATABASE_URL`** (`:7,9`) |
| `src/galaxy/company-activity.pg.test.mjs:47-49` | pg | yes, same skip |
| `src/lenders/demo-gate.pg.test.mjs` | pg, own scratch org (`:23`) | yes, same skip |
| `src/demo/exclude-demo.test.mjs` | unit | yes |
| `src/http/routes.test.mjs` | unit — ROUTES invariant | yes |
| `e2e/demo-mode.spec.mjs` | Playwright, mocked | no (`test:e2e` only) |

**Nothing under `api/`** — `find api -name "*test*"` returns nothing, so the §12
dead-test trap does not bite. Glob rule confirmed at `scripts/run-suite.mjs:50`.

**Coverage gap:** no test asserts the handler's auth gate, method routing, or
`confirm_required` behaviour. `api/demo/mode.mjs` itself is untested.

## Direct answer: if this endpoint is deleted, what stops working for a real user?

**Nothing a real user relies on. No real-customer data flow touches it.**

On deletion:

1. **The Demo Mode screen loses its only backend** (`shell.js:135-137` says so
   explicitly). The screen is going anyway — W1's slice.
2. **The ops-admin Demo Mode panel breaks** — `public/app/ops-admin.html:1082-1127`.
   That panel is a second copy of the same controls. **Nobody claimed it.**
3. **Three page scripts get a 404 instead of JSON** — `shell.js:1732`,
   `demo-client-bootstrap.js:30`, `hiring.html:2579`. All three already handle a
   non-OK response by doing nothing. Effect: no banner, no bootstrap redirect,
   `SHOW_DEMO_ROWS` stays false. One console line per page.
4. **`e2e/demo-mode.spec.mjs` still passes** (it mocks the route) but becomes a
   test of dead code.
5. **Deleting the handler alone takes down the whole API** — see §2.
6. **Existing demo rows are orphaned, not removed.** Deleting the endpoint
   deletes the only wipe path. `wipeDemoData` becomes unreachable from the app;
   any `is_demo` rows already in production stay forever unless someone runs SQL
   by hand. **Loudest item: wipe BEFORE deleting, not after.**

Still working after deletion: every real client, sale, invoice, commission and
lender row. Money reporting already excludes `is_demo` unconditionally
(`src/demo/exclude-demo.mjs:1-3`, asserted by `platform-seed.pg.test.mjs:17,20,34`).
`POST /api/demo/simulate` and `POST /api/dashboard/seed` are unaffected.

## Ambiguities flagged, not guessed

- **"The seeding endpoint" is ambiguous — there are three.** Treated
  `POST /api/demo/mode` as the slice because it is the one behind the Demo Mode
  screen. `demo/simulate` and `dashboard/seed` have their own screens and
  callers. **Chris should say whether they are in scope.**
- `funding_closeout_items`, `affiliate_referrals`, `candidate_applications` are
  written without an `is_demo` column. The wipe reaches them through parent
  subqueries, so today they are cleaned up — but they are not independently
  identifiable as demo. A manual cleanup query must go through the parents.
- `platform-seed.pg.test.mjs` calls `wipeDemoData` on the **default org**
  (`:11-13`). Harmless against a test database; destructive of demo rows if
  `DATABASE_URL` ever points at production. Pre-existing, not new.

## Production check — query written, NOT run

The database was not queried. This read-only query would answer whether demo
rows exist in production:

    SELECT o.id AS org_id, o.demo_mode_enabled,
           (SELECT count(*) FROM clients c WHERE c.org_id=o.id AND c.is_demo) AS demo_clients,
           (SELECT count(*) FROM lenders l WHERE l.org_id=o.id AND l.is_demo) AS demo_lenders,
           (SELECT count(*) FROM sales   s WHERE s.org_id=o.id AND s.is_demo) AS demo_sales,
           (SELECT count(*) FROM clients c WHERE c.org_id=o.id
              AND c.email LIKE 'demo.client.%@demo.fundhub.local')            AS roster_clients
      FROM orgs o;

Run against production before anything is deleted. If `demo_clients > 0`, the
wipe has to happen while the endpoint still exists.
