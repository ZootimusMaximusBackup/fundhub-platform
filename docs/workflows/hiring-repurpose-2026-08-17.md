# Hiring — repurpose 2026-08-17

Owner ask: "Hiring is a jumbled mess. Repurpose it. It's supposed to integrate
with LinkedIn but it's unclear how that works — tell me what's actually wired
and what isn't before you change anything. Strip the developer documentation
from the page body. Make it a screen a person can use."

Standing GO. No invented data.

## Tasks

| # | Unit | Owner | Status |
|---|---|---|---|
| 1 | LinkedIn wiring truth (read-only trace) | fixer | done |
| 2 | Page body rewrite — `public/app/hiring.html` | fixer | done |
| 3 | Live data + endpoint check | fixer | done |
| 4 | Journeys + board | fixer | done — no journey change needed |
| 5 | Prove: lint, tests, capture, deploy | fixer | done |

## Ground truth brief — LinkedIn

Traced by 5 read-only agents, each load-bearing claim adversarially re-checked.

**Nothing LinkedIn can run.**

| Claim | State | Evidence |
|---|---|---|
| `postJob()` | DEAD | `src/hiring/linkedin.mjs:99`. Zero callers repo-wide. |
| `closeJob()` | DEAD | `src/hiring/linkedin.mjs:148`. Zero callers. |
| `ingestApplications()` | DEAD | `src/hiring/linkedin.mjs:175`. Zero callers. |
| Any HTTP route reaching them | MISSING | Not in the `ROUTES` map in `netlify/functions/api.mjs`. |
| Writer for `hiring_channel_connections` | MISSING | Only reference outside `051_hiring.sql` is the SELECT at `linkedin.mjs:39`. No INSERT anywhere. |
| `api/hiring/channels.mjs` | MISSING | Referenced in a comment at `api/hiring/postings.mjs:10`. File never written. |
| Scheduler / cron / sweeper | MISSING | `netlify.toml` declares 5 crons; none is hiring. |
| `LINKEDIN_CLIENT_ID` / `_SECRET` | Not read by hiring | Those belong to Social Studio (`src/social/oauth.mjs`), a different table. Hiring reads a saved connection row instead. |

Only live import of the module is `normaliseApplication` into
`src/hiring/hiring.pg.test.mjs:16`. `src/lib/no-unfenced-transmit.test.mjs:97`
allow-lists the file's raw `fetch`, which is why it passes the transmit fence
while being unreachable.

Consequence: wiring a button to `postJob` today fails immediately at
`connectionFor()` with "complete the Talent Solutions OAuth flow" — a step that
was never built.

## Ground truth brief — the rest of the screen

- All six `api/hiring/*` endpoints are routed and are `readHandler`, so they
  answer 405 to any non-GET. **No route in the app can write hiring data** —
  no advance, reject, score, schedule, or post.
- Role gate is `ROLE_SETS.HIRING` = owner, admin. Six other roles are blocked.
- On a real (non-demo) login the whole screen is **3 job titles, each 0 people
  and 4 short**. Every table that holds a person is empty; nothing on the live
  site can create a candidate or a posting.
- `053_eeo_selfid.sql` exists, is deliberately unexposed, and stays that way.

## Change manifest

**Files touched:** `public/app/hiring.html` only.

**Body markup**
- Removed the 39-line `BUILT FROM` spec comment opening the body.
- 20 caption blocks → 9. Kept only what a person needs to read a number
  (bench/shortfall definition, "unrouted", why someone is in the queue, what
  the funnel columns count). Cut everything explaining schema, triggers,
  design choices, or features nobody built.
- The human gate: two-column card with 4 prose blocks → one line. The
  operating rule is kept verbatim in substance; "the database enforces this"
  dropped as developer-facing.
- Panel headings are now plain: "How short each role is", "Waiting on a
  person", "Everyone, by stage", "Where applications come from", "Every
  decision made".
- Reordered to the owner's first question: numbers → gate → bench → queue →
  board → postings. The two analysis panels (funnel, decision log) moved
  behind a closed `<details class="reports">`.
- Postings panel now states plainly that **LinkedIn is not connected** and that
  nothing on the screen creates a posting. Replaces the old "⚠ never tested
  against a real LinkedIn account", which implied a connection exists.

**Page script — three defects fixed to make the screen usable**

1. **The screen loaded nothing.** Since `f23ced1` (today 13:36) `shell.js` and
   `data.js` are `defer`red, but the inline page script runs during parse, so
   `FHData.banner()` at the top of `wireHiring()` threw `FHData is not defined`
   and the function stopped before fetching. Every tile read "loading…" and
   every table was empty. Now started on `DOMContentLoaded`.
   Turns `e2e/screens-smoke.spec.mjs` "/app/hiring.html loads without a
   JavaScript error" from **red to green**. No test was changed.
2. **The page ran 68px off the right edge**, cutting off the Flags column, Last
   synced, and the right-hand board columns. `.fh-maxw` sets
   `margin-inline:auto`, and an auto cross-axis margin cancels flex stretch, so
   the column sized to its own max-content — which the 11-column board makes
   wider than the page. `width:100%` on `.content` restores the stretch.
   Measured: content column 1280px → 1212px.
3. The tile/insight rewrites below.

**Page script**
- `statRow`: 5 tiles → 4 (`SHORT BY`, `WAITING ON YOU`, `ON THE BENCH`,
  `OPEN APPLICATIONS`). `fundhub-brand.css:129` forces `.stats` to 4 columns
  app-wide with `!important`, so a fifth tile always wrapped to its own row —
  the uneven-card-row slop the Aug 16 audit flagged. Dropped tile was
  `JOBS POSTED`, which is structurally always 0.
- `deriv`: 3 formula cells → one plain line naming the roles you are short on.
- `rqInsight`, `fnInsight`, `dcSummary`: long explanations → short factual
  lines. Formulas and "why the designer chose this" removed.
- Deleted the vars left unused by the above (`judged`, `overrides`, `orate`,
  `posted`, `failed`).

**CSS**
- Added `details.reports` disclosure styles.
- `.deriv` grid → `auto-fit`; dropped the now-unemitted `.deriv .formula` rule
  and the `.gate h3 / .gate ol` rules the collapsed gate no longer uses.

**Not changed:** every element id the page script writes into (36 of them,
verified present exactly once each). No route, no role gate, no endpoint, no
journey step, no test.

## Measured, before → after

Harness: clean worktree at HEAD + the page, mocked owner session, 1440×900.

| | Before | After |
|---|---|---|
| Page height | 2689px | 1837px (now that data actually paints) |
| Words of prose in the body | 1116 | 463 incl. painted rows (295 static) |
| Caption blocks | 20 | 9 |
| Content column width | 1280px (overflowed) | 1212px (fits) |

Live, signed in as owner on fundhub.ai, after deploy:

| | Before (06:28 run) | After |
|---|---|---|
| Console errors | 1 (`FHData is not defined`) | **0** |
| Failing API calls | — | **0** of 10 |
| Page height | 3373px | 2093px |
| Sideways scroll at 1440 | yes (1508px doc) | **no** |
| Rows painted | tiles stuck on "loading…" | bench 3 · queue 1 · postings 2 · funnel 1 · decisions 1 |

## Proof

- `npm run lint` — clean, 1296 files.
- `npm test` — 5592 pass / 39 fail. **Identical with the page swapped back to
  its pre-change version** (5592/39), so none is this change. They belong to
  other sessions' in-flight work (company-brain, contracts, lenders, a sidebar
  sweep) plus the journeys-stale check. The count moved 13 → 39 during this
  task as other sessions committed — see CLAUDE.md §12 on this number moving.
- `src/http/{crm-html,app-nav-reachability,routes,auth-gate}.test.mjs` — 76
  pass / 4 fail, **identical with and without this change**. The 4 are a
  sidebar sweep another session had in flight.
- `e2e/screens-smoke.spec.mjs -g hiring` — **passes**. Was red on main; fixed
  by defect 1 above, without touching the test.
- `e2e/crm-flows.spec.mjs -g hiring` — `/app/hiring.html is interactive
  without throwing` passes.
- Live click sweep, owner on fundhub.ai: 38 controls clicked, 20 OK, 18 NOOP.
  All 18 NOOPs are filter chips already showing a count of 0 — wired, nothing
  to filter. No dead control, no forbidden control, no failing call.
- Evidence: `docs/workflows/hiring-repurpose-2026-08-17-evidence/`
  (`before/`, `after/`, `live/`).

## Journeys

No journey change. The journeys record routes and role gates; this change
touched neither. `docs/journeys/role-owner-actual.md:33` ("Hiring — 6 routes")
and the six route rows at :126–131 all remain accurate. No `CHANGELOG.md` line,
because nothing a journey describes moved.

## Found, not fixed (out of scope — did not touch)

1. **Fifteen other screens are dead the same way `hiring.html` was.** Same
   cause (`f23ced1` deferring `shell.js`/`data.js` while inline scripts call
   `FHData` during parse). Verified in a clean worktree at HEAD, so this is
   main, not local mess: `index`, `command-center`, `pipeline`, `messaging`,
   `documents`, `contracts`, `client-control-panel`, `products-commissions`,
   `ops-admin`, `agent-editor`, `template-editor`, `partner-galaxy`,
   `affiliate`, `consent-capture`, `client-portal`. Each needs the same
   one-line `DOMContentLoaded` change. **This is the biggest thing found today
   and it is not hiring's to fix.**
2. **Sideways scroll at 390px in the offline harness.** True before and after;
   the board's 11 columns. The live run reports no phone overflow, so this
   looks like a harness/shell difference — worth one look, not chased here.
3. **`api/hiring/postings.mjs:10` points at `api/hiring/channels.mjs`**, which
   does not exist. A comment, not a route, so nothing 404s — but it is a
   promise the code does not keep.
4. **`src/hiring/linkedin.mjs` is unreachable code** carrying a live-transmit
   allow-list entry. Either wire it (needs the connection-saving step nobody
   built) or delete it. Leaving it is how "we integrate with LinkedIn" keeps
   getting believed.
5. **`v_hiring_funnel`** exists in the database and nothing reads it; the funnel
   panel does its own math instead.

## Note for whoever runs the next batch

This repo had 3+ sessions writing concurrently during this task. A `git stash`
taken to measure a test baseline swept up 32 files of another session's
in-flight work; all 32 were restored from the stash, and both versions of the
one file that conflicted (`public/app/creative-factory.html`) are preserved at
`scratchpad/concurrent/`. **Do not `git stash` in this repo.** Measure a
baseline by swapping the single file you changed.
