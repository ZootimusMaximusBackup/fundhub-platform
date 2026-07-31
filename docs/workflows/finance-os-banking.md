# finance-os-banking

Shared board for the finance-OS banking batch (W5–W10). Each workflow claims
its task here, writes its manifest here when done, and reads this file before
starting.

W7 created this file. Other workflows should append their own `## W<n>` heading
below rather than editing anyone else's section.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| W5 | — | Plaid link: migrations 080–082 (`plaid_items`, `bank_accounts`, entity kind), adapter seams | pending |
| W6 | — | Card liabilities: migrations 083–084, liability parser | pending |
| W7 | this workflow | Migrations 085–086 (`bank_transactions`, `recurring_bills`), pure recurring-bill detection | **done** |
| W8 | — | Projections and reminders: migration 087, projector | pending |
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
