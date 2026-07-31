# finish-the-build — shared board

One line per workflow. Read this before you start; write your manifest here
before you report done. Append your own `## W<n>` heading below rather than
editing anyone else's.

| # | unit | owner | status |
|---|---|---|---|
| W1 | Wire `logStaffEvent()` into the real call sites; prove `autoCloseStale()` end to end | claude/telemetry-writers | **done** |
| W2 | Client Finance OS v1, foundation slice — migrations 075/076 + the store module | claude/finance-os-subscriptions | **done** |
| W3 | One-tap soft pull for an existing client (addendum §8), migration 077 | claude/finance-os-softpulls | **done** |
| W4 | Alerts | — | not yet claimed |

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

---

## W2

**Task:** Client Finance OS v1, foundation slice — `subscriptions` (075),
`client_cards` (076), and the store module over them. `status: done`

### The split, stated for the record (CLAUDE.md §0)

The owner had already split this batch and handed W2 its slice with an explicit
scope fence, so W2 did not re-propose one. W2's slice has no dependency on W3 or
W4 and shares no file with them. Model: Opus — schema plus a hard compliance
rule, where being wrong is expensive and not visible to a non-coder afterwards.

### What changed in plain language

The system can now record what a client pays us every month, and which card pays
for it — two things it had nowhere to put before.

Two rules are built into the database itself, so they hold no matter who writes
to it later:

1. **We never store a card number.** Only the payment company's token — a
   meaningless code that stands in for the card — plus the brand, the last four
   digits and the expiry date. The database physically rejects anything that
   looks like a real card number, and there is no column anywhere that could
   hold a security code.
2. **A price can never be edited after the fact.** Changing someone's plan
   writes a new row and closes the old one. If somebody tries to edit a live
   price, the database refuses and tells them to open a new row instead. That
   means what a client paid last March still reads as what they paid last March,
   forever.

Nothing here charges anybody. There is no billing run, no scheduled job, and no
web address that could take a payment. This is the filing cabinet, not the till.

### Files touched

| File | Change |
|---|---|
| `db/migrations/075_subscriptions.sql` | new — `subscriptions`: effective-dated plan rows, a no-overlap exclusion constraint, an immutability trigger on the terms, per-org scoped processor key. |
| `db/migrations/076_client_cards.sql` | new — `client_cards`: token reference only, two CHECKs that make "no card number" physical, plus the composite foreign key 075 could not declare yet. |
| `src/subscriptions/index.mjs` | new — pure logic: card-data refusals, null-preserving money, effective-date window maths, plan-change validation. No I/O. |
| `src/subscriptions/index.test.mjs` | new — 26 unit tests, no database. |
| `src/subscriptions/store.mjs` | new — the write paths: `putClientCard`, `listClientCards`, `removeClientCard`, `startSubscription`, `getSubscriptionAt`, `listSubscriptions`, `changeTier`, `cancelSubscription`, `attachCard`. |
| `src/subscriptions/store.pg.test.mjs` | new — 21 real-Postgres tests; skips cleanly with `DATABASE_URL` unset. |
| `docs/workflows/finish-the-build.md` | new — this board. |

No existing file was modified. Nothing under `src/shifts/**`,
`src/commissions/**`, `src/mail/**`, `db/migrations/077-079` or `public/app/**`
was touched, read-for-edit or renamed.

### Exports added

`src/subscriptions/index.mjs` — `looksLikeCardNumber`, `assertNoCardData`,
`normalizeCardMeta`, `priceToCents`, `formatPrice`, `assertPriceCents`,
`isLiveAt`, `planChange`.

`src/subscriptions/store.mjs` — `putClientCard`, `listClientCards`,
`removeClientCard`, `startSubscription`, `getSubscriptionAt`,
`listSubscriptions`, `changeTier`, `cancelSubscription`, `attachCard`.

No existing export changed. No route, handler or `ROUTES` entry was added, so
`src/http/routes.test.mjs` is unaffected — deliberately: the scope fence forbids
an HTTP endpoint that charges a card, and W2 built no endpoint at all.

### Verification

```
migrations apply to an empty database   52 applied, 0 errors
re-run on the same database              0 applied  (clean no-op)
npm test, DATABASE_URL unset             1934 tests · 0 fail · 216 skipped · exit 0
npm test against Postgres, virgin DB     2389 tests · 24 fail · 8 skipped
  baseline (same procedure, no changes)  2342 tests · 24 fail · 8 skipped
  failing NAMES, diffed both directions  identical — 0 new, 0 disappeared
subscriptions unit tests                 26 pass
subscriptions pg tests                   21 pass
16 code mutations                        16 caught
9 constraint/trigger drops               9 caught
npm run diagrams:check                   up to date (12 files)
```

The 24 pre-existing failures are the documented baseline (all in the creative /
ad-platform partner-isolation suites). They were captured by running the suite
twice on a clean database at the merge-base commit BEFORE any of this work, and
diffed by NAME rather than by count, per the trap note.

**Mutation checking.** Every behaviour was broken on purpose and the named test
was confirmed to fail: the null-preserving price, the last4 refusal, the PAN
shape test, each `planChange` refusal, the half-open window, the cross-client
token guard, the metadata COALESCE, the no-reinstate rule, both idempotent-date
COALESCEs, the removed-card guard on `attachCard`, and the carry-forward of the
card and processor reference through a plan change. Separately, each of the nine
database constraints was dropped on a cloned database and the test that claims
to prove it was confirmed to fail: `client_cards_token_not_pan`,
`client_cards_last4_shape`, `client_cards_expiry`, `subscriptions_no_overlap`,
`subscriptions_cancel_coherent`, `subscriptions_period`, `subscriptions_card_fk`,
`subscriptions_provider_ref_uq`, `trg_subscriptions_terms_immutable`.

### Assumptions recorded, per the owner's instruction to keep going

Every one of these is a call W2 made rather than a question W2 asked. Each is
reversible with one additive migration.

1. **"Card token reference" on `subscriptions` means a pointer to a
   `client_cards` row, not a copy of the token.** A token in two tables is a
   token that gets rotated in one of them. `subscriptions.card_id` is that
   pointer; there is no token column on `subscriptions`.
2. **The foreign key from `subscriptions` to `client_cards` is declared in 076,
   not 075.** `db/migrate.mjs` applies files in filename order, so 075 runs
   before `client_cards` exists. The alternative was swapping the numbers, which
   the owner fixed as 075 = subscriptions, 076 = cards.
3. **One subscription per client at a time.** `subscriptions_no_overlap` says
   two versions of one client's subscription can never cover the same instant.
   That is the plain reading of a single `tier` column plus "changing a plan
   opens a new row". If a client ever needs two concurrent subscriptions the
   constraint gains a key column; it does not get dropped.
4. **`tier` is free text with no CHECK list.** The tier names live in the
   rebuild plan's addendum, which is not in this repository. An invented list is
   a guess wearing a constraint (the call 065 made about outcome tiers).
5. **`price_cents` lives on the subscription and may be NULL.** See finding 1
   below — there is no tier price row anywhere to point at. NULL means "nobody
   recorded this", never 0.
6. **`cancelled_at` and `effective_to` are separate dates.** A cancellation
   requested today commonly runs to the end of the paid period. Collapsing them
   would lose the date a dispute turns on.
7. **A card refresh does not un-remove a card.** Storing the same token again
   updates the display fields and leaves `removed_at` alone. There is therefore
   no reinstate path, and W2 did not invent one — un-removing an instrument is a
   deliberate act that needs its own consent record.
8. **A two-digit expiry year is refused, not expanded.** `29` → `2029` is the
   same rule that reads `99` as `2099`.
9. **A long `last4` throws instead of being truncated.** Truncating means
   accepting a full card number, holding it in memory and reporting success.
10. **No billing interval column, no proration, no `supersedes_id`, no
    `is_default` card flag.** Each is stated with its reason in the migration
    headers under "WHAT WAS DELIBERATELY NOT DONE".

### Findings — read these

1. **THERE IS NO TIER PRICE ANYWHERE IN THIS REPOSITORY, AND W2 DID NOT INVENT
   ONE.** 013_commission_rules.sql:1 is the rule: "every rate is a row, there
   are no rates in code". Searched: `products` (010/015) models one-off
   purchases with a `default_price` PREFILL and has no recurring concept;
   `config_defaults` (052) has no price rows for tiers; nothing else in
   `db/` carries one. The rebuild plan's addendum — which names the tiers — is
   not in this repository either (`grep -ri "finance os"` and `grep -ri
   addendum` return one comment inside 054_tradelines.sql and nothing else).
   **Consequence:** every subscription written today has `price_cents = NULL`
   until somebody supplies the prices as rows. That is the honest state, and the
   NULL is preserved end to end rather than defaulted. **Somebody has to decide
   where tier prices live** — a `subscription_tiers` table, or rows in
   `products` with a recurring flag — before this can bill anything.
2. **`npm run lint` does not exist in this repository.** CLAUDE.md §6 lists it
   as a gate. `package.json` has `migrate`, `artifact`, `diagrams`,
   `diagrams:check` and `test`. There is no ESLint config file either. W2 could
   not run gate 1 because it is not there.
3. **`npx tsc --noEmit` does nothing here.** There is no `tsconfig.json`, so
   tsc has no inputs and prints its help text with exit code 0 — a green result
   that checked zero files. Gate 2 of §6 is currently vacuous for everyone, not
   just W2. (One `.ts` file exists: `src/lib/rbac.ts`.)
4. **The `docs/journeys/` directory in CLAUDE.md §4 does not exist.** `docs/`
   contains `diagrams/` and `workflows/` only. There are no `-intended.md` or
   `-actual.md` files and no `docs/journeys/CHANGELOG.md` to append to. W2 built
   no user-facing flow, so nothing was owed either way — but the next workflow
   that does build one should know the journey scaffolding is absent, not
   missing a file.
5. **`docs/compliance/` (CLAUDE.md §7) does not exist either.** W2 flagged this
   change for compliance review on the strength of the rule text alone; there
   were no domain rules on disk to read first.
6. **The repo has three copies of `withTransaction`** (`src/documents/register.mjs`,
   `src/inquiries/work.mjs`, `src/pii/index.mjs`). W2 did not add a fourth:
   `changeTier` is a single data-modifying CTE and needs no transaction. Noted
   because the next writer who needs one will otherwise make it four.
7. **The `conversations` pg suite is order-dependent too, like the `inquiries`
   suites the trap note names.** Running the full suite against a database that
   had already had pg tests run on it failed 7 `conversations` tests on the
   first pass and 0 on the second. On a virgin database the same code passes
   both passes. Nothing in W2 touches `conversations`; recorded so the next
   person who sees those 7 names does not go looking for a cause in their own
   diff.
8. **`src/tradelines/index.mjs` defines its own `toCents`/`fromCents`** rather
   than using `src/commissions/money.mjs`, and they behave differently
   (tradelines returns a number from `fromCents`; money returns a string). W2
   used `money.mjs` as instructed. Not touched — out of scope — but two money
   modules with the same function names is the kind of thing that surfaces
   months later.

### Blockers

None. W2 finished inside its fence.

### What W2 did NOT build, restated for whoever picks this up

No bank linking or Plaid. No alerts. No soft-pull triggering. No HTTP endpoint
of any kind — including no endpoint that charges a card. No billing run, no
scheduler, no `next_charge_at`. No browser extension and no credential
scraping, ever: both are issuer-banned and breach-shaped, and there is nowhere
in this schema to put what they would collect.

---

## W3

**Task:** one-tap soft pull for an existing client (addendum §8), migration block
077 only. `status: done`

**What changed in plain language:** the system can now record that somebody asked
for a client's credit to be checked. Before this, when a credit check happened,
there was no record anywhere of who asked for it or why — only the answer that
came back. Now every request is written down: who tapped the button, which
client it was for, when, why, what it cost, and which credit report answered it.
A request that cannot say who asked for it is refused outright.

**Nothing sends anything.** Tapping the button writes a row that says "somebody
asked". No credit bureau is contacted. There is no code anywhere in this change
that could contact one, and no setting that turns one on. When a real credit
provider is connected later, the place it plugs in is marked and empty.

---

### Assumptions recorded (CLAUDE.md §2 and §3 were overridden for this run)

The owner told me to keep going rather than stop and ask. These are the calls I
made without asking. Each one is a place where a different answer would change
the work, so each is worth a look.

1. **Who is allowed to tap it.** Four employee roles — owner, admin, closer,
   funding advisor — plus the client themself, for their own file only. Setters
   and inquiry specialists are refused. I copied the reasoning from
   `api/pii.mjs`, which is deliberately narrower than the general staff set: a
   setter qualifying a lead has no business pulling that lead's credit. **If the
   owner wants inquiry specialists included, that is a one-line change to
   `SOFT_PULL_ROLES` in `api/finance/soft-pull.mjs`.**

2. **A client tapping counts as attribution.** The addendum says "a client with a
   token on file taps once". I read that as the client themself being a valid
   requester, so the ledger records two kinds of requester — staff and client —
   and stores the client's *account* id, since that is who tapped. A client can
   only ever request against their own file.

3. **Consent is not modelled here.** `c-00-crs-soft-pull-request` has a documented
   gap (workflow-migration-table.md, finding 15) about a missing
   `crs_softpull_consent` gate. I did **not** build a consent gate, because that
   is the paid-diagnostic path's rule and inventing a consent model for the
   on-demand path would be guessing at a compliance requirement. **This is the
   biggest open question in this unit — see COMPLIANCE, below.**

4. **A second tap returns the first request rather than starting a second.**
   Since nothing transmits, every request stays at `queued` forever, so this
   means the *first* request a client makes blocks later ones until somebody
   resolves it. I put that guard in code rather than in the database precisely so
   it can be changed without a migration once there is something that moves a row
   out of `queued`. The database-level version of that guard would have been a
   permanent trap.

5. **No event name was added.** `src/events/canonical.mjs` is untouched. Three
   names are *proposed* in `src/finance/PROPOSED-EVENTS.md`, with my reading that
   none of them is worth adding yet.

6. **`subscription_id` is a plain column with no foreign key.** W2 owns the
   subscriptions table and this migration has to apply to a database where that
   table does not exist. The id is carried, not validated. A later migration can
   add the key once the table it points at exists.

7. **Cost is taken in cents and refused if it looks like dollars.** A caller
   sending `12.5` is sending dollars into a cents column; that is a 400, not a
   rounding. An absent cost stays NULL, which means *unknown* — never *free*.

---

### COMPLIANCE REVIEW REQUIRED

This change touches credit-pull behaviour, which is on the flag list in
CLAUDE.md §7. Two specific things a human has to decide before this is used
against a real bureau:

1. **Is a recorded reason enough authorisation, or is a consent record needed?**
   Today the ledger requires a *stated reason* from the person who tapped. It
   does not require a *consent artefact from the client*. For the paid path there
   is a consent document kind already (`soft_pull_consent` in
   `src/documents/kinds.mjs`) and an open finding that C-00 never checks it. If
   the on-demand path needs the same gate, it belongs in
   `requestSoftPull()` and it is a small change — but it is a compliance answer,
   not an engineering one, so I did not guess at it.

2. **A client tapping for their own file is a permissible purpose under FCRA;
   an employee tapping is a different question.** The ledger records which of
   the two happened, so the record is there either way. Whether the employee
   path needs additional standing recorded per pull is the second decision.

Nothing here ships a pull. Both questions can be answered before the provider
seam is filled in, not after.

---

### Files touched

| File | Change |
|---|---|
| `db/migrations/077_soft_pull_requests.sql` | new — the `soft_pull_requests` ledger table, three CHECK constraints, three indexes, and a BEFORE UPDATE trigger making the attribution facts write-once. |
| `src/finance/soft-pulls.mjs` | new — the service module. `requestSoftPull`, `fulfilSoftPull`, `closeSoftPull`, `listSoftPullRequests`, `openRequestFor`, `getSoftPullRequest`, plus the validators and `boundedLimit`. |
| `src/finance/soft-pulls.test.mjs` | new — 60 unit tests, no database. |
| `src/finance/soft-pulls.pg.test.mjs` | new — 20 Postgres tests: the refusals hold at the table, and a result lands through `ingestCrsResult`. |
| `src/http/finance-soft-pull.pg.test.mjs` | new — 21 Postgres tests against the endpoint. |
| `api/finance/soft-pull.mjs` | new — `GET` / `POST /api/finance/soft-pull`. |
| `src/finance/PROPOSED-EVENTS.md` | new — three proposed event names; `canonical.mjs` NOT edited. |
| `netlify/functions/api.mjs` | `finance/soft-pull` added to `ROUTES`, with the import. Routed in the same commit as the handler. |
| `docs/workflows/finish-the-build.md` | new — this board. |

**Nothing in the DO-NOT-TOUCH list was touched.** `src/shifts/**`,
`src/commissions/**`, `src/mail/**`, `db/migrations/075/076/078/079` and
`public/app/**` are unmodified. Migration block 077 is the only migration added.

### Exports added

`src/finance/soft-pulls.mjs`:
`SoftPullError`, `SOFT_PULL_STATUSES`, `REQUESTER_KINDS`, `normalizeRequester`,
`normalizeReason`, `normalizeCostCents`, `costDisplay`, `decorate`,
`boundedLimit`, `openRequestFor`, `requestSoftPull`, `fulfilSoftPull`,
`closeSoftPull`, `listSoftPullRequests`, `getSoftPullRequest`.

`api/finance/soft-pull.mjs`: default handler export.

**Nothing existing changed shape.** No export was renamed or removed, and no
other module's behaviour was altered. `src/tradelines/store.mjs` is imported and
untouched. Another workflow can take this branch without adjusting anything.

### Routes added

`GET  /api/finance/soft-pull?client_id=<uuid>[&limit=]` → the pull history.
`POST /api/finance/soft-pull` `{ client_id, reason, cost_cents?, subscription_id?, idempotency_key? }`

### Schema added

One table, `soft_pull_requests`. No existing table, view, index or constraint was
altered. Applies to an empty database and re-applies as a no-op.

---

### Verification actually run

Against real Postgres 16, not reasoned about:

```
077 applies to an empty database        51 migrations, clean
077 re-applies                          0 applied; raw SQL re-run exits 0 with only "already exists" notices
npm test with DATABASE_URL unset        1947 tests · 0 fail · 195 skipped
npm test against Postgres (run 1 and 2) 2443 tests · 24 fail · 8 skipped
baseline on main, same database         2342 tests · 24 fail · 8 skipped
failing test NAMES, branch vs baseline  28 vs 28 — identical sets, zero new names
new unit tests                          60 pass
new pg tests                            20 + 21 pass
```

The failing-name lists were diffed, not the totals. CLAUDE.md §12 is right that
totals move for reasons that have nothing to do with the change.

### Mutation checks

Twelve deliberate breakages, each reverted after. Every one was caught.

| # | Mutation | Caught by |
|---|---|---|
| 1 | Attribution guard removed — a missing requester is invented | 11 unit + 1 pg |
| 2 | Reason guard removed — a blank reason becomes "unspecified" | 17 unit + 1 pg |
| 3 | Double-tap guard removed | 1 unit + 1 pg + 1 http-pg |
| 4 | Session gate widened — anonymous callers accepted | 2 http-pg |
| 5 | Role gate widened to any staff | 3 http-pg |
| 6 | Client-ownership check removed | 2 http-pg |
| 7 | `ingestCrsResult` replaced by a second, local parser | 1 unit + 2 pg + 1 http-pg |
| 8 | Mis-join guard removed — another client's file may answer | 1 pg |
| 9 | `soft_pull_requests_requester_ck` dropped in the database | 2 pg |
| 10 | `soft_pull_requests_reason_ck` dropped in the database | 1 pg |
| 11 | Immutability trigger dropped in the database | 1 pg |
| 12 | Route removed from `ROUTES` | 1 routes test |

9 through 11 matter most: they are the difference between a rule enforced by the
module that usually writes, and a rule enforced by the database against any
writer at all.

### Findings — read these

1. **`btrim(reason) <> ''` does not do what it looks like it does.** Postgres's
   `btrim` default trim set is the SPACE CHARACTER ONLY, so a reason of tab plus
   newline passed the check and landed in the table looking like an answer. My
   first version of 077 had it. The Postgres test caught it because it asserts
   against the table rather than against the module; the unit test could not
   have, because JavaScript's `.trim()` handles tabs correctly. The constraint is
   now `reason ~ '[^[:space:]]'`. **Worth checking wherever else this repo uses
   `btrim(x) <> ''` as a non-blank check.**

2. **The `c-00-crs-soft-pull-request` consent gap is still open and this unit
   does not close it.** See COMPLIANCE above.

3. **Nothing calls `fulfilSoftPull()` in production.** Same shape as W3's earlier
   finding about `autoCloseStale()`. The function is written, tested against real
   Postgres and reachable, and no code path invokes it, because the thing that
   would invoke it is the provider client that deliberately does not exist. That
   is by design for this unit, and it is exactly the class of half-dead feature
   AUDIT-FINDINGS.md warns about, so it is written down here rather than left to
   be discovered.

4. **`npm run lint` and `npx tsc --noEmit` do not exist in this repository.**
   CLAUDE.md §6 lists both as required gates. `package.json` has no `lint`
   script, there is no TypeScript, and no linter is a dependency (the only two
   dependencies are `pg` and `inngest`). I could not run them and did not add
   them — adding a linter is a new dependency and out of scope. **Someone should
   either add them or amend §6, because right now the definition of done names
   two checks that cannot be performed.**

5. **`docs/journeys/` does not exist.** CLAUDE.md §4 requires the `-actual.md`
   journey diagram to be updated in the same commit as any code change touching a
   flow, and requires an append to `docs/journeys/CHANGELOG.md`. Neither the
   directory nor the changelog is in this repository. There was no intended
   journey to read before building and no actual journey to update. I did not
   create the directory — authoring the first journey file for a flow I only
   partly own would be inventing the source of truth that §4 says agents must not
   author. **The client journey is the one this unit touches; whoever owns the
   intended journeys should decide whether a one-tap pull belongs on it.**
