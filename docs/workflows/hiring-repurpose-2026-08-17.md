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
| Page height | 2689px | 1260px |
| Words of prose in the body | 1116 | 295 |
| Caption blocks | 20 | 9 |
| Distinct font sizes in content | 3 | 3 |

## Proof

- `npm run lint` — clean, 1296 files.
- `npm test` — 5627 pass / 13 fail. All 13 reproduce with the page reverted to
  HEAD; none is hiring. They belong to other sessions' in-flight work
  (company-brain, contracts, lenders) plus the journeys-stale check.
- `src/http/{crm-html,app-nav-reachability,routes,auth-gate}.test.mjs` — 76
  pass / 4 fail, **identical with and without this change**. The 4 are a
  sidebar sweep another session had in flight.
- `e2e/screens-smoke.spec.mjs -g hiring` — fails on
  `ReferenceError: FHData is not defined`. **Pre-existing on main**: reproduced
  in a clean worktree at HEAD with the untouched page. Logged below, not fixed
  here (not named, and not this screen's file).
- Evidence: `docs/workflows/hiring-repurpose-2026-08-17-evidence/`
  (`before/`, `after/`, `live/`).

## Journeys

No journey change. The journeys record routes and role gates; this change
touched neither. `docs/journeys/role-owner-actual.md:33` ("Hiring — 6 routes")
and the six route rows at :126–131 all remain accurate. No `CHANGELOG.md` line,
because nothing a journey describes moved.

## Found, not fixed (out of scope — did not touch)

1. **`FHData is not defined` on `/app/hiring.html`.** Pre-existing on main,
   reproduced at HEAD. The browser smoke test for this screen is red because of
   it. Not in the file Chris named.
2. **Sideways scroll at 390px.** True before this change and after; the bench
   table is wider than the phone. Pre-existing.
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
