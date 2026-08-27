# finance-os-banking

Shared board for the finance-OS banking batch (W5–W10). Each workflow claims
its task here, writes its manifest here when done, and reads this file before
starting.

W7 created this file. Other workflows should append their own `## W<n>` heading
below rather than editing anyone else's section.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| W5 | plaid-banking-w5 (#52) | Plaid link: migrations 080–082 (`plaid_items`, `bank_accounts`, entity kind), adapter seams | **done** |
| W6 | card-liabilities-w6 (#51) | Card liabilities: migrations 083–084, liability parser | **done** |
| W7 | claude/recurring-bills-detection-49eqxz (#44) | Migrations 085–086 (`bank_transactions`, `recurring_bills`), pure recurring-bill detection | **done** |
| W8 | claude/cashflow-projection-model-b2tfb4 (#42) | Projections and reminders: migrations 087–088, projector | **done** |
| W9 | — | `finance-os.html` + read endpoint | pending |
| W10 | — | Banking surface, after W5–W8 merge | pending |

---

## W7

**Task:** aggregate what a client actually pays out, so cash flow can be
reasoned about. `status: done`

**What changed in plain language.** The system can now keep a copy of a client's
bank transactions, and work out which of them are bills that repeat — rent,
insurance, a streaming subscription. For each one it says how much, how often,
and when the next one is probably due. Most importantly, it says **how sure it
is**, and when it is not sure it says *"I do not know, and here is why"*
instead of making up a date that looks real.

Two charges is not a pattern. The system will never call that a bill.

**Nothing connects to a bank.** No bank is contacted, no login is stored,
nothing is fetched. This is a place to put the data and the arithmetic to read
it. Actually getting the data from Plaid is W5's job.

### Files added

| File | What it is |
|---|---|
| `db/migrations/085_bank_transactions.sql` | The `bank_transactions` table: one row per transaction per account, integer cents, a unique index that makes a re-sync impossible to double-count. |
| `db/migrations/086_recurring_bills.sql` | `recurring_bills` + `recurring_bill_transactions`: the detected bills and the transactions that prove each one. |
| `src/banking/recurring.mjs` | The detector. Every function pure — no database, no network, no clock. |
| `src/banking/store.mjs` | The writer. The only thing in the repo that inserts into either table. |
| `src/banking/cashflow-seam.mjs` | The W7 -> W8 handover. Closes three real breaks between the detector's output and the projector's input contract. |
| `src/banking/cashflow-seam.test.mjs` | 21 pure unit tests for the seam. |
| `src/banking/recurring.test.mjs` | 63 pure unit tests for the detector. |
| `src/banking/store.test.mjs` | 19 unit tests for the writer, against a fake that models no schema. |
| `src/banking/recurring.pg.test.mjs` | 20 tests against real Postgres. Skips cleanly with no `DATABASE_URL`. |
| `src/banking/PROPOSED-EVENTS.md` | Event names proposed, not added. `src/events/canonical.mjs` is untouched. |
| `docs/workflows/finance-os-banking.md` | This board. |

Nothing existing was modified. **Zero files changed outside `src/banking/`,
`db/migrations/` and `docs/workflows/`.**

### Exports added — `src/banking/recurring.mjs`

| Export | Kind | Notes |
|---|---|---|
| `detectRecurringBills(rows, { now, accountIsBusiness?, accountIds? })` | function | The entry point. `now` is REQUIRED and throws if absent. Returns `{ detectedAsOf, bills, candidates, rejected, excluded }`. |
| `toBillRow(bill, { orgId })` | function | Shapes a detected bill into migration 086's exact column names. Throws on a non-outflow amount. |
| `normaliseMerchant(raw)` | function | Raw provider descriptor -> stable grouping key. |
| `medianCents(values)` | function | Integer-cents median. |
| `parseDay(value)` / `formatDay(day)` | function | Calendar-day handling for `date` columns and `YYYY-MM-DD` strings. |
| `isOutflow` / `isInflow` | function | The sign convention, as predicates. |
| `capLabelForEvidence(label, n)` | function | The two-occurrence cap. Exported so it can be tested directly. |
| `SIGN_CONVENTION`, `CADENCES`, `CADENCE_NAMES`, `PRESENTABLE_LABELS`, `REASONS`, `EXCLUSION_REASONS`, `MAX_CONFIDENCE` | const | Frozen. |

### Exports added — `src/banking/store.mjs`

| Export | Notes |
|---|---|
| `saveDetection(db, result, { orgId, includeCandidates? })` | Persists a whole run — bills, candidates and evidence — in ONE transaction. Never stores `rejected` or `excluded`. |
| `upsertRecurringBill(db, bill, { orgId })` | Upserts on `(bank_account_id, merchant_key, cadence)`. |
| `replaceEvidence(db, billId, ids)` | Replaces, never appends. Returns `{ linked, unidentified }`. |
| `listRecurringBills(db, { orgId, ... })` | **`presentableOnly` defaults to TRUE** — a caller who has not thought about confidence gets no guesses. |
| `getBillEvidence(db, billId)` | The charges behind one stored bill. |

**No imports from W5, W6 or W8.** The detector takes account ids and rows as
parameters. Its only repo import is `roundHalfUp` from
`src/commissions/money.mjs`; the writer imports only `toBillRow` from the
detector.

### *** W8: READ THIS. THE TWO MODULES DID NOT FIT. ***

W7 and W8 were built in parallel against the same scope fence and had never been
run against each other. Reading W8's real input contract
(`src/banking/cashflow.mjs` on `claude/cashflow-projection-model-b2tfb4`)
against W7's real output shows **three breaks**. `src/banking/cashflow-seam.mjs`
closes all three, on this side, because W8's own header says the recurrence
expansion is W7's job.

| # | Break | What would have happened |
|---|---|---|
| 1 | **Confidence scale.** W8 validates `recurringBills[].confidence` as **0–1** and throws outside it. W7 emits `confidencePct`, an integer **0–100**. | **SILENT.** Pass nothing and W8 classifies every bill `unconfirmed` with the reason "no confidence was supplied" — a complete, plausible cash-flow projection in which every detected bill has quietly been downgraded, and no error anywhere. Pass `88` and it throws instead. |
| 2 | **Sign.** W8 runs `occurrences[].amountCents` through `requireNonNegativeCents()` and applies `direction: "out"` itself. W7's amounts are **negative** by 085's convention. | Throws — but the obvious fix at a call site is `Math.abs(...)`, which is the un-reviewed sign flip 085 calls the most expensive mistake available here. It now happens once, in one tested place. |
| 3 | **Dates.** W8 has no recurrence engine and says so: *"W7 detects the pattern and hands over dates; this module adds up money."* W7 emitted ONE `nextExpectedDate`. | Nothing on either side turned a cadence into the dated series W8 wants. Projections would simply contain no bills. |

**Break 1 is the dangerous one.** 2 and 3 fail loudly. 1 produces a confident,
complete, wrong answer.

Use `toCashflowBills(result, { from, to })` — it returns `{ recurringBills,
skipped }` in exactly W8's documented shape. `PRESENTABLE_CONFIDENCE_FLOOR`
(0.55) is exported so W8's `thresholds.confidenceFloor` can be set to the value
that makes its classification agree with this repo's own medium/high split,
rather than someone inventing 0.8 at a call site.

**The honesty rule survives the crossing, which is the point.** A bill with no
confident next date expands to ZERO occurrences and carries a `skippedReason`.
It is never given a plausible first date so the projection has something to
draw — a date invented at the seam is indistinguishable, three modules
downstream, from one the detector actually stood behind.

A fourth thing came out of building it: **`nextExpectedDate` can be clamped**
(a bill charged on the 31st predicts the 30th in a 30-day month), so carrying it
forward pins the bill to the 30th permanently. The detector now publishes
`anchorDayOfMonth` — the real billing day — because it cannot be recovered from
the clamped date. The seam's first version had exactly that bug and the
month-end test caught it.

### Compatibility checked against the other branches

- **`bank_accounts.id` is `uuid`** on `plaid-banking-w5`, so the FK this
  workflow deferred is addable exactly as described. No change needed here.
- **No migration-number collision.** W2 has 075–076, W3 077, W4 078–079, W5
  080–082, W6 083–084, W7 085–086, W8 087. Verified by listing every branch.
- **`src/banking/` is shared with W5, W6 and W8** and no filenames collide
  (`plaid.mjs`, `card-liabilities.mjs`, `cashflow.mjs`, `reminders.mjs` vs this
  workflow's `recurring.mjs`, `store.mjs`, `cashflow-seam.mjs`).
- **W5's `entity_kind` is three-valued** (`unknown`/`personal`/`business`) with
  a `entity_kind_source`. This workflow's `accountIsBusiness` map is boolean and
  a naive wiring — `entity_kind === 'business'` — would turn **`unknown` into
  `false`**, i.e. silently assert "personal" about an account nobody has
  classified. W10's own brief says `unknown != personal`. **The map is
  three-state-safe as written** (absent -> `null` with a reason), but the
  correct wiring is: pass an entry ONLY for `personal` and `business`, and leave
  `unknown` out of the map entirely. Recorded here because the wrong version is
  the one that looks natural.

### Routes, journeys, events — all unchanged

- **No API handler and no `ROUTES` entry.** Nothing to route: this workflow
  ships a table and a pure function. `src/http/routes.test.mjs` is unaffected
  and still passes.
- **No journey `-actual.md` was updated and no changelog line was appended.**
  None of the eight tracked journeys (`client`, the five `role-*`, `affiliate`,
  `white-label`) gains, loses or changes a step: there is no screen, no
  endpoint, no role gate and no workflow handler in this change. A journey
  diagram edit here would be describing something a user cannot reach.
- **`src/events/canonical.mjs` is untouched.** Three names are proposed in
  `src/banking/PROPOSED-EVENTS.md`, one of them (`bill.changed`) argued
  *against*.

### The sign convention — stated once, enforced three times

**NEGATIVE = money left the account. POSITIVE = money came in.**

This is the opposite of Plaid's legacy `/transactions/get`, which reports a
purchase as positive. Whoever builds the ingest **must negate at that
boundary** — W5, this is the one thing to get right.

It is enforced, not just written down:

1. `085` — `CHECK (amount_cents <> 0)` and the column comment.
2. `086` — `CHECK (typical_amount_cents < 0)`. A bill that is not an outflow
   cannot be stored at all. **If an ingest forgets to negate, this is what
   fails, loudly, on the first write.**
3. `recurring.mjs` — a positive row is EXCLUDED with the reason
   `inflow_not_an_outflow`. It is never `abs()`'d.

A whole un-negated batch therefore yields zero bills and an exclusion list that
names the problem on every row — a loud, diagnosable answer instead of a
confident, plausible, completely wrong one.

### Confidence, and refusing to guess

| Band | Score | Where it lands | Meaning |
|---|---|---|---|
| high | 75–95 | `result.bills` | Safe to show as a bill. |
| medium | 55–74 | `result.bills` | Safe to show, worth a hedge. |
| low | 30–54 | `result.candidates` | **A guess. Never present this as a bill.** |
| none | 0–29 | `result.rejected` | No usable cadence. |

Low-confidence detections are returned in a **separate array** so that showing
one requires asking for it by name. A caller cannot iterate `bills` and
accidentally render a guess.

When there is no date, there is always a reason —
`two_occurrences_is_a_guess_not_a_cadence`,
`confidence_too_low_to_predict_a_date`, or
`no_occurrence_in_recent_periods_bill_may_have_ended`. Migration 086 makes this
structural: `CHECK ((next_expected_on IS NULL) <> (next_expected_unknown_reason
IS NULL))`. A row physically cannot say "I don't know" without saying why.

### Decisions made (recorded, not asked)

1. **`bank_account_id` has NO foreign key.** The `bank_accounts` table is W5's
   and does not exist yet. Inventing it here would produce two of them.
   `org_id` and `client_id` ARE real foreign keys, so tenancy is enforced even
   while the account link is soft. **See open questions.**
2. **`provider_transaction_id` is `NOT NULL`, and the unique index is total,
   not partial.** AUDIT-FINDINGS records a $5,000 payment counted twice because
   a partial index on a nullable ref is inert on NULL. No id, no row.
3. **`posted_on` only.** `authorized_on` is never substituted for a missing
   posted date — mixing them wobbles a cadence by the one-to-three days that
   turn a clean bill into an irregular one.
4. **Pending rows are excluded from detection.** A hold that later posts would
   otherwise be counted twice and manufacture a cadence out of one purchase.
5. **`is_business` is three-valued and defaults to NULL = unknown, never
   false.** It is set only from an account-level fact the caller passes in.
   Never inferred from a merchant name or category — that would be inventing a
   finance fact about a client's taxes.
6. **`confidence_pct` is an integer 0–100, not a float.** A confidence is
   compared against a threshold, and `0.7000000000000001 > 0.7` is not a
   conversation anyone should have to have.
7. **`detected_as_of` has no `DEFAULT now()`.** The writer must pass the same
   `now` the detector was given. A default would stamp the write time instead
   of the evaluation time and re-introduce, in the schema, the hidden clock the
   module was written to avoid.
8. **Evidence is a join table, not a `uuid[]` column.** An array cannot carry a
   foreign key, so a bill could keep claiming evidence that no longer exists.
9. **Same-day charges at one merchant collapse to one occurrence** (that day's
   median amount), because nothing in the data distinguishes a double-post from
   two purchases. All transactions stay as evidence and
   `sameDayCollapsedDays` reports that it happened.
10. **Re-detection upserts** on `(bank_account_id, merchant_key, cadence)`.
    Without it, weekly detection would leave 52 rows for one subscription and
    any sum would report a client's outgoings at 52× their true value.
11. **The write path is code, not test SQL.** The first cut of this workflow
    hand-rolled the `INSERT ... ON CONFLICT` inside `recurring.pg.test.mjs`.
    That is the opening move of the 031_invoices failure — column names living
    in a test, a migration moving them, and the test being the last place
    anybody looks. `src/banking/store.mjs` is now the only writer and the pg
    test calls it instead of imitating it.
12. **A bill and its evidence are written in ONE transaction.** A half-written
    bill asserts a client pays $54.99 a month with nothing behind it, and is
    indistinguishable from a well-evidenced one at every call site that does
    not join.
13. **`listRecurringBills` hides low-confidence rows by default.** Seeing the
    guesses takes `presentableOnly: false` — a deliberate act with a name on
    it. The detector's `bills` / `candidates` split is carried through to the
    read side so it cannot be lost in between.
14. **The sign convention is FINAL, not open for the batch to revisit.**
    Negative = money out. It is enforced by `recurring_bills_outflow_ck` and by
    the detector's `inflow_not_an_outflow` exclusion. W5: negate at the Plaid
    boundary. Anything else fails on the first write, which is the intent.
15. **The read gate for a future endpoint is `ROLE_SETS.FINANCE`
    (owner/admin), not `STAFF`.** Recorded here as a decision so W9/W10 do not
    have to re-litigate it. This is a client's personal bank ledger;
    AUDIT-FINDINGS already records inquiry data reaching closers through a
    `STAFF`-gated endpoint added after the fact.

### Compliance

**No `COMPLIANCE REVIEW REQUIRED` flag on this change.** It touches none of the
flagged surfaces: no dispute logic, no credit-repair messaging, no fee timing,
no refund behaviour, no payment rails, no consent capture, no credit-pull type.
It writes no customer-facing text and makes no claim about credit outcomes.

**Two things for whoever builds on this**, both in `PROPOSED-EVENTS.md`:

- A `bill.changed` event feeding a customer notification (*"your internet bill
  went up"*) WOULD be a compliance surface — a claim about a client's finances
  drawn from an inference this module is explicit about not being certain of.
  It is proposed and argued against.
- Any consumer of `next_expected_on` must also receive the confidence and, when
  the date is null, the reason. A predicted date travelling alone loses exactly
  the information that keeps it honest.

### Verification

```
migrations         52 apply clean on a virgin database; re-run applies 0
unit tests         105 pure (65 detector + 19 writer + 21 seam), no database
pg tests           20 against real Postgres, all pass; skip cleanly unset
npm test (no DB)   2012 tests · 1797 pass · 0 fail · 215 skipped · exit 0
npm test (with DB) 2435 pass · 24 fail · 8 skipped
                   -> 24 is the pre-existing baseline on this repo
                   -> NEW FAILING NAMES: none, over three consecutive runs
                      on a fresh database, diffed by NAME not by total
mutation check     52/52 killed (20 detector + 16 writer + 16 seam)
```

**Mutation check.** Twenty rules were deleted one at a time and the suite had to
notice each. Three survived the first pass and all three were real gaps in the
tests, now fixed:

- the two-occurrence label cap and the 95% confidence ceiling are both
  *unreachable* given the current score table, so no scenario test could ever
  exercise them. They are defence-in-depth against a future edit, so they are
  now exported and asserted directly.
- the month-end anchor test happened to pass either way, because its LAST
  occurrence was not the February-clamped one. The fixture was rebuilt so that
  it is.

The writer was mutation-checked separately, sixteen rules, and **one survived**:
deleting `WHERE org_id = $1` from `listRecurringBills` left every parameter
assertion green, because the mutation still bound `$1`. That is a tenancy filter
passing a test that could not see it. The clause is now asserted directly, and a
real cross-org read is proved against Postgres — a second org, the same account
id, zero rows.

This is AUDIT-FINDINGS' closing lesson applied: *"Mutation-test the OVER-broad
direction too. Several tests here asserted the defect ... and passed happily for
months."*

### Findings and open questions

1. **`WORKFLOW-AUTONOMY.md` does not exist in this repository.** The batch
   instructions say to read it first. It is not at the repo root or anywhere
   else in the tree. Recorded rather than guessed at; the decision rules quoted
   inline in the instruction were used instead.
2. **The `bank_accounts` foreign key is missing and must be added later.** W5:
   when `bank_accounts` lands, add a NEW migration (never edit 085 or 086 —
   `migrate.mjs` keys `schema_migrations` by `<dir>/<file>` and a re-edit is a
   silent no-op). It is a two-step: sweep or delete orphan rows FIRST, then
   `ADD CONSTRAINT`, on both `bank_transactions.bank_account_id` and
   `recurring_bills.bank_account_id`.
3. **The write path now exists, but nothing CALLS it in production yet.**
   `src/banking/store.mjs` is a real, tested writer — the gap is no longer a
   missing writer, it is a missing caller. Nothing produces `bank_transactions`
   rows, because that is W5's ingest. Still the AUDIT-FINDINGS shape
   (*"Nothing in production ever writes a sale ..."*) and still flagged, but it
   is now one wire away rather than a module away. **W5: after ingesting a
   window, call `detectRecurringBills(rows, { now })` and hand the result to
   `saveDetection(db, result, { orgId })`. That is the whole integration.**
4. **One merchant key yields at most one cadence.** Grouping is by
   `(account, merchant_key)`, so a merchant billing monthly AND annually under
   a byte-identical descriptor is reported as one bill. Providers normally send
   distinguishable descriptors and those detect as two, which is why 086 keys on
   cadence too. Splitting one descriptor needs real data to justify — a wrong
   split invents a bill that does not exist.
5. **Quarterly, semi-annual and four-weekly are not in the vocabulary.** A
   quarterly charge reads as monthly-with-two-missed and scores lower than it
   should. Adding cadences without data on how common they are means widening
   tolerance bands and merging real distinctions.
6. **The repo has no `lint` script and no TypeScript.** CLAUDE.md §6 requires
   `npm run lint` and `npx tsc --noEmit` before reporting done. Neither exists
   in `package.json` (there is no `eslint` config and no `tsconfig.json`), so
   neither could be run. Reported rather than silently skipped. The repo's Stop
   hook makes the same check and no-ops for the same reason.

---

## W8

**Task:** the cash-flow projection model, the payment window, `recordReminders`,
reminder storage (087) and the threshold settings (088). `status: done`

> **COMPLIANCE REVIEW REQUIRED — estimates shown to a consumer.**
> `recordReminders()` composes sentences quoting PROJECTED figures and PREDICTED
> dates for a client of a regulated consumer-finance product. Every body that
> carries a number says "estimated" or "projected", and two tests enforce that
> wording so it cannot be edited out for brevity. No body makes any claim about
> a credit score or a credit outcome, and a test asserts that too. Flagged, not
> blocked: this produces rows, and no row reaches a person until somebody builds
> a surface for it, which is a separate decision.

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
| Thresholds are rows, not constants | `src/banking/cashflow.mjs` holds no operator number at all — thresholds arrive in a `thresholds` argument and every absent one is reported by name in `thresholdGaps`. There was no table to hold them; **088 creates one** (`cashflow_settings`), and `src/banking/settings.mjs` is the only thing that reads it. The model stayed pure and constant-free throughout. |
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
   088 stores that zero explicitly so it can be raised deliberately — but see
   finding 1: raising it is NOT the safe direction.

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

**1. RESOLVED in 088 — the thresholds now have a home, and values.** The
original finding stood: there was nowhere in this schema to put a cash-flow
threshold. The owner said to figure it out, so `088_cashflow_settings.sql`
creates `cashflow_settings` and fills it in, following the pattern
`052_config_defaults.sql` established when the same thing happened to the
creative and hiring config — one file, so reverting to unconfigured is a single
`git revert`, and every value carried with `signed_off_at IS NULL` so it is
reported as provisional until a human confirms it.

**The three values are not equally risky, and which direction each one hurts in
is the whole story:**

| Threshold | Value | Basis | Which way it hurts |
|---|---|---|---|
| `settlement_lead_days` | **3** | `[DERIVED]` | **Asymmetric.** Too high costs a little float. Too low costs a late payment — a fee and a credit-report mark. **Errs high on purpose.** |
| `min_buffer_cents` | **0** | `[SPEC]` | **Asymmetric the other way — the trap.** A bigger buffer sounds safer and is not: it refuses MORE payment dates, pushing the payment later, risking the same missed payment. |
| `confidence_floor` | **0.800** | `[PLACEHOLDER]` | **Cannot affect safety at all.** Both sides of the floor land in the pessimistic track `paymentWindow()` tests against. |

**The derivation for 3 days**, since it is the value that mattered: a card
payment pushed from a bank account is an ACH debit, and standard ACH settles on
the *next banking day* — not instantly, and same-day ACH is a separate opted-into
product that cannot be assumed. Three things push the realistic figure above that
floor: banking days are not calendar days (a Friday start settles Monday at the
earliest — three calendar days for one banking day); the issuer still has to post
it against the card, a second step on its own cycle; and cut-off times mean a
payment started late in the day is tomorrow's payment, which a module with no
clock cannot detect. Three covers the Friday case, which is the common one a
one- or two-day figure gets wrong.

⚠️ **This is a property of a payment rail, not a universal fact.** Paying on the
issuer's own site with a debit card often posts same day; a mailed cheque takes a
week. If a rail is ever wired in, re-derive from its documented timing.

`v_cashflow_config_gaps` reports all three until signed off, with what being
wrong about each one costs — 052's rule that a default which stops being visible
is a default nobody re-examines.

**The payoff:** the payment reminder now surfaces on the day somebody has to
press the button, not the day the money must land. A reminder that arrives on the
landing date arrives too late to act on.

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

**5. `WORKFLOW-AUTONOMY.md` does not exist.** The autonomous-build directive
named it as the decision framework to read first. It is not in the working tree
and `git log --all --diff-filter=A` finds it in no branch's history. Proceeded on
the decision rules inlined in the directive itself, which were sufficient.
Reported rather than invented.

**6. `payment_window_closing` can never fire, and that is a property of the
maths.** Feasibility is monotone in the payment date: the suffix-minimum of the
projected balance is non-decreasing as the date moves later, and a payment is a
one-off outflow with no other effect, so **paying later is never worse than
paying earlier.** The safe window therefore always ends on the due date and
there is no earlier "last safe day" to warn about. The only bound carrying
information is `earliestDate`. The kind stays in 087's CHECK constraint for a
future caller with a constraint this module does not model (a promotional rate
expiring, a transfer that must clear first); nothing emits it today and
`recordReminders` records that as a runtime skip rather than leaving it to look
like an oversight.

**7. A reminder that is about neither a card nor a bill has no home.**
`subject_kind` is a closed two-value set, per the task's wording ("about which
liability or bill"). A finding like "we cannot project your cash flow because an
account balance is unknown" is about an ACCOUNT and cannot be stored. Widening
the enum was not done on a guess about who such a reminder would be for.

---

### Files touched

| File | Change |
|---|---|
| `src/banking/cashflow.mjs` | New. `project()`, `paymentWindow()`, `recordReminders()`, `CashflowInputError`. Pure — no I/O, no clock, no database. Imports only `fromCents`. |
| `src/banking/cashflow.test.mjs` | New. 103 pure unit tests, including two compliance-wording guards. |
| `src/banking/reminders.mjs` | New. `createReminder`, `dueReminders`, `forClient`, `acknowledge`, `getReminder`, `ReminderError`, and the three frozen vocabularies. |
| `src/banking/reminders.pg.test.mjs` | New. 28 tests against real Postgres; skips cleanly with `DATABASE_URL` unset. Includes the model-to-store handoff. |
| `db/migrations/087_cashflow_reminders.sql` | New. One table, four indexes, one trigger. `IF NOT EXISTS` throughout. |
| `db/migrations/088_cashflow_settings.sql` | New. `cashflow_settings` + `v_cashflow_config_gaps` + trigger. Seeds the default org; every value unsigned. |
| `src/banking/settings.mjs` | New. `loadThresholds`, `configGaps`, `SettingsError`. The only thing that reads the settings row — keeps the model pure. |
| `src/banking/settings.pg.test.mjs` | New. 16 tests against real Postgres. |
| `docs/workflows/finance-os-banking.md` | New. This board. |

**No existing file was modified.** Nothing was renamed, nothing was refactored.

### Exports added

```
src/banking/cashflow.mjs   project, paymentWindow, recordReminders, CashflowInputError
src/banking/settings.mjs   loadThresholds, configGaps, SettingsError
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

Migration 088
  applies clean, re-applies through migrate.mjs as a no-op            OK
  raw SQL applied directly twice — no duplicate settings row          OK

Unit tests (no DATABASE_URL)
  src/banking/cashflow.test.mjs         106 tests, 106 pass, 0 fail
  full suite                           2037 tests,   0 fail, 239 skipped

Postgres tests (DATABASE_URL set)
  src/banking/reminders.pg.test.mjs      28 tests, 28 pass, 0 fail
  src/banking/settings.pg.test.mjs       16 tests, 16 pass, 0 fail
  failing test NAMES vs the same suite with src/banking removed:
                                       BYTE-IDENTICAL (28 pre-existing, all in
                                       the creative / partner modules; none in
                                       src/banking)

Mutation testing              59 deliberate defects injected, 59 killed, 0 survived
  settings.mjs   10/10   incl. THE BIG ONE — a NULL threshold becoming a zero —
                         plus an explicit zero being dropped as though unset, the
                         driver's strings passing through unconverted, and org
                         scoping on both reads
  cashflow.mjs   37/37   incl. both sides of every boundary, the pessimistic-track
                         rule, the blind-spot refusal, each threshold being filled
                         in with a picked number, the shortfall attribution, and
                         BOTH compliance-wording rules (dropping "estimated", and
                         adding a credit-outcome claim)
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
  default. `recordReminders()` derives one for every reminder it emits; if you
  need a different rule, read `cashflow_settings` through
  `src/banking/settings.mjs` rather than adding a constant.
- **Anyone reading `cashflow_settings`:** go through `loadThresholds()`. It is
  the only place that converts the driver's strings to numbers and the only
  place that keeps a NULL as an ABSENT key rather than a zero. A zero
  `settlementLeadDays` asserts payments post same-day; an absent one makes the
  model say it does not know.
