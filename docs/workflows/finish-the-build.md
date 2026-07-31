# finish-the-build — shared board

One line per workflow. Read this before you start; write your manifest here
before you report done.

| # | unit | owner | status |
|---|---|---|---|
| W1 | Wire `logStaffEvent()` into the real call sites; prove `autoCloseStale()` end to end | claude/telemetry-writers | **done** |

---

## W1 — staff telemetry writers

**What this was.** `src/shifts/telemetry.mjs` is the writer for the
`staff_events` table. It had no callers at all, so the table was empty. Three
things depended on it and none of them worked:

* the team telemetry screen had nothing to show,
* timesheets had no input,
* the sweep that closes forgotten shifts (`autoCloseStale()`) decides who has
  stopped working by looking at that table. With the table empty, everybody
  looked like they had stopped working the second they clocked in, so the sweep
  could not be switched on without wrongly ending people's shifts.

**What changed in one line.** Logging a call or a letter on the Inquiry Remover
screen now records that the person did it, and on which shift — which is what
the auto-close sweep reads.

### Where the writes were added

| action | event written | file |
|---|---|---|
| logging a **call** attempt | `call_made` | `src/inquiries/work.mjs` → `logAttempt()` |
| logging a **letter** attempt | `letter_issued` | `src/inquiries/work.mjs` → `logAttempt()` |

Reached from `POST /api/inquiries { action: "attempt" }`. Both come off the same
function, which is the only place in the whole repository where a named employee
finishes one of these actions.

### What had NO call site — nothing was wired

Checked against the current tree, not taken from the older notes.

| kind | why nothing was wired |
|---|---|
| `pull_run` | A credit pull is requested and returned entirely by background automation reacting to the client's payment. `src/handlers/client-lifecycle.mjs` is where the pull's result is stored and it never learns which employee, if any, was involved. There is no employee to name. |
| `text_sent` | `sendTemplated()` in `src/workflows/messaging.mjs` is the only thing in the product that writes an outbound message, and all 39 of its callers are background automations with no employee attached. There is no screen or endpoint that lets a member of staff send a message at all. |
| `file_touched` | The word appears in a comment in the database schema and is defined nowhere. Whether opening a record counts, or only changing one, is a decision, not a fact. Choosing call sites for it would have been inventing the definition. |

Three further gaps, unchanged and still open:

1. **Filing through a bureau portal has no word for it.** Staff log `portal`
   attempts alongside calls and letters. The approved list of five event names
   has no entry for it, so those attempts produce no telemetry row. Filing them
   under `letter_issued` because it is the nearest word would make "letters
   issued" a number nobody can trust. **Whoever owns the list decides.**
2. **Two writers, two vocabularies.** The auto-close sweep writes its own audit
   rows with the word `shift_auto_closed`, which is not on the approved list.
   Left alone deliberately.
3. **`confirm` and `status` on the Inquiry Remover write nothing.** Both are real
   staff work. The only word that could describe them is `file_touched`, which is
   undefined — see above.

### Assumptions made without stopping to ask

The owner's instruction for this run was to keep going and record the calls here
rather than wait. These are the ones that could reasonably have gone another way.

1. **Which shift the work is attached to.** The notes left this open with three
   options. Taken: the web layer already looks up the person's open shift in
   order to decide whether they are allowed to write at all, so that answer is
   passed straight down. It costs nothing extra and it is correct. If some other
   caller ever calls the same function without passing it, the shift is looked up
   then; if the person is not clocked in, the event is still recorded with no
   shift attached, because working off the clock is a real thing that happened
   and refusing to record it would lose the work entirely.
2. **The employee's free-text note is not copied into the telemetry record.**
   Notes are typed by staff about a consumer's dispute and can contain anything.
   The note is already stored, once, on the attempt itself. Telemetry is an index
   over work, not a second copy of it.
3. **A telemetry failure is written to the error log and thrown away.** Required
   by the design, and now proved rather than trusted: a database error is
   injected at the telemetry write and the call attempt still saves and still
   answers OK. Tested twice — once directly, once through the real web endpoint.
4. **`confirm` and `status` were left alone** rather than being given the
   undefined `file_touched` word. See gap 3 above.
5. **The end-to-end test uses short intervals (minutes, not the 12-hour policy).**
   The sweep works on the whole database at once and the test suites run side by
   side, so a test shift left idle for hours would be fair game for another
   suite's sweep running at the same moment. Minutes keep the suites out of each
   other's way. The 12-hour policy itself is untouched.
6. **No journey diagram was updated.** `docs/journeys/` does not exist in this
   repository — there are no `-intended.md` files, no `-actual.md` files and no
   changelog. Creating that whole system was not this task. **Reported, not
   worked around.**

### Change manifest

**Files touched**

* `src/inquiries/work.mjs` — emits `call_made` / `letter_issued` after the
  attempt commits. New optional `shiftId` input on `logAttempt()`. No change to
  what it returns and no change to the inquiry write itself.
* `api/inquiries.mjs` — passes the already-resolved open shift down to
  `logAttempt()`. No new endpoint, no new route, no change to any response.
* `src/inquiries/work.test.mjs` — 13 new tests, no database needed.
* `src/http/inquiries-write.pg.test.mjs` — 5 new tests through the real endpoint.
* `src/inquiries/work.pg.test.mjs` — cleanup only, for the rows the new write
  leaves behind.
* `src/shifts/telemetry-wiring.pg.test.mjs` — **new file.** The end-to-end proof.

**Exports added:** none. **Props changed:** none. **Routes affected:** none.
**Journeys impacted:** none exist.

**Behaviour that is genuinely new**

* A call or letter attempt writes one `staff_events` row.
* That row carries the shift the person was on.
* A portal filing or a working note writes none.
* A broken telemetry write cannot fail, roll back or slow the attempt.
* The sweep now leaves a shift open while work keeps arriving and closes it, at
  the last piece of work, once it stops.

**How it was checked.** Every one of those was broken on purpose, the test
watched go red, and then restored. See "Verification" below.

### Verification

* `npm test` with no database: **green** (0 failures).
* Against Postgres: no failing test name that was not already failing on `main`
  before any of this. The 24 pre-existing failures are all in the ad-campaign and
  creative-library endpoints and are untouched by this work.
* Mutation-checked, each break confirmed red and then restored:
  * removed the telemetry write → the end-to-end shift test fails,
  * moved the telemetry write inside the transaction → the ordering test fails,
  * made the telemetry failure escape instead of being swallowed → both
    swallow tests fail,
  * dropped the shift id → the shift-linking tests fail,
  * added `portal` to the mapping → the vocabulary test fails.

### Left undone

* `pull_run`, `text_sent` and `file_touched` have no writer, because there is
  nowhere honest to put one. Listed above.
* Nothing schedules `autoCloseStale()`. This work removes the reason it could not
  be scheduled; it does not schedule it. **That is still a deliberate decision
  for the owner, and it affects people's pay.**

### ⚠ The one thing to read before switching the sweep on

Only the Inquiry Remover desk now produces activity. **Everybody else still looks
idle from the moment they clock in.**

A closer on calls all day, a funding advisor moving rounds, anyone whose work
happens on a screen that records nothing — the sweep cannot see any of it. If it
were switched on today it would end their shift at its start time, and those are
the rows a timesheet is built from.

This work fixed the reason the sweep was unsafe for one desk. It did not fix it
for the others, and it could not: there is nothing to record their work from. The
choices are to give those screens something to record, to run the sweep only for
roles that produce telemetry, or to leave it off. **That is a decision, and it is
yours.**
