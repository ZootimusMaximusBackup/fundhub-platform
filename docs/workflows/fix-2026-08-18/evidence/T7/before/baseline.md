# T7 test baseline — before any code change

## Where this was measured

| | |
|---|---|
| Machine | Zootimuss-MacBook-Pro.local (Darwin 25.6.0, arm64) |
| Working tree | `/tmp/wt-T7` (git worktree, branch `fix/T7-bookings-calendar-webhooks`) |
| HEAD | `d3fb2c7` — "Merge T0 — nav, reachability and page width (wave 0)." |
| Node | v22.21.1 |
| npm | 10.9.4 |
| `DATABASE_URL` | NOT set in the shell for every run below |
| Date | 2026-08-18 |

Raw output files live beside this one:
`lint.txt`, `tsc.txt`, `test-nodb.txt`, `test-nodb-pgphase.txt`, `e2e-calendar.txt`.

---

## 1. `npm run lint` — PASS

```
lint: 1295 file(s) and inline script(s) parse clean
EXIT=0
```

## 2. `npx tsc --noEmit` — CANNOT RUN (pre-existing)

Exit code 1, but not a type error. There is **no `tsconfig.json` anywhere in the repo**, so
`tsc` printed its own help text and quit. TypeScript 5.9.3 is installed. The repo contains
exactly one TypeScript file, `src/lib/rbac.ts`; everything else is `.mjs`.

So CLAUDE.md §6's second gate is unrunnable as written at this commit. This is the state
*before* T7 touches anything — it is not something T7 broke, and T7 cannot make it worse.

## 3. `npm test` WITHOUT `DATABASE_URL` — 2 FAILURES (pre-existing)

`npm test` runs `scripts/run-suite.mjs`, which runs unit files first and only starts the
pg files if the unit phase exited 0. The unit phase fails here, so **the pg phase never ran
under `npm test`**. I ran it separately to get its numbers.

### Unit phase (as run by `npm test`)

```
# tests 5640
# suites 416
# pass 5635
# fail 2
# cancelled 0
# skipped 3
# todo 0
# duration_ms 16554.9
EXIT=1
```

Both failures, in full:

1. `scripts/journeys/generate.test.mjs:146` — suite "the extraction is faithful to the code",
   subtest "these routes' gates could not be traced from the code". Actual:
   - `finance/crs-pull: a gate is referenced but its shape was not recognised`
   - `gifts/message-blaster: a gate is referenced but its shape was not recognised`

2. `src/http/read-endpoints-org-scope.test.mjs:184` — "an endpoint excused from the org filter
   still passes the session's org to its store". Actual: `company-brain-affiliate.mjs`.

Neither is in T7's area (bookings / calendar / webhooks). Treat both as the baseline.

The 3 skips in this phase:
- `default org message_channel_routing is not left on the memory provider` — SKIP no DATABASE_URL
- `non-test orgs do not route any channel to memory` — SKIP no DATABASE_URL
- `the app's database role holds no superuser-level privilege` — SKIP DATABASE_URL not set

### pg phase, run separately, still without `DATABASE_URL`

`node --test $(find src scripts -name '*.pg.test.mjs')` — 103 files:

```
# tests 640
# suites 72
# pass 50
# fail 0
# skipped 590
EXIT=0
```

**Note for CLAUDE.md §12:** that section says 442 `.pg.test.mjs` tests skip and the suite
reports 3730 passing / 0 failing. At `d3fb2c7` the real numbers are **590 skipped**, and the
suite reports **5635 passing / 2 failing** in the unit phase alone. The §12 figures are stale.

### Combined, no database

| | |
|---|---|
| Tests | 6280 |
| Pass | 5685 |
| Fail | 2 |
| Skip | 593 |

## 4. Suite WITH the live `DATABASE_URL` — NOT RUN. BLOCKER.

**I did not run this, and nobody should.**

`DATABASE_URL` in `/Users/zootimusmaximus/fundhub-platform/.env` points at
`aws-1-us-west-2.pooler.supabase.com` — the live production database.

The `.pg.test.mjs` files write to whatever database they connect to. **100 of the 103 files**
contain `INSERT INTO`, `UPDATE`, `DELETE FROM`, `TRUNCATE`, `CREATE TABLE`, `ALTER TABLE` or
`DROP`. Examples straight out of the tree:

- `src/privacy/erasure.pg.test.mjs:42` — `DELETE FROM orgs WHERE slug LIKE $1`
- `src/pii/reveal-transaction.pg.test.mjs:51-54` — deletes from `pii_access_log`,
  `pii_identity`, `clients`, then `orgs`
- `src/payments/commas-inbox.pg.test.mjs:31-33` — deletes from `commas_inbox` and `events`

They are also not all isolated. `scripts/run-suite.mjs` says so in its own header comment:
unique-org scoping is "Partial", most suites "use the shared `db` pool, commit on every query,
and open their own connections for DISABLE TRIGGER", and several suites "touch the default org".
That is why the runner serialises them when a database is present.

Several of them also need `db/migrate.mjs` to have been run first, which is itself a
schema-writing operation against the target database.

**Conclusion: running the pg suite against production would create, mutate and delete rows in
real customer data, including in `orgs` and `clients`. It is a hard no.**

To get a real with-database baseline, someone needs a throwaway Postgres. A local Postgres is
already listening on `127.0.0.1:5432` on this machine (`psql` is at `/opt/homebrew/bin/psql`),
so the path is: create an empty scratch database, run
`DATABASE_URL=postgres://…/fundhub_scratch node db/migrate.mjs`, then
`DATABASE_URL=… npm test`. I did not do that in this phase because this phase is read-only
and creating and migrating a database is a write.

## 5. How `npm test` globs — CLAUDE.md §12 confirmed CORRECT

`package.json` → `"test": "node scripts/run-suite.mjs"`. That script does:

```js
const all = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts"))];
```

`walk()` collects every `*.test.mjs` under those two directories only. So:

- Anything under `api/` **never runs** under `npm test`. Confirmed.
- Anything under `e2e/` **never runs** under `npm test`. Confirmed — and deliberate;
  `playwright.config.mjs` says so in its header ("SEPARATE FROM `npm test`").
- Endpoint coverage therefore has to live at `src/http/<name>.pg.test.mjs` and import the
  `api/` handler, exactly as §12 says.

Split rule: files ending `.pg.test.mjs` go in the second phase with
`--test-concurrency=1` when `DATABASE_URL` is set; everything else runs in parallel first.

## 6. `e2e/calendar.spec.mjs` — EXISTS, and 9 of its 11 tests FAIL at this commit

### How Playwright specs are actually run

- `npm run test:e2e` → `playwright test`, config `playwright.config.mjs`, `testDir: ./e2e`.
- `npm run test:e2e:live` → `playwright test -c playwright.live.config.mjs`.
- `npm run verify:e2e` → `scripts/run-e2e-verification.mjs`, which runs only
  `e2e/verification-roles.spec.mjs` + `e2e/verification-security.spec.mjs` and then the
  data-layer journeys. It requires `DATABASE_URL` and is not the general e2e path.
- CI: `.github/workflows/tests.yml` line 182 runs `npm run test:e2e` after
  `npx playwright install --with-deps chromium`.

No database is involved. A 40-line static server (`e2e/static-server.mjs`) serves `public/` on
port 43117, and each spec answers `/api/**` itself via `page.route()` (`e2e/harness.mjs`).

### What `e2e/calendar.spec.mjs` asserts — 11 tests, 3 groups

**"Calendar call controls" (6):** with a single task fed to `/api/tasks`, the Up Next panel's
`#unJoin` ("Join Call") and `#unFile` ("Client file") buttons are disabled when the task has no
`meeting_url` / no `client_id`, enabled when it has them, that `#unJoin` carries the meeting URL
in `data-join-url`, and that clicking `#unFile` navigates to
`client-control-panel.html?client_id=…`.

**"Calendar is today's week, not July sample" (3):** `.datelabel` shows today's real date; the
hard-coded July sample names (Priya Nair, Derek Owusu, Dana Whitlock) are gone from the week
strip; with no tasks the stat tiles read `0 / 0 / — / — / 0` and the day reads "Nothing booked.";
with two dated tasks the tiles read booked 2, done 1, left 1; the Today button returns to today.

**"Calendar Up Next / Then / briefing" (2):** clicking a `.then-row` loads that appointment into
Up Next; the "Before you dial" body `#unBody` shows the task **title**, never a raw UUID.

### Baseline result: `npx playwright test e2e/calendar.spec.mjs`

```
9 failed, 2 passed (2.8m)
EXIT=1
```

Failing:
1. `:34` Join Call enables when meeting_url is present
2. `:45` Client file enables when client_id is linked
3. `:56` Join Call stores the meeting URL on the button
4. `:68` Client file navigates to the client control panel
5. `:81` Join Call stays disabled without a meeting URL
6. `:102` date label is actual today and sample chips are gone
7. `:120` week strip counts come from dated tasks
8. `:159` clicking a Then row loads that appointment in Up Next
9. `:181` Before you dial shows the task title, never a UUID

Passing: `:22` (both buttons disabled with no link or client) and `:141` (Today button).

The shape of the failures is consistent: the page is not picking up the tasks the spec feeds it.
`#unClient` stays on "Nothing up next", `#unBody` stays on "No briefing on file.", and the
buttons that should enable stay disabled. In plain terms: **the calendar screen is not showing
the appointments it is given.** The two tests that pass are the two that expect an empty state,
which is what the screen shows no matter what.

That is T7's target defect, captured before any change.
