# W3 — Calendar + Sales Floor demo staff filter

Read-only map. Nothing deleted. Written by the main thread from the W3 agent's
return (the agent ran without write tools).

## 1. The screens

| Screen | Browser file | API route | Server logic |
|---|---|---|---|
| Calendar | `public/app/calendar.html` (fetch at `:1016`) | `GET /api/shifts?roster=1` → `netlify/functions/api.mjs:475` → `api/shifts.mjs:59-61` | `src/shifts/store.mjs:224-238` `listOpenRoster()` |
| Sales Floor | `public/app/sales-floor.html`, `public/app/sales-floor.js` (`:1`, render `:108-118`) | `GET /api/read/sales-floor` → `netlify/functions/api.mjs:435` → `api/read/sales-floor.mjs:28` | `src/sales/metrics.mjs:610-641` `closerRoster()` |

Calendar's rail is "Who's On Today" (`store.mjs:222`). Sales Floor's is the closer board.

## 2. The exact filter code

**Calendar** — `src/shifts/store.mjs:233`, one SQL line:

    AND COALESCE(s.is_demo, false) = false

**Sales Floor** — two places. SQL at `src/sales/metrics.mjs:631` (`demoClause()`),
and the real staff filter in JS at `src/sales/metrics.mjs:641`:

    for (const row of filterCloserRoster(r.rows, { demoMode })) {

which runs `src/sales/metrics.mjs:587-598` `isBlockedCloserIdentity()`:
blocks on a hardcoded name list, `/sandbox/i` on name or email, `/^test\b/i` on
name, then (only when Demo Mode is OFF) `is_demo === true`, a demo email
suffix, and `/\bdemo\b/i` on name.

`BLOCKED_CLOSER_NAMES` is six human names at `src/sales/metrics.mjs:571-578`:
jordan blake, nina castellano, marcus webb, elena voss, devon marsh,
crs sandbox smoke.

## 3. How "demo" is identified — four mechanisms, not one

1. **Column `staff.is_demo`** (boolean NOT NULL DEFAULT false) — added
   `db/migrations/094_demo_logins.sql:73`, indexed `:87`. **The only one Calendar uses.**
2. **Email domain `@demo.fundhub.local`** — constant `src/demo/roster.mjs:1`,
   tested by `isDemoEmail()` `src/auth/demo-logins.mjs:71-74`. Sales Floor only.
3. **Name regex `/\bdemo\b/i`** — `src/sales/metrics.mjs:596`. Sales Floor only.
4. **Hardcoded name list + `sandbox` + `^test`** — `src/sales/metrics.mjs:571-578, 590-592`.
   Sales Floor only. These are **not** demo checks; they are seed/test-row
   suppression riding in the same function.

Separate switch: **`orgs.demo_mode_enabled`** (`src/demo/exclude-demo.mjs:4-8`).

## 4. Where the filter runs

- **Calendar: in the SQL, on the server** (`src/shifts/store.mjs:233`). Nothing
  filters in `api/shifts.mjs`; the browser renders every row it gets
  (`calendar.html:1019-1036`).
- **Sales Floor: in JavaScript, after the SQL returns** (`src/sales/metrics.mjs:641`).
  The SQL at `:633-635` restricts only by org, `status='active'`, `role='closer'`.
  Demo rows come back from the database and are dropped in JS.
  `public/app/sales-floor.js` does no filtering.

## 5. Same helper, or two copies? — TWO COPIES, AND THEY DISAGREE

Calendar imports nothing from `src/sales/metrics.mjs` (`api/shifts.mjs:35`
imports only `src/shifts/store.mjs`). `filterCloserRoster` /
`isBlockedCloserIdentity` / `belongsOnCloserBoard` appear only in
`src/sales/metrics.mjs` and its test.

Three real divergences:

- **Calendar ignores Demo Mode.** `listOpenRoster` never reads
  `orgs.demo_mode_enabled`; Sales Floor does (`src/sales/metrics.mjs:611`).
  Turn Demo Mode ON and demo closers show on Sales Floor but never on the
  Calendar rail. The demo walkthrough is already broken on Calendar today.
- **The parity test is wrong.** `src/shifts/store.test.mjs:163` is named
  "listOpenRoster excludes demo staff the same way sales-floor does" but only
  asserts the SQL contains the `COALESCE` line. Sales Floor does not do it that
  way at all.
- **`demoClause()` at `metrics.mjs:631` is not a staff filter.** It sits inside
  the `call_outcomes` LATERAL (`:624-632`), is called with no arguments, and so
  always excludes demo call outcomes even when Demo Mode is ON. Net effect: in
  Demo Mode, demo closers appear with $0 cash, 0 held, 0 deposits — the seeded
  numbers at `src/demo/platform-seed.mjs:187-191` get filtered out from under them.

## 6. What shows if the filter is removed

**Calendar** — remove `store.mjs:233` and the rail shows demo staff only where a
demo staff row has an **open shift** (`sh.ended_at IS NULL`, `:232`). Migrations
094/112 create no shifts. `src/demo/platform-seed.mjs:205-217` does — a
90-minute open shift for every demo staff member across seven roles. So on a
database where the seed has been run, a real user sees up to seven rows reading
"DEMO Owner", "DEMO Closer", "DEMO Setter" and so on. On a database that never
ran the seed, nothing changes.

**Sales Floor** — remove the `filterCloserRoster` call at `metrics.mjs:641` and
**"DEMO Closer" appears on the closer board with no seeding required.**
`db/migrations/094_demo_logins.sql:127-136` inserts it with `role='closer'`,
`status='active'` — exactly what the SQL selects. The migration alone is enough.
Removing the whole call also un-hides the six blocked names and anything
matching `sandbox` / `^test`.

**Yes — demo staff would appear to a real user on both screens.** Sales Floor is
the more exposed: it needs no seed run.

## 7. Could a real staff member be wrongly hidden?

**Calendar: no.** Column check only; real rows default to `is_demo = false`.

**Sales Floor: yes.**

- **`BLOCKED_CLOSER_NAMES` (`metrics.mjs:571-578`) is six ordinary human names
  with no demo marker.** The test at `src/sales/metrics.test.mjs:28-33` passes
  them with `is_demo: false` and real `@fundhub.ai` addresses. Hire a real
  closer named Marcus Webb, Elena Voss, Nina Castellano, Jordan Blake or Devon
  Marsh and they are silently missing from the Sales Floor board forever, with
  no message. **Sharpest over-broad match.** Where those six rows are created in
  `staff` could not be found — `db/migrations/037_agent_registry.sql:135,137`
  uses two of the names as agent-registry display names, not staff. UNVERIFIED.
- `/sandbox/i` on email matches `j.sandbox@fundhub.ai`.
- `/^test\b/i` on name matches any name starting "Test".
- `/\bdemo\b/i` is word-boundary, so "Demopoulos" is safe.
- `isDemoEmail` is a strict `.local` suffix match — safe.
- Separate but same function: `belongsOnCloserBoard` (`:601`) drops
  `role === 'owner'` unconditionally, while `OWNER_SET_CLOSER` at `:566-569`
  declares Chris the closer. `isOwnerSetCloser` (`:580`) is exported and tested
  but **never called from production code**. `metrics.test.mjs:49` locks the
  current behavior in. Chris does not appear on his own closer board. Reported,
  not fixed.

## 8. Tests

All six run under `npm test`:

| Test | Path:line |
|---|---|
| blocked closer identities: seed, demo, sandbox, test — never Chris | `src/sales/metrics.test.mjs:26-43` |
| closer board excludes owners; keeps a real closer | `src/sales/metrics.test.mjs:45-52` |
| filterCloserRoster drops demo names and owners… | `src/sales/metrics.test.mjs:54-68` |
| DEMO closers show only when Demo Mode is on | `src/sales/metrics.test.mjs:70-74` |
| closerRoster SQL is closers only, never DELETEs… | `src/sales/metrics.test.mjs:76+` |
| listOpenRoster excludes demo staff the same way sales-floor does | `src/shifts/store.test.mjs:163-169` |

`find api -name "*test*"` returns nothing, so the `api/` dead-test trap does not
apply here. Suite glob confirmed at `scripts/run-suite.mjs:50` (walks `src` and
`scripts` only).

**Coverage gap:** `e2e/demo-mode.spec.mjs:5` covers `/app/sales-floor.html` but
only asserts the demo *banner* is visible (`:10`) — never that a demo closer is
absent from the board. `/app/calendar.html` is not in that list at all.
`e2e/calendar.spec.mjs` has zero demo/roster/coverage mentions. **No end-to-end
test proves either screen actually hides demo staff.**

## 9. Where the demo staff rows come from — MIGRATIONS, NOT THE ENDPOINT

- `db/migrations/094_demo_logins.sql:127-139` inserts six staff (owner, admin,
  funding_advisor, closer, inquiry_specialist, setter) with `is_demo = true`.
- `db/migrations/112_sales_manager_role.sql:87-92` adds a seventh, DEMO Sales Manager.

`src/demo/platform-seed.mjs:31-32` **reads** those rows and throws
`demo_seed_requires_demo_staff` if absent — it never creates them. What the seed
endpoint creates for these two screens is the demo staff's **shifts**
(`platform-seed.mjs:196-217`) and **call outcomes** (`:187-191`).

**Cross-workflow consequence:** deleting the demo seeding endpoint does **not**
remove the demo staff rows. They come from already-applied migrations, and per
CLAUDE.md §12 editing an applied migration is a silent no-op. Removing them
needs a new migration.

## Journey check — gap found

Read `docs/journeys/role-sales-manager-intended.md` (86 lines) and
`docs/journeys/role-owner-intended.md` (74 lines) in full.

**Neither mentions the demo staff filter, the closer board, the Calendar
coverage rail, demo staff, `is_demo`, or Demo Mode.** One grep hit across both:
`role-sales-manager-intended.md:19`, a passing reference to the sales_manager
demo *login*, not to any filter.

Both files are route-reachability lists only. Both carry a banner (`:3-15`)
saying they were generated from extracted route data on 2026-08-02, not from a
product spec.

**The gap:** the code does row-level identity suppression on two screens —
including a hardcoded six-name blocklist that can hide real employees — and no
intended journey describes, authorizes, or mentions it. Reported as a finding,
not reconciled.

## Direct answer

- **Sales Floor** — "DEMO Closer" appears on the closer board immediately, on
  any database that ran migration 094. Six more names appear if those rows exist
  in `staff` (UNVERIFIED).
- **Calendar** — up to seven "DEMO …" rows in the Who's On Today rail, but only
  if someone ran the demo seed. Otherwise identical.

Sales Floor breaks at once; Calendar breaks only on seeded databases.

## Flags

1. Two copies of the logic that disagree — already affects Demo Mode on Calendar.
2. `BLOCKED_CLOSER_NAMES` can hide real employees. Origin of those six rows UNVERIFIED.
3. `isOwnerSetCloser` is exported, tested, never called.
4. `demoClause()` filters call outcomes, not staff, and ignores Demo Mode.
5. Demo staff rows survive deletion of the seed endpoint — migrations 094 and 112.
