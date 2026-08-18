# Demo Mode removal — 2026-08-17

Chris asked: delete the Demo Mode screen and take it out of the nav.

He also said: tell me everything that depends on demo mode first, and do not
remove anything the app depends on without telling me.

So Phase 1 is a read-only map. Nothing gets deleted until Chris reads it and
says what goes.

## Rules for every workflow on this board

- READ ONLY in Phase 1. Write nothing except your section of this file.
- Do not delete anything. Not code, not data, not tests.
- Plain language, 5th grade reading level. No status codes in the sentences.
- If you find something the app depends on, say so loudly.

## Task list

| # | Owner | Task | Status |
|---|-------|------|--------|
| W1 | Fixer (main thread) | Demo Mode screen, nav entry, route | done |
| W2 | agent | Seeding endpoint | done |
| W3 | agent | Calendar + Sales Floor demo staff filter | done |
| W4 | agent | Hiring demo candidates + every other demo mention | done |

## Shared context brief

Known from Chris, not yet verified in code:
- There is a Demo Mode screen with a nav entry.
- There is a seeding endpoint behind it.
- Calendar and Sales Floor filter out demo staff.
- Hiring shows demo candidates.

Repo traps that matter here (CLAUDE.md §12):
- A handler file is not a route. `netlify/functions/api.mjs` holds a hardcoded
  ROUTES map. Deleting a handler without touching that map, or the reverse,
  has already shipped bugs twice. `src/http/routes.test.mjs` guards this.
- `npm test` only globs `src/**` and `scripts/**`. A test under `api/` never runs.
- Editing an already-applied migration is a silent no-op.

## Findings

Full detail per workflow in
`docs/workflows/demo-mode-removal-2026-08-17-evidence/`:
`W1-screen-nav-route.md`, `W2-seeding-endpoint.md`,
`W3-calendar-salesfloor-filter.md`, `W4-hiring-and-sweep.md`.

### The headline

**What Chris named is safely deletable. Everything else he listed is not.**

| Thing Chris listed | Verdict |
|---|---|
| The Demo Mode screen (`public/app/sample-data.html`) | **Safe to delete** |
| Its nav entry | **Safe to delete** — 36 copies, one sync script |
| The seeding endpoint (`/api/demo/mode`) | **KEEP** — 4 other screens read it, and it is the only wipe path |
| Demo staff filter on Calendar + Sales Floor | **KEEP** — it is protection, not demo plumbing |
| Demo candidates on Hiring | **KEEP the filter** — already hidden by default; nothing to remove |

### Why the seeding endpoint must stay

There is no separate seed endpoint. `POST /api/demo/mode {enabled:true}` seeds as
a side effect (`api/demo/mode.mjs:17` → `platform-seed.mjs:300`). The same route
also wipes on `DELETE` with `confirm=WIPE_DEMO_DATA` (`api/demo/mode.mjs:19-23`).

Four other UIs read it and are not the Demo Mode screen:
`public/app/hiring.html:2579` · `public/app/shell.js:1732` ·
`public/app/ops-admin.html:1090` · `public/app/demo-client-bootstrap.js:30`.

**Deleting it deletes the only wipe path.** Any `is_demo` rows already in
production become unreachable from the app — removable only by hand-written SQL.

**Whole-site trap:** `netlify/functions/api.mjs:131` is a static top-level
import. Deleting `api/demo/mode.mjs` without also removing line 131 and line 498
breaks the module and takes down **every** `/api/*` route.

### Why the Calendar / Sales Floor filter must stay

The demo staff rows are **not** created by Demo Mode. They come from applied
migrations `094_demo_logins.sql:127-139` and `112_sales_manager_role.sql:87-92`.
They are in the database regardless of the toggle.

- Remove the Sales Floor filter (`src/sales/metrics.mjs:641`) and **"DEMO Closer"
  appears on the real closer board immediately.** No seeding required.
- Remove the Calendar filter (`src/shifts/store.mjs:233`) and up to seven
  "DEMO …" rows appear in Who's On Today — but only on a seeded database.

### Why Hiring needs no change

Demo candidates are already hidden unless Demo Mode is ON (`hiring.html:1726,
1730, 1829`) and are **excluded from every number regardless** (`:1634-1654`).
Deleting the Demo Mode screen changes none of it.

### The one thing that is genuinely lost

**The Wipe button exists only on the Demo Mode screen** (`sample-data.html:437`).
Ops & Admin's duplicate panel has ON and OFF only (`ops-admin.html:1117-1127`).
Delete the screen and the app has no way to remove demo data.

**UNVERIFIED: whether production holds demo rows right now.** Reading `.env` was
denied in this session, so no query was run. The read-only query is at the end of
`W2-seeding-endpoint.md`.

### Dead links the deletion creates

1. `public/app/ops-admin.html:356` — "Open Demo Mode screen →"
2. `public/app/shell.js:1759` — the orange banner's "Manage demo data" link
3. `public/app/galaxy.html:1793,1821` — empty-state copy naming "Admin → Demo Mode"

### Three separate things also called "demo" — DO NOT SWEEP UP

- **`/api/demo/simulate`** — the Finance OS "Load simulated data" button
  (`finance-os.html:1003,1027`) plus the funding verification journey.
- **Demo LOGINS** — the login-page role switcher (`src/auth/demo-roster.mjs`).
  Guarded by `scripts/journeys/generate.test.mjs:262-268`, which hard-fails if
  that file stops existing.
- **Offline `fh_demo`** — the localStorage fallback in `public/fh.js:7-209`.

### `is_demo` is load-bearing

Twenty production readers use it to keep fake money out of real totals, including
`src/lenders/match.mjs:132` (refuses demo lenders for real clients) and
`src/calculators/deal-funding.mjs`. `src/demo/exclude-demo.mjs` is imported by
8 production modules. **Not deletable with the screen.**

### Out-of-scope findings, written down, not fixed

1. `src/sales/metrics.mjs:571-578` hides six people by name — jordan blake, nina
   castellano, marcus webb, elena voss, devon marsh, crs sandbox smoke — with no
   demo marker. A real hire with one of those names never appears on Sales Floor.
2. Calendar and Sales Floor use two different filters. `src/shifts/store.test.mjs:163`
   is titled "…the same way sales-floor does" and asserts a parity that does not exist.
3. `demoClause()` (`src/sales/metrics.mjs:631`) ignores Demo Mode, so demo closers
   show with $0 when the toggle is on.
4. `isOwnerSetCloser` (`src/sales/metrics.mjs:580`) is exported, tested, never called.
5. `src/retention/classes.mjs:45` claims "THERE IS NO is_demo COLUMN ANYWHERE IN
   THIS SCHEMA". That is false — it is on 40+ tables.
6. `api/hiring/candidates.mjs:42-43` never returns `is_demo`; the screen matches
   on a name prefix instead.
7. `api/dashboard/seed.mjs:23-29` has a shared-secret fallback that bypasses the session.

## Blockers and open questions

**BLOCKED ON CHRIS — one question:** deleting the screen removes the only Wipe
button. Decide what happens to the ON/OFF/Wipe controls before any deletion.

**UNVERIFIED:** does production hold demo rows? `.env` read was denied.

## Change manifests

_Nothing written yet. Phase 2 has not started._
