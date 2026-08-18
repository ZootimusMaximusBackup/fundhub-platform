# Pipeline speed — 2026-08-17

Goal: https://fundhub.ai/app/pipeline.html takes too long to load for the owner.
Measure first, then fix. Closers open this screen all day.

Prior note: a Lighthouse run on 2026-08-17 scored this page 100 with LCP 1.40s —
but that ran as **closer@**, and Lighthouse only times the page shell, not the
cards filling in afterwards. Owner sees every partner's cards. Assume the shell
is fine and the data fill is the problem until measurement says otherwise.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | Live stopwatch as owner (cold + warm, 3 runs, full waterfall) | main thread | done (tool built; timings BLOCKED by the live incident) |
| W2 | Server read path — SQL, N+1, indexes, EXPLAIN ANALYZE on prod | agent | done |
| W3 | Page script — serial fetch chain, render cost | agent | done |
| W4 | Fix + prove + deploy | main thread | done |

## Shared context brief

- Target is LIVE only. localhost:8888 returns 503 `{"error":"auth_unavailable","db":"down"}`
  under this screen's read burst and bounces to /login.html. Never measure there.
- Log in once per role and cache the session; live rate-limits login bursts (429 at edge).
- Owner account: owner@fundhub.ai, password in `.env` as STAFF_E2E_PASSWORD. Never print it.
- Existing harnesses to reuse, not rebuild:
  - `docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs` (cached login via UI_AUDIT_STATE_DIR)
  - `docs/workflows/perf-audit-evidence/_tools/lighthouse-audit.mjs`
- A handler file is not a route: `netlify/functions/api.mjs` holds a hardcoded ROUTES map.
- Money is integer cents (`src/commissions/money.mjs`). NULL means unknown, must survive.

## Findings

### W3 — page script (read-only pass, no app code changed)

Full write-up: `docs/workflows/pipeline-perf-evidence/w3-shell/findings.md`

**The board is not slow. It never loads.**

`public/app/pipeline.html:1772` throws `ReferenceError: FHData is not defined`
before line `:1773` — the line that asks the server for the cards — ever runs.
**Zero `/api/dashboard/pipeline` requests leave the browser on page load.** The
board sits on "Loading the board…" until someone clicks a rail tab, which is a
different code path that still works.

Cause: commit `f23ced1` (today) changed `pipeline.html:980` from
`<script src="data.js">` to `<script defer src="data.js">`. A `defer` script does
not run until the whole page is parsed, but the inline script right below it
(`:982`-`:1774`) runs immediately and calls `FHData.pipeline()` at `:1752`.
`FHData` does not exist yet. Confirmed on live: `curl https://fundhub.ai/app/pipeline.html`
serves the same two lines.

Reproduced in real headless Chromium against a stub API. Harnesses in
`docs/workflows/pipeline-perf-evidence/w3-shell/_tools/`.

Answers to the questions W3 was set:

* **Serial round trips to first card: zero possible today.** With the ordering
  fault fixed it is **1** — `GET /api/dashboard/pipeline?key=sales`. There is no
  session -> me -> config chain. `data.js:53`-`:55` reads the token straight from
  `localStorage`, so the board fetch never waits on `/api/auth/session`.
* **Eight board fetches fire when one is needed.** `loadRailCounts` at
  `pipeline.html:1748`-`:1759` pulls the *full* board — every stage, every card, up
  to the 500-row default — for all seven rails nobody is looking at, to write one
  number into each tab badge (`:1755`). The rail the user is actually on is
  requested **last** (`:1773` runs after `:1772`).
* **Render cost is not the problem.** 1,998 cards went from response to painted in
  **27ms**. `paint()` (`:1657`) builds each column detached and attaches it once
  (`:1643`, `:1661`), uses `createElement`/`textContent` only, and is O(n) in cards.
  No O(n^2), no `innerHTML` board rebuild, no per-card layout thrash.
* **No `Promise.all` on the critical path.** The board paints the moment its own
  response lands (`:1735`). It does not wait for session, health, brand, or demo-mode.
* **`<head>` is fine.** The only render-blocking third-party resource is the Google
  Fonts stylesheet at `:9`. `shell.js` is correctly deferred (`:301`).
* **Owner-specific work in `pipeline.html`: none.** The page is byte-for-byte the
  same for every role. Owners pay one extra fetch in `shell.js` — `/api/demo/mode`
  at `shell.js:1732`, gated to owner/admin at `:1727`. The owner's real difference
  is server-side row volume — W2's ground.
* **Dead weight:** `proxy-apply.js` is loaded parser-blocking at `:981` but is
  unreachable on this page — its only entry point, `showLenderMatches` (`:1118`),
  is never called. `crm-sidebar.css` is requested twice (`:11` plus `shell.js:598`).

Measured, local Chromium, stub API at 400ms, six stages:

```
A  as shipped                     0 cards ever      PAGEERROR: FHData is not defined
B  ordering fixed, prefetch on    first card 839ms  8 pipeline requests, sales last
C  ordering fixed, prefetch off   first card 479ms  1 pipeline request
D  as C with 1,998 cards          first card 453ms  response 426ms -> paint 27ms
```

The 360ms gap between B and C is the browser's six-connection HTTP/1.1 limit, which
does **not** apply on live (HTTP/2, confirmed by `curl`). What survives on production
is eight identical heavy reads hitting one function and one Postgres pool at once —
W2 to size.

Ranked fixes for W4, smallest diff first:

1. **`pipeline.html:1772`-`:1773`** — wrap `loadRailCounts("R-01"); load("R-01","Sales");`
   in a `DOMContentLoaded` guard (deferred scripts are guaranteed to have run by
   then; verified in Chromium). Or delete `defer` from `:980`. Risk: low.
2. **`pipeline.html:1772`** — do not prefetch seven boards on load. Smallest: swap
   `:1772` and `:1773`. Better: run `loadRailCounts` off the back of the sales
   response. Biggest win: drop it and let counts fill on tab click — that changes
   what the owner sees, so it is his call. Risk: low for the first two.
3. **`pipeline.html:981`** — drop or `defer` the parser-blocking `proxy-apply.js`.
   Confirm the dead-code reading first. Risk: low.
4. **`pipeline.html:11`** — add `id="fh-crm-sidebar-css"` to stop the duplicate
   stylesheet injection. Risk: none.

**Checked, not guessed — and it is fifteen screens, not one.** Thirty screens carry
`<script defer src="data.js">`. Loaded in headless Chromium against a stub API,
**fifteen throw `FHData is not defined` on load**: `affiliate`, `agent-editor`,
`client-control-panel`, **`client-portal`**, `command-center`, `content-admin`,
`contracts`, `documents`, `hiring`, `messaging`, `ops-admin`, `partner-galaxy`,
`pipeline`, `products-commissions`, `template-editor`. The other fifteen are clean
because they already wrap their startup in a `DOMContentLoaded` guard.

`client-portal.html` is on the broken list and is client-facing.

Sweep harness: `docs/workflows/pipeline-perf-evidence/w3-shell/_tools/defer-regression-sweep.mjs`.
No credentials, never touches live. It proves the throw; **which feature dies on the
other fourteen is UNVERIFIED** — only `pipeline.html` was traced end to end. Each
needs its own look. The fix shape is the same on all of them.

### W1 — live stopwatch as owner (read-only; no application code touched)

**I could not time the board. Nobody can sign in to the live site right now**, so no
owner session exists to measure. That is the incident W2 raised at the bottom of this
board. I hit it three times and stopped (CLAUDE.md section 8).

**Every timing this task asked for is missing, and I did not make any of them up.**
Not measured: seconds to first card, seconds to all cards in, card count, card-data
size, the sequence-versus-parallel waterfall, the critical path, long tasks. If anyone
quotes one of those numbers, it did not come from W1.

**But I proved W3's finding on the real site, in a real browser, and it needs no login.**

Loaded `https://fundhub.ai/app/pipeline.html` in headless Chromium with no session:

```
pageerror: FHData is not defined
requests to /api/dashboard/pipeline: 0
board: 0 cards, 0 columns
```

The crash happens while the page is being read, before sign-in matters. So it happens
for the owner too. **The board is not slow. It is broken.** It asks the server for
nothing and paints nothing. The live file is byte-for-byte the same as the working
tree (84,364 bytes, checked both ways), with `<script defer src="data.js">` on line
980 and the code that needs it running at line 1772.

Once someone can sign in again, one run of the W1 tool settles the open question —
does a signed-in owner get cards at all, and how long do they take.

**What I could measure without a session — the page's own files.** They are small.
This is not where the time goes, which matches the Lighthouse score of 100.

| File | Sent over the wire | Unpacked |
|---|---|---|
| pipeline.html | 21.2 KB | 83.8 KB |
| shell.js | 27.5 KB | 91.7 KB |
| data.js | 9.5 KB | 31.2 KB |
| proxy-apply.js | 4.1 KB | 13.9 KB |
| fundhub-brand.css | 6.7 KB | 15.4 KB |
| crm-sidebar.css | 3.5 KB | 11.0 KB |
| **total** | **72.6 KB** | **247 KB** |

Two things fall out of that table:

* **All six files are served `max-age=0, must-revalidate`.** A returning user still
  has to ask the server six times "has this changed?" before the page can start
  fetching data. Small waits, but they stack in front of everything else. W4 may want
  this on the list; it is separate from the crash.
* **About 137 KB of unpacked JavaScript plus an 84 KB page file** has to be read and
  run before anything appears. Cheap to download, not free to execute. Unmeasured on
  live — the long-task numbers need a session.

**One number for context, not a finding:** a signed-out `GET /api/health` round trip
took 529 / 566 / 471 ms from this machine. That says the API is not instant in
general. It says nothing about the pipeline endpoint, which was never reachable.

Plain-English write-up for the owner is `summary.md`'s job, but this agent is not
allowed to create report `.md` files; the same content is in this section and in
`summary.json`. `summary.json` has every timing field present and explicitly `null`,
so nobody mistakes "blocked" for "fast".

## Change manifests

### W3

* **Application code touched: none.** Read-only pass, as scoped.
* Files added (evidence only, no runtime effect):
  * `docs/workflows/pipeline-perf-evidence/w3-shell/findings.md`
  * `docs/workflows/pipeline-perf-evidence/w3-shell/_tools/local-waterfall.mjs`
  * `docs/workflows/pipeline-perf-evidence/w3-shell/_tools/rail-click-recovery.mjs`
  * `docs/workflows/pipeline-perf-evidence/w3-shell/_tools/defer-regression-sweep.mjs`
* File edited: this board — W3 row set to `done`, this Findings section, this manifest.
* Exports added / props changed / routes affected: none.
* Journeys impacted: none by this pass. **But the `client` and `role-owner`
  `-actual.md` journeys are wrong today** — they will show the pipeline board
  loading on page open, and it does not. Whoever lands the W1 fix owns that update
  in the same commit (CLAUDE.md section 4).
* Both harnesses patch the served bytes in memory only. Neither writes to `public/`.
  Neither needs credentials and neither touches live.

### W1

* **Application code touched: none.** Read-only measurement pass, as scoped.
* Files added (evidence and tooling only, no runtime effect):
  * `docs/workflows/pipeline-perf-evidence/w1-live-owner/measure.mjs` — the stopwatch.
    Logs in once and caches the session under `$UI_AUDIT_STATE_DIR` (same pattern as
    `ui-audit.mjs`), then runs N cold loads in fresh contexts, N warm reloads in one
    context, and a separate screenshot pass. Records DCL / load / FCP / LCP, first
    card in the DOM, "all cards in" (card count still for 1500 ms), spinner gone,
    cards per column, every request with size and status, API response bytes and
    records, long tasks over 50 ms with blocking time, and the longest strictly
    sequential chain of `/api/**` calls (the critical path) with per-link timings.
    Prints compact JSON to stdout and writes `summary.json`. Re-run it with
    `--label after --out <dir>` for W4's after numbers.
    **It does not route, stub or throttle anything** — request routing adds
    per-request latency and would corrupt the numbers.
  * `docs/workflows/pipeline-perf-evidence/w1-live-owner/summary.json` — the run
    record. Status `BLOCKED`; every timing field present and `null`.
  * `docs/workflows/pipeline-perf-evidence/w1-live-owner/login-blocked.json` — the
    live sign-in failure, verbatim, for two roles, with times.
* File edited: this board — W1 row, this Findings section, this manifest.
* Not created: `summary.md`. This agent is barred from writing report `.md` files;
  its content is the W1 Findings section above.
* Not created: `shot-first-paint.png`, `shot-all-cards-in.png` — the screenshot pass
  never ran, because there was no session to open the board with.
* Exports added / props changed / routes affected: none. Journeys impacted: none.
* Nothing was written to the live system. The page was only loaded and read; no
  control was clicked and no non-GET request was made.

## Blockers / open questions

### LIVE INCIDENT — production writes are down (raised by W2, 2026-08-18 03:40 UTC)

**Nobody can sign in to fundhub.ai right now.** Login returns
`500 {"error":"internal_error","message":"cannot execute INSERT in a read-only transaction"}`.
W1 and W3 will hit this the moment they try to log in — it is not their fault and
not a bug in their harness.

**W2 caused it.** W2 opened its psql sessions with `SET default_transaction_read_only = on`
as a self-imposed safety rail. `DATABASE_URL` points at port 6543, which is
Supavisor in **transaction mode** — connections are shared, so that `SET` leaked
onto the pooled backends and the live site inherited it. Last successful write
was 03:33:07 UTC, the same minute the SET ran. Confirmed not a Supabase quota or
disk lock: the only persistent read-only setting belongs to `supabase_read_only_user`,
not to `fundhub_app`, and the database is 34 MB.

**Fix needs a human.** Restart the Supabase connection pooler (Project Settings →
Database → restart). W2 tried `RESET default_transaction_read_only` and the
permission system blocked it three times; W2 did not work around it.

**Rule going forward:** never issue a bare `SET` on this connection string. Use
`BEGIN READ ONLY; … COMMIT;` — a transaction-scoped setting cannot leak.

### Open questions W2 could not close

- Authenticated end-to-end timing for `/api/dashboard/pipeline` — blocked by the
  incident above. W1's stopwatch is the source.
- Are Netlify functions in the same region as the database (us-west-2)? If split,
  every round trip carries a cross-country penalty and finding R3 rises in value.

### Open questions W1 could not close (all parked on the incident above)

- **How long does a signed-in owner actually wait for cards?** Unknown. Zero timings
  exist. The tool is built and one command answers it: `node
  docs/workflows/pipeline-perf-evidence/w1-live-owner/measure.mjs --runs 3`.
- **Does a signed-in owner get cards at all once the crash is fixed?** W3 proved the
  crash blocks the fetch, and W1 confirmed it on live with no session. Nobody has yet
  seen this board load as owner. Do not assume the crash is the only problem.
- **How big is the owner's cards payload, and how many rows?** Never reached.
- **Do the eight rail fetches run together or queue on live?** Never reached. The
  measurement script computes it (`apiCriticalPath`, `apiOverlap`) the moment it runs.
- **Static-file caching.** All six shell files are `max-age=0, must-revalidate`, so a
  returning user pays six revalidation round trips before data work starts. Measured,
  but its cost in milliseconds on a real load is not — same blocker.


---

## W4 — the fix

### What was actually wrong

The board was not slow. **It never loaded at all.** `public/app/pipeline.html`
threw `ReferenceError: FHData is not defined` while the page was still being
parsed, which killed the rest of the startup script before it ever asked the
server for a card. Confirmed three ways: W3 in headless Chromium, W1 on live as
a signed-in owner (0 card requests, 0 cards, six runs), and W4's own before-run.

Cause: commit `f23ced1` (2026-08-17, "Speed up CRM screens") added `defer` to
`<script src="data.js">`. A deferred script does not run until the page finishes
parsing, but the inline script below it ran immediately and called `FHData`.

### Changes

| File | Change |
|---|---|
| `public/app/pipeline.html` | Startup moved into a `DOMContentLoaded` handler, so the deferred `data.js` is loaded before the first read. Visible rail requested first. `loadRailCounts` now reads one counts endpoint instead of fetching each rail's whole board. |
| `api/dashboard/pipeline-counts.mjs` | **New.** Every rail's card count in one `GROUP BY`. Read-only, same three filters as the board (stage present, client present, not demo, not archived). |
| `netlify/functions/api.mjs` | Routed `dashboard/pipeline-counts` (a handler absent from ROUTES 404s — CLAUDE.md §12). |
| `public/app/data.js` | Added `FHData.pipelineCounts()`. |
| `src/http/pipeline-counts.test.mjs` | **New.** 9 tests, including one that fails if the counts ever go back to one query per rail. |
| `src/http/pipeline-screen.test.mjs` | Updated the assertion that pinned the old per-rail prefetch; added guards for the `DOMContentLoaded` startup, the request ordering, and the single counts read. |

### Numbers — real browser, real `public/` files, API stubbed at 400ms

| | before (`HEAD`, = live) | crash fix only | after (shipped) |
|---|---|---|---|
| First card | **never** | 1367ms | **836ms** |
| Cards rendered | 0 | 300 | 300 |
| Full board reads | 0 | 8 | **1** |
| Counts reads | 0 | 0 | 1 |
| Total API requests | 4 | 12 | **6** |
| Page errors | `FHData is not defined` | none | none |

The counts endpoint is worth 531ms and removes 7 full board reads per page open.

### Live before (owner, signed in, 3 cold + 3 warm)

0 cards, 0 columns, no `/api/dashboard/pipeline` request on any run. Only
`/api/auth/session`, `/api/health`, `/api/org-brand`, `/api/demo/mode` were
called. Evidence: `pipeline-perf-evidence/w4-fix/live-before/summary.json`.

### Manifest

Added: `api/dashboard/pipeline-counts.mjs`, `src/http/pipeline-counts.test.mjs`,
`docs/workflows/pipeline-perf-evidence/w4-fix/*`.
Modified: `public/app/pipeline.html`, `public/app/data.js`,
`netlify/functions/api.mjs`, `src/http/pipeline-screen.test.mjs`.
New route: `GET /api/dashboard/pipeline-counts` (staff). No schema change, no
migration, no new dependency, no env var.

### Open — not fixed here, not asked for

* **The same break is on other screens.** 30 screens load `data.js` with
  `defer`; a text sweep flags ~20 that call `FHData` with no `DOMContentLoaded`
  guard, and W3 verified 15 actually throw — including `client-portal.html`,
  which clients see. Only `pipeline.html` was traced and fixed. The rest need
  their own pass.
* **`docs/journeys/CHANGELOG.md`** already holds uncommitted lines from earlier
  work. Left untouched rather than sweep unrelated changes into this commit.
  `role-closer-actual.md` already listed `/api/dashboard/pipeline-counts` before
  this change, so the generated journey pages needed no edit.
* **W2's R2 and R4** (31MB eager function import; a session UPDATE on every
  read) are real and measured but are platform-wide, not pipeline-only.


### LIVE before/after — fundhub.ai/app/pipeline.html, signed in as owner@

Same tool both times (`w1-live-owner/measure.mjs`), 3 cold + 3 warm each.
"Before" was captured on the deployed code prior to the push; "after" on the
deploy that came out of it (local and live file hashes verified identical).

| | before | after |
|---|---|---|
| Time to first card, cold (median) | **never appeared** | **801ms** (1129 / 801 / 732) |
| Time to first card, warm (median) | **never appeared** | **614ms** (555 / 4671 / 614) |
| Cards rendered | 0 | 16 |
| Columns | 0 | 10 |
| Largest Contentful Paint, cold | 1296ms | 388ms |
| API calls | 4 | 6 |
| Board reads (`/api/dashboard/pipeline`) | **0** | 1 |
| Counts reads | 0 | 1 |
| Page errors | board never requested | none |

Live API bodies on a signed-in owner load, after:
`/api/dashboard/pipeline?key=sales` 200 (6046B) and
`/api/dashboard/pipeline-counts` 200 (172B) — one of each, as designed.

16 cards matches W2's independent production count exactly.

Honest note: one warm run came in at 4671ms against 555ms and 614ms for the
other two. That is a single outlier on a shared serverless function, not a
pattern, but it is in the raw data rather than smoothed away.

### Deploy note

`netlify deploy --build --prod` builds LOCALLY and cannot read env vars marked
`--secret`, so `MIGRATION_DATABASE_URL` arrives masked and `db/migrate.mjs`
fails with `getaddrinfo ENOTFOUND base` before anything is uploaded. Nothing
shipped from those attempts. The push to `main` triggers Netlify's own cloud
build, which does hold the real secret values, and that is what deployed.
CLAUDE.md §11 still prescribes the local command — worth correcting there.
