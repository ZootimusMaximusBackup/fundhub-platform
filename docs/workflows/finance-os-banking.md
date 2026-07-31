# finance-os-banking

Shared board for the finance-os-banking batch (W5 Plaid, W6 liability ingestion,
W7 recurring detection, W8 the financial model). Each workflow claims its task
here, writes its manifest here when done, and reads this file before starting.

This file did not exist when W8 ran; W8 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## W8

**Task:** the cash-flow projection model, the payment window, and reminder
storage (migration 087). `status: done`

**What changed in plain language:** the system can now work out, day by day,
what a client's bank balance will look like for the next few weeks, and use that
to say when a credit-card payment can safely go out. It shows its working — for
every day you can see exactly which bills and which money coming in produced
that number. When it does not have enough information to be sure, IT SAYS SO AND
GIVES NO DATE, instead of guessing. There is also a new table for holding
reminders. It stores them. It does not send them, and it cannot be switched on
to send them.

---

### The rules this unit was given, and how each one was honoured

| Rule | How |
|---|---|
| Nothing transmits | No `fetch`, no email, no SMS, no push anywhere in `src/banking/`. `cashflow_reminders` has no `sent_at`, no `channel`, no `status`, no retry counter, no scheduler and no activation flag. A pg test asserts the absence of all twelve of those column names, so adding one later fails the suite. |
| Thresholds are rows, not constants | `src/banking/cashflow.mjs` holds no operator number at all. Thresholds arrive in a `thresholds` argument; every absent one is reported by name in `thresholdGaps`. **There is no table in this schema that holds any of them — that gap is the finding below.** |
| Money is integer cents | Every amount is an integer count of cents, validated with `Number.isSafeInteger`. No division and no rounding anywhere, so there is nothing to round. `fromCents` from `src/commissions/money.mjs` renders the display strings. Numeric strings are REFUSED, not parsed — see the assumption on that below. |
| NULL survives | An unknown account balance refuses the whole projection with `UNKNOWN_BALANCE`; it is never read as zero. A card with no minimum payment becomes a blind spot, not a zero charge. |
| No W5/W6/W7 imports | `cashflow.mjs` imports exactly one thing: `fromCents`. Balances, bills and liabilities are parameters. This is what let the unit be finished and fully tested before those land. |

---

### Assumptions recorded (CLAUDE.md §2 and §3 were overridden for this run, so
these were decided rather than asked)

1. **A recurring bill arrives as explicit dated `occurrences`, not a recurrence
   rule.** `cashflow.mjs` does not expand "the 15th of every month" into dates.
   Month-end semantics are a real decision with no source here (does a bill on
   the 31st fall on 28 February, on 1 March, or not at all?), and DETECTING
   recurrence is W7's job by the scope fence. **W7 should hand over dates.** If
   W7 instead produces a rule, the expansion belongs in W7 or in a new module,
   not here.

2. **`confidence` is a number from 0 to 1, or null.** A bill may also carry
   `confirmed: true`, which makes it certain with no threshold involved. W7 owns
   the shape; if it differs, this is the seam to change.

3. **A numeric string is refused as a money value rather than parsed.**
   `money.mjs`'s `toCents("1050")` means one thousand and fifty DOLLARS. If this
   module also accepted `"1050"` and read it as ten dollars fifty, the repo would
   hold two contradictory readings of one string, a factor of 100 apart in a bank
   balance. **This matters for W5/W6:** a `bigint` column comes back from
   node-postgres as a STRING, so the read path must convert deliberately.

4. **Card liabilities contribute their MINIMUM payment on the due date, never
   the statement balance.** How much above the minimum to pay is the decision
   `paymentWindow()` supports; baking it into the projection would prejudge it.

5. **The zero line is the specification, not a threshold.** The task says
   "without driving the projected balance below zero", so zero is the floor and
   needs no row. A buffer ABOVE zero is a policy and does need one; when it is
   absent the floor stays at zero and `minBufferCents` is reported as a gap.

6. **`paymentWindow()` recommends the LATEST feasible landing date.** The
   owner's question is about keeping outgoing money from wrecking cash flow, and
   money that stays in the account longer is available for whatever lands first.
   Every feasible date is returned, so a person who wants slack can take one.

7. **`minimumPayment` from the task was named `minimumPaymentCents`.** Units in
   the name is this repo's rule (054: "integer cents in the column, dollars at
   the boundary").

8. **`subject_id` on `cashflow_reminders` has NO foreign key.** The tables it
   would point at (card liabilities, recurring bills) do not exist yet — W6 and
   W7 own them. Soft link plus a `subject_kind` discriminator, exactly as 065
   handled `mail_universe.campaign_id`. **W6/W7: when your tables land, the
   tightening is a later migration and it must backfill first.**

9. **An `expectedInflows` parameter was added.** The task's named signature did
   not list one, but it asked for "every inflow and outflow that produced it",
   and inflows have to come from somewhere. It is optional; an empty list means
   no income is modelled, which understates cash and is therefore safe.

---

### FINDINGS — absences reported rather than filled in

**1. There is no row anywhere in this schema for any cash-flow threshold.**
This is the headline finding and it is the reason `paymentWindow()` will not
give an initiate-by date. Checked against `db/schema` and `db/migrations`, not
against a plan: there is no `cashflow_settings` table, no `banking_config`
table, no threshold column on `orgs`, and `src/config/` holds three pure
classifiers with no operator numbers in them. Three values have no home:

| Threshold | What it decides | Consequence of it being missing |
|---|---|---|
| `minBufferCents` | how much cushion must remain after a payment | floor stays at the zero the task states; reported as a gap |
| `confidenceFloor` | how sure a detected bill must be to count as certain | scored bills stay unconfirmed and are priced in the worst case; nothing is dropped, nothing is promoted |
| `settlementLeadDays` | how many days a payment takes to post | **`initiateByDate` is null with a stated reason.** Assuming same-day posting is a claim about payment rails that is often false, and being wrong is a missed payment |

None of these were guessed at. **Deciding them is an owner call, and a row is
needed before the model can give a complete answer.**

**2. `docs/journeys/` does not exist.** CLAUDE.md §4 describes eight tracked
journeys, `-intended.md` / `-actual.md` pairs and a `docs/journeys/CHANGELOG.md`.
None of it is on disk — `docs/` contains only `diagrams/` and `workflows/`. No
journey was updated by this unit because there are none to update, and §4 states
plainly that agents do not author `-intended.md`. Reported, not invented.

**3. CLAUDE.md §6's first two gates cannot run in this repo.** `npm run lint` —
there is no `lint` script in `package.json` and no eslint config anywhere.
`npx tsc --noEmit` — there is no `tsconfig.json` and no TypeScript; the codebase
is plain ESM `.mjs`. Both were attempted and both are unrunnable. `npm test` and
`npm run diagrams:check` do run and both are green.

**4. `src/calculators/deal-funding.mjs` is a divergence risk worth watching.**
It answers a different question (how much can be drawn across cards, and in what
order) in floating-point dollars, and carries hardcoded `utilizationThreshold =
0.30` and `minPaymentPct = 0.02` defaults — the same shape of defect that was
just removed from `src/shifts/timesheet.mjs`. `cashflow.mjs` deliberately
computes none of its numbers and shares no constants with it. **Not touched:
outside this task's scope.** Flagged for whoever owns it.

**5. A reminder that is about neither a card nor a bill has no home.**
`subject_kind` is a closed two-value set, per the task's wording ("about which
liability or bill"). A finding like "we cannot project your cash flow because an
account balance is unknown" is about an ACCOUNT and cannot be stored. Widening
the enum was not done on a guess about who such a reminder would be for.

---

### Files touched

| File | Change |
|---|---|
| `src/banking/cashflow.mjs` | New. `project()`, `paymentWindow()`, `CashflowInputError`. Pure — no I/O, no clock, no database. Imports only `fromCents`. |
| `src/banking/cashflow.test.mjs` | New. 86 pure unit tests. |
| `src/banking/reminders.mjs` | New. `createReminder`, `dueReminders`, `forClient`, `acknowledge`, `getReminder`, `ReminderError`, and the three frozen vocabularies. |
| `src/banking/reminders.pg.test.mjs` | New. 26 tests against real Postgres; skips cleanly with `DATABASE_URL` unset. |
| `db/migrations/087_cashflow_reminders.sql` | New. One table, four indexes, one trigger. `IF NOT EXISTS` throughout. |
| `docs/workflows/finance-os-banking.md` | New. This board. |

**No existing file was modified.** Nothing was renamed, nothing was refactored.

### Exports added

```
src/banking/cashflow.mjs   project, paymentWindow, CashflowInputError
src/banking/reminders.mjs  createReminder, dueReminders, forClient, acknowledge,
                           getReminder, ReminderError,
                           SUBJECT_KINDS, REMINDER_KINDS, ACK_BY_KINDS
```

### Routes affected

**None.** No handler was added, so `netlify/functions/api.mjs` `ROUTES` is
untouched and `src/http/routes.test.mjs` still passes (14/14). An HTTP surface
for this unit is deliberately not built — it was not asked for, and the scope
fence rules out a UI screen.

### Journeys impacted

**None**, and none could be — see finding 2.

### Schema added

`cashflow_reminders` — see the header of `db/migrations/087_cashflow_reminders.sql`
for the full reasoning. Dedupe key is
`(org_id, client_id, subject_kind, subject_id, reminder_kind, surface_at)`;
`body` is deliberately outside it, so rewording a template does not double every
outstanding reminder.

### Verification actually run

```
Migration 087
  applies clean on a database that already had 50 files       ✔
  re-applies through migrate.mjs as a no-op (0 applied)        ✔
  the raw SQL applied directly a 2nd and 3rd time             ✔ no-op, no error
  51 files apply from scratch on a virgin database             ✔

Unit tests (no DATABASE_URL)
  src/banking/cashflow.test.mjs          86 tests, 86 pass, 0 fail
  full suite                           1999 tests, 0 fail, 221 skipped

Postgres tests (DATABASE_URL set)
  src/banking/reminders.pg.test.mjs      26 tests, 26 pass, 0 fail
  full suite                           2454 tests, 8 skipped
  failing test NAMES vs the same suite with src/banking removed:
                                       BYTE-IDENTICAL (28 pre-existing, all in
                                       the creative / partner modules; none in
                                       src/banking)

Mutation testing              39 deliberate defects injected, 39 killed, 0 survived
  cashflow.mjs   27/27   incl. both sides of every boundary, the pessimistic-track
                         rule, the blind-spot refusal, and each threshold being
                         filled in with a picked number
  reminders.mjs  12/12   incl. org scoping on all three reads, first-ack-wins,
                         and the due-at-exactly-asOf boundary

npm run diagrams:check                  up to date (12 files)
npm run lint / npx tsc --noEmit         NOT RUNNABLE — see finding 3
```

### For the other workflows in this batch

- **W5 / W6:** convert `bigint` cents columns to numbers at your boundary.
  `cashflow.mjs` refuses numeric strings on purpose (assumption 3).
- **W6:** `tradelines` (054) has no `due_date`, no `statement_close` and no
  `minimum_payment` — those three are what a payment reminder is actually about,
  and `cashflow.mjs` treats a card missing any of them as a BLIND SPOT that
  refuses the whole payment window. They are the highest-value columns you can
  add. Also note `cards` in `001_init.sql` is a pipeline kanban card, not a
  credit card.
- **W7:** hand over dated `occurrences`, plus either `confidence` (0–1) or
  `confirmed: true`. See assumptions 1 and 2.
- **Anyone writing reminders:** `surface_at` is yours to supply and there is no
  default. If you find yourself wanting "due date minus N days", N is finding 1
  — report it, do not pick it.
