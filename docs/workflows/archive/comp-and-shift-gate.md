# comp-and-shift-gate

Shared board for the comp-and-shift-gate batch. Each workflow claims its task
here, writes its manifest here when done, and reads this file before starting.

This file did not exist when W3 ran; W3 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## W3

**Task:** the stale-shift threshold is now policy. `status: done`

**What changed in plain language:** the system used to guess that a shift left
open for 16 hours had been forgotten, and the code said out loud that 16 was a
made-up number nobody had decided. The owner has now decided: 12 hours. The
number is 12, the code now says so and says who decided and when, and the tests
check for 12.

### Files touched

| File | Line(s) | Change |
|---|---|---|
| `src/shifts/store.mjs` | 51–71 | Constant renamed `STALE_SHIFT_HOURS_PLACEHOLDER` -> `STALE_SHIFT_HOURS`; value `16` -> `12`; doc comment rewritten from "NOT A POLICY / no source anywhere" to the owner's 12-hour decision dated 2026-07-31. |
| `src/shifts/store.mjs` | 230 | `autoCloseStale()` default parameter now `olderThanHours = STALE_SHIFT_HOURS`. |
| `src/shifts/store.test.mjs` | 21 | Import renamed. |
| `src/shifts/store.test.mjs` | 164–178 | Test title rewritten; added `assert.equal(STALE_SHIFT_HOURS, 12)`; the single-export assertion now expects `["STALE_SHIFT_HOURS"]`. |
| `src/shifts/store.test.mjs` | 186–191 | Test title rewritten; added an assertion that the default sent to Postgres is literally `12`. |
| `src/http/middleware/ACTIVE-SHIFT-ROLLOUT.md` | 161–169 | Open question 3 no longer calls the threshold a flagged placeholder. States the 12-hour policy and its date, keeps the genuinely-open part of the question, and records that nothing calls the sweep. |
| `docs/workflows/comp-and-shift-gate.md` | new file | This board. |

### Test titles changed

Titles are the spec sentence in this repo, so both were rewritten, not just
their assertions.

- `the stale-shift threshold has exactly one definition, and it is named as a placeholder`
  -> `the stale-shift threshold has exactly one definition, and it is the owner's 12 hours`
- `autoCloseStale with no threshold falls back to the single named placeholder`
  -> `autoCloseStale with no threshold applies the 12-hour policy, not a number of its own`

### Exports changed

`src/shifts/store.mjs` no longer exports `STALE_SHIFT_HOURS_PLACEHOLDER`. It
exports `STALE_SHIFT_HOURS` instead. Any workflow importing the old name will
get `undefined`, and `autoCloseStale()` would then reject the threshold rather
than silently sweep with a bad number. At the time W3 finished, no other file in
the repository imported it.

### Findings — read these

1. **`autoCloseStale()` still has no caller.** There is no scheduler, no cron, no
   Netlify function, no Inngest job. Grepping the whole repo for `autoCloseStale`
   returns only its own definition, its tests, and prose in three docs. Nothing
   sweeps stale shifts today, and that is still true after this change. Setting
   the threshold to 12 changes what *would* happen; it does not start anything.
   Building a caller was explicitly out of scope for W3.
2. **One stale reference could not be updated.** `db/migrations/060_shifts_one_open.sql`
   line 69 still names `STALE_SHIFT_HOURS_PLACEHOLDER` in a comment. `db/migrations/**`
   was owned by another workflow and is off-limits to W3, and this repo's rule is
   that an applied migration is superseded by a new file rather than edited. It
   is a comment only — nothing executes it — but it is wrong now and somebody
   should supersede or annotate it.
3. **`src/shifts/store.pg.test.mjs` never pinned 16.** It was named as needing an
   update, but it does not import the constant and every one of its
   `autoCloseStale` calls passes an explicit `olderThanHours: 8`. Nothing there
   required changing. The default value is covered by the unit test instead.
4. **The spec and the code still disagree about the trigger.** §14 (per
   `ACTIVE-SHIFT-ROLLOUT.md`) says auto-close on *inactivity*. `autoCloseStale()`
   closes on *elapsed time since clock-in*. Those are different rules. The
   12-hour decision settles the number, not which of the two rules is meant.
   Pre-existing; not touched by W3.

### Not touched

`src/shifts/timesheet.mjs`, `src/commissions/**`, `api/**`, `db/migrations/**` —
owned by other workflows in this batch.

### Verification

- `npm test` with `DATABASE_URL` unset: **1712 pass / 0 fail / 193 skip.** Same
  as the baseline.
- `npm test` with `DATABASE_URL` set: the pre-existing failures only. W3 added
  none. Both shift suites (`src/shifts/store.test.mjs`, 25 tests, and
  `src/shifts/store.pg.test.mjs`) are fully green.
- `npm run lint` and `npx tsc --noEmit` do not exist in this repository — there
  is no `lint` script in `package.json` and no TypeScript. Nothing to run.
- No UI change, so no Playwright check.
- No journey change: this alters a constant and its documentation, not a flow,
  so no `docs/journeys/*-actual.md` needed updating and no changelog line was
  appended.

## W2

**Task:** apply the active-shift gate to exactly the right endpoints. `status: done`

**What changed in plain language:** two places in the product let a staff member
record work that decides who gets credit — the Inquiry Remover's Save buttons,
and the Claim / reassign / done buttons on the work queue. Both now refuse to
work unless the person is clocked in. Everything they can *look* at still works
whether they are clocked in or not. Two of the owner's four categories turned out
to have no endpoint at all, so nothing was gated for them.

**Updated 2026-07-31 after the owner's second ruling.** The owner confirmed that
`api/tasks.mjs PATCH { claim: true }` is what "claiming a lead" meant, and asked
that the absence of real lead-claiming be logged as a gap. Both are below.

### The owner's rule, verbatim — the only authority used

> "Gate writes that affect attribution or pay: claiming a lead, logging a call
> outcome, moving a pipeline stage, sending client messages. Do not gate
> read-only screens."

### The four categories, answered

| Category | Endpoint found | Gated? |
|---|---|---|
| Claiming a lead | `api/tasks.mjs` PATCH — **claims a TASK, not a lead.** Owner ruled this is what he meant. Real lead-claiming does not exist; see the gap below. | **Yes** |
| Logging a call outcome | `api/inquiries.mjs` POST | **Yes** |
| Moving a pipeline stage | **None.** No HTTP endpoint moves a card. | Nothing gated |
| Sending client messages | **None.** No HTTP endpoint reaches `sendTemplated`. | Nothing gated |

### Endpoints gated

| Endpoint | File:line | What it writes | Why it matches the rule |
|---|---|---|---|
| `POST /api/inquiries` (POST branch only) | `api/inquiries.mjs:63` (import at `:34`, POST branch opens at `:50`) | `inquiry_attempts` INSERT + `inquiry_log` UPDATE via `src/inquiries/work.mjs` — `logAttempt` (`:36`), `confirmRemoval` (`:85`), `setStatus` (`:107`) | All three actions write `inquiry_log.worked_by` / `worked_at`, the columns that name who did the work. `action:"attempt"` defaults to `kind:"call"` (`api/inquiries.mjs:73`) and carries `outcome` — that is literally "logging a call outcome". `confirm` and `status` ride the same POST branch and write the same attribution columns, so they are gated with it rather than split into a second, weaker rule. |
| `PATCH /api/tasks` (PATCH branch only) | `api/tasks.mjs:155` (import at `:62`, PATCH branch opens at `:140`) | `UPDATE tasks SET assignee_staff_id` — claim (`:168`) and reassign (`:190`); `UPDATE tasks SET done` (`:200`) | The owner named `{ id, claim: true }` explicitly. It writes `assignee_staff_id` = the caller — an assignment recorded against someone who may not be on the clock. Scope reasoning for the other two paths is below. |

`GET /api/inquiries` (`api/inquiries.mjs:44`) and `GET /api/tasks`
(`api/tasks.mjs:77`) are **untouched**. One lists a row's attempt history, the
other renders the queue. Neither changes anything.

#### Scope call on `PATCH /api/tasks` — the whole branch, not only `claim`

The PATCH branch has exactly three shapes and refuses a fourth
(`done_claim_or_assignee_required`, `:201`). All three are gated. Stated
explicitly because this was the judgement call in the change:

| Path | Writes | Verdict |
|---|---|---|
| `{ claim: true }` (`:168`) | `assignee_staff_id` = the caller | **Gate.** Named by the owner. |
| `{ assignee_staff_id }` (`:190`) | the same column, aimed at someone else | **Gate.** Reassignment *is* assignment. Exempting it would leave the attribution column writable off the clock by the longer route — the gate would be trivially bypassable by sending your own id instead of `claim:true`. |
| `{ done }` (`:200`) | `done` only — `tasks` has no `completed_by` | **Gate, on weaker evidence.** On the letter of the rule this one is arguable, and the coordinator flagged it as such. Two reasons it is included anyway. (1) Per-staff work *is* counted off this exact pair: `api/read/staff.mjs:15` computes `open_tasks` as `count(*) WHERE t.assignee_staff_id = s.id AND t.done = false`, so closing a task off the clock moves a named person's work number with no shift to attribute it to. (2) A gate sitting in two of three code paths inside one method branch is a gate the fourth action written next month will not have, and **nothing will fail when it does not** — which is precisely the drift `requireActiveShift.mjs` exists as a single file to prevent. |

This is the same call made on `api/inquiries.mjs` POST, and it is honestly made on
weaker evidence here. There, *every* action in the branch wrote `worked_by`, so
the branch was uniform and splitting it would have been arbitrary. Here `done`
genuinely does not write an attribution column, so the split would have followed a
real schema fact rather than an arbitrary line. The drift argument is what tips
it. **If the owner disagrees, narrowing to claim + reassign is one line** — move
the two gate lines from `:155` into the two `if` blocks at `:168` and `:190` — and
`src/http/tasks-write.pg.test.mjs` has the `done` case isolated as its own test,
so the change is a one-test edit.

**Composition used** — identical in both files, after the existing principal
resolution, never replacing it:

```js
const principal = await requirePrincipal(req, res, ["staff"], { db });
if (!principal) return;
// … inside the write branch only (POST for inquiries, PATCH for tasks):
const shift = await requireActiveShift(req, res, { db, principal });
if (!shift) return;
```

`api/inquiries.mjs` — `requirePrincipal` at `:39`, gate at `:63`.
`api/tasks.mjs` — `requirePrincipal` at `:71`, gate at `:155`.

The principal is passed explicitly because `requirePrincipal` attaches nothing to
`req` (it calls `authenticate()` directly, not `attachStaff()`), so there is no
`req.staff` for the gate to read. In `api/tasks.mjs` there is a nearby trap: the
handler reshapes the principal into `const staff = { id, role }` at `:75`, which
is **not** a principal and must not be passed to the gate in its place — it has no
`kind` and no `staffId`, so `staffIdFrom` would return `{ staffId: null, kind: null }`
and the gate would answer 401 to a perfectly good session. Noted in the code.

In both files the gate is the first statement in the write branch, before the body
is read — whether you may write at all is not a question about the payload. In
`api/tasks.mjs` it also sits deliberately *outside* the branch's own `try/catch`
(`:163`), which maps failures onto 400/500 and would otherwise be able to reshape
the gate's 503 into something that does not read as an outage.

### THE GAP: real lead-claiming does not exist

Logged at the owner's instruction, in his words: **real lead-claiming doesn't
exist yet.** For a later thread. Nothing was built, no column was added, no
endpoint was invented.

- `cards.owner` (`db/schema/001_init.sql:214`) is a `text` column and is **never
  written by anything.** `api/dashboard/pipeline.mjs:32` only SELECTs it.
- `clients` (`db/schema/001_init.sql:44`) has **no assignee column** — no
  `assigned_to`, no `owner_id`, no `staff_id`.
- The only assignment write in the entire `api/` tree is `api/tasks.mjs`
  (`:169` and `:191`, `UPDATE tasks SET assignee_staff_id`). **That claims a
  TASK.** It is what the owner ruled should be gated, and it is gated — but it is
  not the same thing as a salesperson taking ownership of a lead.

Consequence worth stating plainly: until lead ownership exists as a column
somebody writes, the shift gate cannot cover it, and no amount of gating
`api/tasks.mjs` makes it covered.

### Categories with NO endpoint in this repository

These are findings, not omissions. Nothing was invented to gate.

1. **Moving a pipeline stage — no endpoint.** The only writer of `cards.stage_id`
   is `moveCardToStage` (`src/workflows/cards.mjs:5`). Its four callers are all
   Inngest workflow functions (`dpc-02`, `dpc-03`, `s-04`, `f-11`), reached via
   `/api/inngest`, which has no staff principal. `api/dashboard/pipeline.mjs:53`
   is GET-only with an explicit 405. (`src/hiring/pipeline.mjs` moves *candidate*
   applications — a different namespace, and every `api/hiring/*` file is a
   GET-only `readHandler`.)
2. **Sending client messages — no endpoint.** `sendTemplated`
   (`src/workflows/messaging.mjs:47`) has 15 call sites and every one is in
   `src/workflows/`. Zero are in `api/`. There is no staff-facing composer.
   The only other `INSERT INTO messages` is `src/handlers/comms.mjs:129/:150`,
   reached from `api/webhooks/[provider].mjs` — inbound provider traffic with no
   session at all.

### Endpoints deliberately NOT gated, and why

| Endpoint | Why not |
|---|---|
| ~~`api/tasks.mjs` PATCH~~ | **No longer applies — this is now gated.** It was held here pending a ruling because it claims a *task*, not a lead, and gating it on my own reading would have been inventing the answer. The owner ruled on 2026-07-31 that it is what he meant. See "Endpoints gated" above. |
| `api/inquiry.mjs` (`:27`) | The proxy to the external inquiry-removal-ai runtime. `?action=update` writes case notes/status and `?action=launch` starts a call, so it looks close. It is not gated because **it writes nothing in this database** — no `worked_by`, no `staff_events`, no row anything in this repo attributes or pays against; it forwards to another system under a shared service secret that carries no staff identity. It also cannot be split: all three actions share one handler, so gating it would also block `?action=schedule`, which is booking, not an outcome. Gating it would be gating something because it is nearby. |
| `api/pii.mjs` POST (`:1`) | An SSN reveal is not one of the owner's four categories. `ACTIVE-SHIFT-ROLLOUT.md` recommends gating it on a sensitivity argument — that is a different rule from the one given, and adopting it would be over-gating. |
| `api/partner-brand.mjs` PUT (`:148`) | Rewrites white-label brand tokens. Configuration, not attribution or pay. |
| `api/shifts.mjs` POST (`:64`) | **The clock itself.** You would need a shift to get a shift. `clock_out` must also keep working if the shift was auto-closed underneath the browser. Its GET (`:56`) must stay open or the screen holding the clock-in button cannot render. |
| `api/auth/login.mjs`, `api/auth/logout.mjs`, `api/auth/session.mjs` | You sign in before you clock in. Gating logout would leave a live credential nobody can revoke from the UI. |
| `api/health.mjs` | Unauthenticated by design; it is what tells you the database is down. |
| `api/webhooks/[provider].mjs`, `api/inngest.mjs` | No staff, no session, no principal. The gate would 401 every provider callback and stop the event spine. |
| `api/documents/[id].mjs` | "Auth is the signature, not a session" — a signed link must work for a client who is not signed in. |
| `api/campaigns/*` (6), `api/creative/*` (4) | Partner/client principals. A partner has no `staff` row and no clock-in button; the gate would answer 403 forever. |
| `api/dashboard/*` (4) | `requireDashboardAccess` (a shared secret), not a staff session, so there is often no principal to gate on. `seed.mjs` is a dev tool. Naming trap: these are **not** the "dashboard actions" §14 means. |
| All 15 `api/read/*` and all 6 `api/hiring/*` | Read-only screens. The owner's rule ends with "Do not gate read-only screens." `readHandler` (`src/http/read-api.mjs:157`) and `partnerReadHandler` (`src/http/partner-read-api.mjs:43`) both 405 anything that is not GET. Gating `api/hiring/decisions.mjs` would additionally put a shift check in front of the NYC Local Law 144 audit trail; an auditor is not an employee on a shift. |

### What `ACTIVE-SHIFT-ROLLOUT.md` got wrong

That document is a proposal written by an earlier agent, before the owner's rule
existed. Measured against the rule, its §1 "Clearly a dashboard action — adopt"
list of four is **two right and two wrong** (it was scored one-and-three here
before the owner's second ruling; `api/tasks.mjs` has now been confirmed):

- `api/inquiries.mjs` POST — **correct**, and gated.
- `api/tasks.mjs` PATCH — **correct, but for the wrong reason, and it was not the
  document's call to make.** It argued from "the single most literal reading of
  *dashboard action*" — a term the owner never used and the spec never defines.
  The owner's actual reason is that claiming a task is the nearest thing this
  codebase has to claiming a lead. Right answer, unsound argument; it was held for
  a ruling rather than adopted on that reasoning, and the ruling confirmed it.
- `api/pii.mjs` POST — **wrong under this rule.** Its argument is sensitivity
  ("the worst row this gate can prevent from existing"), which is a different
  policy. Reading an SSN is not attribution or pay.
- `api/inquiry.mjs` POST — **wrong under this rule.** Its argument is "these reach
  outside the system and cost money". Cost is not attribution or pay, and the
  writes do not land in this database at all.

Two further corrections:

- The document's §3a treats "should reads be gated" as an open judgement call
  needing an operator. The owner has now answered it outright: "Do not gate
  read-only screens." That question is closed.
- Its §4 open questions 1 and 2 ("which endpoints are dashboard actions", "do
  owners and admins clock in") are only *partly* closed. Question 1 is answered
  by the owner's four categories. **Question 2 is still open and now matters
  more:** there is no owner/admin exemption in the gate, so an owner who does not
  clock in cannot use `POST /api/inquiries` **or `PATCH /api/tasks`** — which now
  includes marking his own task done. Flagging, not deciding.

The document's §2 "must NOT adopt" list was checked and is correct in full.

### Tests added

Two files, **25 tests total, all green.** Both under `src/http/`, never under
`api/`, because the `npm test` glob is `src/**` and `scripts/**` only and a test
under `api/` silently never runs. Both follow `src/http/inquiries.pg.test.mjs`:
hand-rolled `res` recorder, a real session via `createSession`,
`headers: { authorization: "Bearer " + token }`, sentinel-email purge run before
and after, `{ skip: !HAVE_DB }`, handler imported inside `before()` so the skip is
a real skip.

| File | Tests | Covers |
|---|---|---|
| `src/http/inquiries-write.pg.test.mjs` | 12 | `POST /api/inquiries` |
| `src/http/tasks-write.pg.test.mjs` | 13 | `PATCH /api/tasks` |

Every refusal is asserted **against the database** — `inquiry_log`,
`inquiry_attempts`, `tasks` — never against the response body. A gate that answers
403 and writes anyway is the failure that matters, and only the table can see it.

#### `src/http/inquiries-write.pg.test.mjs` — 12 tests, 3 suites

| Test | Proves |
|---|---|
| `action:"attempt"` refused, logs nothing | 403 `no_active_shift`; zero `inquiry_attempts` rows; `call_attempts` still 0; `worked_by`/`worked_at` still NULL |
| `action:"confirm"` refused, confirms nothing | 403 `no_active_shift`; `confirmed_at` still NULL; status unchanged |
| `action:"status"` refused, moves nothing | 403 `no_active_shift`; status unchanged |
| the refusal names the fix | body message says "clock in", so the screen can tell it from a role denial |
| the gate fires before body validation | a bad `inquiry_id` off the clock is still 403, not 400 |
| `GET /api/inquiries` still works off the clock | 200 — the read branch of the same handler was not gated |
| `GET /api/read/inquiries` still works off the clock | 200 — a wholly separate, untouched read endpoint. **This is the guard against over-gating.** |
| `attempt` with an open shift | 200; one `inquiry_attempts` row; `call_attempts` = 1; `worked_by` = the caller |
| `confirm` with an open shift | 200; `confirmed_at` stamped |
| `status` with an open shift | 200; status moved |
| clocking out closes the endpoint again | the gate follows the shift; it is not a one-time check at sign-in |
| a DB failure inside the shift check | **503 `shift_unavailable` `db:"down"`, and still writes nothing** — even though the caller *is* clocked in. AUDIT-FINDINGS.md lesson 3, "'Absent config' must never mean 'no gate.'" The failure is injected at the gate's own `SELECT ... FROM shifts` rather than by breaking the pool, so it cannot pass for the wrong reason by failing `requirePrincipal` first. |

**Mutation-checked.** With the two gate lines deleted from `api/inquiries.mjs`,
**7 of the 12 fail**; restored, **12 of 12 pass**. The tests assert the gate, not
the weather.

#### `src/http/tasks-write.pg.test.mjs` — 13 tests, 3 suites

Seeds two staff rows (a caller and a reassignment target) and one unclaimed task
in a role queue — exactly what a person picks from.

| Test | Proves |
|---|---|
| `claim:true` refused | 403 `no_active_shift`; `assignee_staff_id` still NULL in `tasks` |
| `assignee_staff_id` reassignment refused | 403 `no_active_shift`; nobody assigned. Closes the bypass — you cannot skip the gate by sending your own id instead of `claim:true` |
| `done:true` refused | 403 `no_active_shift`; `done` still false |
| the refusal names the fix | body message says "clock in", distinguishable from a role denial |
| the gate fires before body validation | a bodyless PATCH off the clock is 403, not 400 `id_required` |
| `GET /api/tasks` still works off the clock | 200, and the seeded task is really in the payload. **Over-gating guard.** |
| `GET ?unclaimed=1` still works off the clock | 200 — the pick-from list renders, so a person can still see the work they are about to clock in for |
| `claim:true` with an open shift | 200; `assignee_staff_id` = the caller |
| `assignee_staff_id` with an open shift | 200; the task lands on the other staff member |
| `done:true` with an open shift | 200; `done` = true |
| the claim race still answers 409 | gating the branch did not swallow the handler's own `already_claimed` rule, and the loser did not overwrite the winner |
| clocking out closes the endpoint again | the gate follows the shift, not the sign-in |
| a DB failure inside the shift check | **503 `shift_unavailable` `db:"down"`, and the UPDATE still does not happen** — even though the caller *is* clocked in. Also proves the PATCH branch's own `try/catch` (which maps failures onto 400/500) does not reshape that 503. |

**Mutation-checked.** With the two gate lines deleted from `api/tasks.mjs`,
**7 of the 13 fail**; restored, **13 of 13 pass**.

### Verification

Re-baselined after the second ruling, because other work has landed in the tree
since the first measurement. The baseline below was taken by reverting W2's two
handler edits to their `HEAD` contents and moving both new test files aside, then
restoring — not by comparing against an older run.

- `npm test`, `DATABASE_URL` unset: **1691 pass / 0 fail / 193 skip**, 76 suites.
  Baseline with W2's changes reverted: **the identical 1691 / 0 / 193** (74
  suites). W2 changed nothing here. *Note for the board: W3 above records this as
  1712. The current tree gives 1691 with or without W2's files; the 1712 figure is
  stale and it is not W2's doing.*
- `npm test`, `DATABASE_URL` set: **the failure count on this database is not
  stable, so compare names, not totals.** Two back-to-back runs of the *identical*
  final tree gave **2285 pass / 24 fail** and **2280 pass / 29 fail**. Baseline
  (W2 reverted) gave 2252 pass / 24 fail.

  Diffed by test name against that baseline:
  - The 24-fail run: **zero new failures, zero fixed.** Exact match.
  - The 29-fail run: the five extras are all in `src/inquiries/work.pg.test.mjs`,
    all failing on the same hook error, `an org and a staff member must exist —
    run the seed`. **That suite fails 0/5 in isolation** on code W2 never touched
    and which imports nothing W2 changed.

  **Proved, not assumed.** Same suite, same code, one variable — whether a staff
  row exists:

  | Condition | `node --test src/inquiries/work.pg.test.mjs` |
  |---|---|
  | database as found (zero staff rows) | **0 pass / 5 fail** |
  | one staff row inserted first, then removed | **5 pass / 0 fail** |

  **Root cause — the test database was never seeded.** It has **zero staff rows**
  of its own; `scripts/seed-staff.mjs` has never been run against it.
  `src/inquiries/work.pg.test.mjs:30` takes whatever staff row exists
  (`SELECT id FROM staff ORDER BY created_at LIMIT 1`) and `src/http/inquiries.pg.test.mjs:41`
  demands an active one. Neither creates its own. Both therefore pass or fail
  depending on whether some *other* suite's sentinel staff row happens to be alive
  at that instant — `src/http/shifts.pg.test.mjs` and `src/http/pii.pg.test.mjs`
  mint and delete such rows, and W2's two new files do the same. Adding files
  changes the interleaving, so the coin lands differently; it does not change
  whether the code works.

  **The real fix is to seed the test database.** Until someone does, "24
  pre-existing failures" is not a stable baseline and no total should be trusted
  as a pass/fail signal on this repo. Flagging, not fixing — seeding was not this
  task, and W2 deliberately did not make its own suites depend on seeded data:
  both create every row they need.

  `src/shifts/store.test.mjs` appeared on the first baseline and not after. It
  passes 25/25 in isolation on three consecutive runs — the same class of flake.
  W2 touches neither that file nor the module it tests.
- `src/http/inquiries-write.pg.test.mjs`: **12/12 green.**
- `src/http/tasks-write.pg.test.mjs`: **13/13 green.** Both green in every full
  run, including the 29-fail one.
- `src/http/routes.test.mjs`: green. No new file under `api/`, so `ROUTES` is
  unchanged and nothing needed registering.
- `src/http/middleware/requireActiveShift.test.mjs` and `.pg.test.mjs`: green,
  untouched.
- `npm run lint` and `npx tsc --noEmit` do not exist in this repository — no
  `lint` script in `package.json`, no TypeScript. Nothing to run.
- No UI change, so no Playwright check.
- `docs/journeys/` does not exist in this repository, so there was no
  `*-actual.md` to regenerate and no changelog to append to. Flagging rather than
  creating one: CLAUDE.md §4 says agents generate `-actual.md` from code, and
  authoring a journey tree from scratch was not this task.

### Files touched

| File | Line(s) | Change |
|---|---|---|
| `api/inquiries.mjs` | 16–31 | Header block: the owner's rule quoted verbatim, why all three POST actions are gated together, why GET is not. |
| `api/inquiries.mjs` | 34 | `import { requireActiveShift }`. |
| `api/inquiries.mjs` | 51–64 | The gate, inside the POST branch only, after `requirePrincipal`, with the reasoning for passing `principal` explicitly and for returning on 503. |
| `api/tasks.mjs` | 22–58 | Header block: the owner's rule and his `claim:true` ruling quoted, plus the per-path table explaining why the whole PATCH branch is gated and not only `claim`. |
| `api/tasks.mjs` | 62 | `import { requireActiveShift }`. |
| `api/tasks.mjs` | 141–156 | The gate, inside the PATCH branch only, after `requirePrincipal`, outside the branch's own `try/catch`, with the `staff` vs `principal` trap called out. |
| `src/http/inquiries-write.pg.test.mjs` | new file | 12 tests. |
| `src/http/tasks-write.pg.test.mjs` | new file | 13 tests. |
| `src/http/middleware/ACTIVE-SHIFT-ROLLOUT.md` | 3–26 | Status banner: the doc's own opening line said "Not one endpoint has been edited", which is no longer true. Points here for what was actually decided. Its analysis is left intact. |
| `docs/workflows/comp-and-shift-gate.md` | this section | Manifest. |

### Not touched

`src/shifts/store.mjs`, `src/shifts/timesheet.mjs`, `src/commissions/**`,
`db/migrations/**` — owned by other workflows. No migration, no route change, no
new dependency, no new column, no new endpoint. **Lead assignment was not built**
— it is logged as a gap above, at the owner's instruction.

### Open for the owner — three items, none blocking today

1. **`done` on `PATCH /api/tasks` is gated on the weaker argument.** If you want
   the gate narrowed to claim + reassign only, say so — it is a two-line move and
   one test edit. See the scope table above.
2. **Do owners and admins clock in?** The gate has no `SUPER_ROLES` exemption, by
   design. If Chris does not clock in, he cannot use `POST /api/inquiries` or
   `PATCH /api/tasks` — including marking his own task done.
3. **The test database needs seeding.** Not a W2 change, but it is why the suite's
   failure count moves between identical runs. `scripts/seed-staff.mjs` exists and
   has never been run against this database.
