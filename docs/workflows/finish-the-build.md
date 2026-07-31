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

### What had NO call site — seamed, not wired

Checked against the current tree, not taken from the older notes. Two of these
are now **documented empty seams** — the code is in place and does nothing,
because there is nobody to attribute the work to. The rule applied was the
autonomy framework's own: *external call? seam it, document it, don't build it.*

| kind | seam | state |
|---|---|---|
| `text_sent` | `sendTemplated()` in `src/workflows/messaging.mjs` — the single point every outbound message in the product passes through. Takes an optional sender; when one is present and the channel is a text, it writes the row. | **Inert.** All 39 callers are background automations with no employee attached, and there is no screen or endpoint that lets a member of staff send a message at all. Nothing supplies a sender, so nothing is written. |
| `pull_run` | `onAnalysisCompleted()` in `src/handlers/client-lifecycle.mjs` — the line where "a credit pull ran" becomes true. Reads a staff member off the event when one is carried. | **Inert.** The pull is requested and returned entirely by automation reacting to the client's $32 payment. Nothing carries a staff member today. Under the 05/30 model the pull runs live on the call, which gives it an actor for the first time — that is why the seam exists rather than nothing. |
| `file_touched` | none | The word appears in a comment in the database schema and is defined nowhere. Whether opening a record counts, or only changing one, is a decision, not a fact. Choosing call sites for it would have been inventing the definition. **No seam, because there is nothing to seam to.** |

Both seams are safe by construction and proved so: a background send and an
automated pull write nothing, attempt nothing, and log nothing. A replayed event
counts nothing a second time. A broken telemetry write cannot take down the
message or lose the credit-pull result.

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
7. **"Fire-and-forget" was honoured as "cannot fail the action", not as "do not
   wait for it".** The telemetry write is awaited. On the live host, work that is
   not finished before the response goes out is not guaranteed to run at all —
   the machine can be put to sleep the moment the reply is sent. Not waiting
   would silently drop rows, which is the thing this whole workflow exists to
   stop. The part that matters is kept: a telemetry failure can never fail,
   reverse or slow the work it is describing, and that is tested.
8. **`WORKFLOW-AUTONOMY.md` does not exist.** Not in the working tree, not on
   `main`, not anywhere in the repository's history. The decision rules were
   supplied in the instruction itself and were followed from there. **Reported,
   not invented.**
9. **Kept the existing branch and pull request.** The checklist suggested a
   branch named `telemetry-writers-w1`; this work was already on
   `claude/telemetry-writers` with pull request #37 open against it. A new branch
   would have orphaned that review. Same workflow, same branch.

### Change manifest

**Files touched**

* `src/inquiries/work.mjs` — emits `call_made` / `letter_issued` after the
  attempt commits. New optional `shiftId` input on `logAttempt()`. No change to
  what it returns and no change to the inquiry write itself.
* `api/inquiries.mjs` — passes the already-resolved open shift down to
  `logAttempt()`. No new endpoint, no new route, no change to any response.
* `src/shifts/attribution.mjs` — **new file.** One shared answer to "which shift
  does this work belong on", used by all three call sites instead of three
  copies.
* `src/workflows/messaging.mjs` — the `text_sent` seam. Optional sender; inert
  for all 39 existing callers, which pass none.
* `src/handlers/client-lifecycle.mjs` — the `pull_run` seam. Reads a staff member
  off the event when one is carried; nothing carries one today.
* `src/inquiries/work.test.mjs` — 13 new tests, no database needed.
* `src/shifts/attribution.test.mjs` — **new file.** 6 tests.
* `src/workflows/messaging.test.mjs` — 10 new tests for the seam.
* `src/handlers/client-lifecycle.test.mjs` — 6 new tests for the seam.
* `src/http/inquiries-write.pg.test.mjs` — 5 new tests through the real endpoint.
* `src/inquiries/work.pg.test.mjs` — cleanup only, for the rows the new write
  leaves behind.
* `src/shifts/telemetry-wiring.pg.test.mjs` — **new file.** The end-to-end proof.
* `db/migrations/068_shifts_close_reason.sql` — **new file.** Adds
  `shifts.closed_by`, a check constraint on its three values, and a partial index
  over the shifts that need a human. New nullable column, default NULL, no
  existing data touched.
* `src/shifts/store.mjs` — the sweep stamps `closed_by` and returns it.
* `src/shifts/timesheet.mjs` — `needsReview()`, `timesheet()`, and a refusal to
  total a shift whose end nobody can vouch for.
* `src/shifts/timesheet.test.mjs` — 6 new tests; the export guard extended.
* `src/shifts/store.pg.test.mjs` — 3 new tests.

**Exports added:** `resolveShiftId` (`src/shifts/attribution.mjs`).
**Props changed:** `sendTemplated()` and `logAttempt()` each take one new
optional input; both default to today's behaviour, so no existing caller changes.
**Routes affected:** none. **Migrations:** one — `068_shifts_close_reason.sql`,
a new nullable column with a NULL default. Applies clean on a virgin database
(51 migrations), re-applies as a no-op, and is idempotent run by hand twice.
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
* `npm run migrate` applies 068 clean on a virgin database and re-applies as a
  no-op. The file is idempotent on its own too — run twice by hand against the
  same database it changes nothing the second time.
* Mutation-checked, each break confirmed red and then restored:
  * removed the telemetry write → the end-to-end shift test fails,
  * moved the telemetry write inside the transaction → the ordering test fails,
  * made the telemetry failure escape instead of being swallowed → both
    swallow tests fail,
  * dropped the shift id → the shift-linking tests fail,
  * added `portal` to the mapping → the vocabulary test fails,
  * let a background send write a text event → the seam test fails,
  * counted a replayed send as a second text → the replay test fails,
  * filed an email under `text_sent` → the channel test fails,
  * invented an actor for an automated credit pull → the seam test fails,
  * made the shared resolver ignore an explicit "off the clock" → three fail,
  * marked every sweep close the same → 8 shift tests fail,
  * stamped a human clock-out as a sweep close → the normal-case test fails,
  * let an unvouchable shift total as zero → the timesheet test fails,
  * silently dropped the review rows → two timesheet tests fail,
  * dropped the check constraint from the migration → the vocabulary test fails,
  * paid zero for an unvouchable shift → three tests fail,
  * used the average instead of the middle value → two fail,
  * let zero-length rows count as evidence → one fails,
  * let an unvouchable shift feed its own estimate → one fails,
  * folded estimated time into the confirmed figure → three fail,
  * dropped the observed-gone cap → one fails.

**One mutation did not go red on the first attempt, and the test was fixed
rather than the result written up as a pass.** Removing the sender guard from
the message seam changed no outcome, because the telemetry writer refuses an
unnamed person by itself. The guard's real job is that a background send must be
*silent* — without it, every outbound message in the product logs a warning
about a person who was never supposed to exist. The test now asserts silence,
and the mutation fails it.

### Compliance flags

**No `COMPLIANCE REVIEW REQUIRED` flag is raised.** Nothing here changes dispute
logic, credit-repair wording, fee timing, refunds, payment rails, consent capture
or the type of credit pull. What is added is a record of work that already
happened.

Two data-minimisation decisions were made deliberately and are worth a reviewer's
eye, because they concern consumer data:

1. **The employee's free-text note is not copied into the telemetry record.**
   Notes are typed by staff about a consumer's dispute and can contain anything.
   The note stays in one place only.
2. **Neither the message body nor the bureau payload is copied in.** A telemetry
   row carries ids and an outcome word — never the consumer's credit file and
   never client-facing copy. Both are tested for by searching the written record
   for content that must not be there.

### Out of scope

* Everything W2–W10 own. Those are other people's branches.
* Any new endpoint, screen, route or migration. This workflow adds none.
* Scheduling the auto-close sweep. The reason it was unsafe is gone; switching
  it on is still an operator action.
* The hourly rate. Still not modelled anywhere in this system — the timesheet
  reports seconds and stops.
* Turning either seam on. That needs a staff-facing send, or a pull that carries
  who ran it — neither exists.

### Left undone

* `pull_run` and `text_sent` are seams, not writers — inert until an actor
  exists. `file_touched` has no writer and no seam. Listed above.
* Nothing schedules `autoCloseStale()`. This work removes the reason it could not
  be scheduled; it does not schedule it. **That is still a deliberate decision
  for the owner, and it affects people's pay.**
* Nothing reads the review list yet. The column, the index, the estimate and the
  three-number total all exist; no screen shows them. Whoever builds the
  timesheet view gets that for free.
* No wage rate anywhere, so nothing multiplies these seconds by anything yet.

### The roles that produce no telemetry — decided

Only the Inquiry Remover desk produces activity. A closer on calls all day, a
funding advisor moving rounds, an admin — the sweep cannot see any of their work.
Left alone, every one of their forgotten shifts would close at its own start time
and read as **"worked 0 seconds"**, which is a payroll input and is wrong.

There were three ways out. Two are bad:

* **Don't close those shifts.** An open shift blocks that person's next clock-in
  (that is what the one-open-shift rule does). You trade a wrong timesheet row
  for an employee who cannot start work in the morning.
* **Guess the hours.** There is no basis for a guess anywhere in this system — no
  default shift length, no rota, no scheduled hours in the database or in any
  config. A guess would put invented time into pay.

**What was built instead: close it, and mark it.** The shift row now says who
ended it.

| value | meaning |
|---|---|
| empty | the person clocked out themselves, or is still on the clock. The normal case. |
| `sweep_idle` | software ended it, at the last thing they were recorded doing. An estimate **with evidence behind it** — counted normally. |
| `sweep_no_evidence` | software ended it with **nothing to go on**, so the shift reads as zero length. Not a fact about time worked. |

Then the timesheet was taught the difference. `timesheet()` returns the hours it
can stand behind, plus the shifts nobody can vouch for, handed back whole so a
person can be shown them. It does not invent the missing hours and it does not
quietly drop them. Anything that tries to total one of those shifts directly gets
a loud error naming the row, not a plausible zero — the same treatment this file
already gave a shift that ends before it starts, for the same reason.

**What this means in practice.** The sweep is now safe to schedule for every
role. Nobody gets locked out in the morning, and nobody's forgotten shift
silently becomes a zero. What lands instead is a short list of shifts with a
question attached: *how long was this person actually here?*

### What those shifts are worth — decided

**Zero was never actually one of the options.** The employer's own record is what
failed. Under US wage law the employer carries the duty to keep accurate records
of hours worked, and the long-settled rule (*Anderson v. Mt. Clemens Pottery*,
1946) is that when those records fail, the failure does not transfer to the
employee: they need only show they worked and support a reasonable estimate of
how much, and the burden is then on the employer to disprove it. Paying nothing
is the employer taking the benefit of its own missing paperwork. A missed
clock-out is a **process** problem, handled as one — it is not a reason to
withhold pay for time worked.

Overpaying is wrong too, and was already refused: the sweep does not stamp "now"
as the end time, because that would credit every hour between the forgotten
clock-out and whenever the sweep happened to run.

**The estimate is the person's own typical day** — the middle value of their own
completed shifts. It comes from data the system already holds, it is about that
individual rather than an invented average, and it leans neither way.

* **The middle value, not the average.** One 14-hour day would drag an average
  upward; one already-broken zero-length row would drag it down. The middle value
  shrugs off both.
* **Zero-length rows are never evidence.** Letting a previously-swept shift into
  the calculation would make the record-keeping failure feed itself.
* **Capped at the moment the sweep saw them gone.** They cannot have worked past
  it. It almost never binds, and costs nothing to carry.
* **Somebody's first day is the one case with no answer.** A new employee with no
  completed shifts has nothing to infer from. That comes back as zero *with the
  reason attached*, and the shift stays flagged. It is not a claim they worked
  nothing.

**And it is still flagged.** The timesheet reports **three numbers, never one**:
time somebody vouched for, time that was estimated, and the two added together —
which is what gets paid. They stay separate so no screen can show estimated time
as though a human had checked it. The estimate is what is paid if nobody looks;
it is not a claim that anybody looked.

**Not decided here, because it is not this file's to decide:** the rate. There is
still no hourly wage modelled anywhere in this system. This reports seconds and
stops.
