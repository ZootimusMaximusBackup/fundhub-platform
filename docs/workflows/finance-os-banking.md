# finance-os-banking

Shared board for the finance-os-banking batch. Each workflow claims its task
here, writes its manifest here when done, and reads this file before starting.

This file did not exist when W6 ran; W6 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## Task list

| Unit | Owns | Status | Owner |
|---|---|---|---|
| W5 | the bank adapter and the accounts table | `pending` | unclaimed |
| W6 | card liabilities — migrations 083, 084 and the read side | `done` | this workflow |
| W7 | bills | `pending` | unclaimed |
| W8 | reminders and payment timing | `pending` | unclaimed |

W6 imports nothing from W5, W7 or W8. It takes an account reference as a
parameter. See "The account reference is not a foreign key" below — that is the
one seam W5 will have to close, and it is deliberately left open rather than
guessed at.

## W6

**Task:** the credit-card side of Finance OS, personal and business.
`status: done`

**What changed in plain language:** the system can now hold what a client owes
on each credit card, from the bank rather than from a credit report. It knows
the real due date, the real statement balance and the real minimum payment,
which a credit report does not carry. It keeps a dated history of every credit
limit and interest-rate change, so a limit that went up last month does not
erase what was true the month before.

### THE DECISION: a new table, not a third `source` on `tradelines`

Asked for deliberately, so here is the argument, from what the code actually
does rather than from taste.

`db/migrations/054_tradelines.sql` already holds card data with
`source IN ('crs','manual')`. Adding `'bank'` to that CHECK is a two-character
migration. It is also wrong, for four reasons that are all in the existing code:

1. **The identity key collides across namespaces.**
   `uq_tradelines_account ON (client_id, account_ref) WHERE account_ref IS NOT NULL`
   (054:97) keys a card by its *bureau* account identifier. A bank aggregator's
   account id is a different namespace with no relationship to it. Two sources
   writing one column means either a false match (two unrelated cards merged) or
   — overwhelmingly more likely — no match at all, which produces **two rows per
   physical card**. That is precisely the duplication this repo keeps finding.

2. **`upsertTradelines` has no precedence rule, and cannot be given one.**
   `src/tradelines/store.mjs` DO UPDATE overwrites `lender`, `kind`,
   `credit_limit_cents`, `balance_cents`, `source`, `source_ref`, `raw` and
   `as_of` unconditionally. If a bureau pull and a bank refresh both wrote the
   same row, whichever ran last would win *every column*, and the `source`
   column would flip back and forth while claiming to say where the current
   numbers came from. A per-column precedence rule inside one DO UPDATE is not a
   small change to that function; it is a different function.

3. **Double-counting available credit is a money defect, not a tidiness one.**
   `toCalculatorCards()` (src/tradelines/index.mjs) maps every open, non-
   installment row into `calcFunding()`, which **sums credit limits**. One
   physical card present as both a `crs` row and a `bank` row inflates Total
   Available Credit — the single number the closer says out loud on the call.

4. **The shapes genuinely differ, and the difference is all-or-nothing.**
   Statement balance, minimum payment, statement close date, payment due date,
   `last4` and `is_business` are things a bank knows and a bureau file does not.
   Adding them to `tradelines` makes eight columns that are NULL on every
   existing row and on every future `crs` or `manual` row. That is not a table
   with an extra source; it is two tables sharing a primary key.

**So: `card_liabilities` is its own table (083).**

**And here is the part said out loud, as required.** This DOES create a second
place that can answer "what does this client owe". Two mitigations, both in
this change and neither of them a promise made in a comment:

* `card_liabilities.tradeline_id` is a real foreign key to `tradelines(id)`.
  When a bank-sourced card and a bureau-sourced card are known to be the same
  physical card, the link is recorded in the schema, not inferred at read time.
* `mergeCardView()` in `src/card-liabilities/index.mjs` is a **pure** function
  that takes one tradeline row and one card-liability row and returns ONE
  answer, per field, with the provenance of each field attached. The precedence
  rule is written once, in one place, and is unit-tested field by field: **the
  bank wins any field the bank actually reported; a NULL from the bank is not a
  correction and never overwrites a known bureau value.**

**What is NOT done and must not be assumed:** nothing automatically populates
`tradeline_id`. Matching a bank card to a bureau card is a real matching
problem (issuer names disagree, `last4` is not unique per issuer per client)
and guessing at it would produce exactly the confident-nonsense failure 054's
own header warns about. Until a matcher exists, an unlinked pair shows up as
two rows to a human, which is visible and honest, rather than as one merged row
that is quietly wrong.

### The account reference is not a foreign key

`card_liabilities.account_ref` is `text NOT NULL`, not a `uuid` referencing an
accounts table, because **W5 owns that table and it does not exist yet**. There
is no `bank_accounts` table, no Plaid code and no adapter anywhere in the repo
today (`grep -rn "bank_account\|plaid" db src api` returns one unrelated hit in
051_hiring.sql). Writing a foreign key to a table that does not exist would
abort the migration; writing a `uuid` column with no FK would look like a key
and enforce nothing, which is the `idx_shifts_open` mistake 060 was written to
undo.

So it is an opaque text reference, exactly as the caller supplies it, and the
store takes `accountRef` as a parameter. **When W5 lands its accounts table, a
follow-up migration adds the foreign key.** That is a decision someone signs,
not a debt hidden in a nullable column.

### ASSUMPTIONS RECORDED (owner overrode §2/§3 for this run — these were not asked)

1. **"APR(s)" is three named rates:** `apr_purchase`, `apr_cash_advance`,
   `apr_balance_transfer`. Those are the three a card actually quotes and the
   three an aggregator reports as distinct types.
2. **Promotional / 0%-intro APR was deliberately NOT built.** It is not a rate,
   it is a rate *with a term* — it needs an end date, a fall-back rate, and a
   rule about what happens on the boundary. For a card-stacking business that is
   an important number, so this is flagged rather than half-built. **Open item
   for the owner: does the 0% intro period need modelling?** If yes it is its
   own migration, not a column bolted onto 083.
3. **084 versions terms, not balances.** A "term" is the credit limit, the three
   APRs and the business/personal classification. Balances change daily and are
   not terms; a balance history is a different problem and would be a different
   table. The task said "a limit or APR change", which is what is versioned.
4. **`is_business` is a genuine three-state value** — `true`, `false`, `NULL`.
   NULL means nobody has classified this card. It is not defaulted to personal,
   there is no `NOT NULL`, and `summarise()` reports the unknown bucket
   separately rather than folding it into either side.
5. **A missing credit limit yields a NULL utilisation, never 0.** So does a
   limit of exactly 0. Zero utilisation and unknown utilisation are different
   facts and `utilisation()` refuses to conflate them. This is the single most
   heavily tested function in the change.
6. **No UI screen, no bill, no reminder, no Plaid call.** Scope fence honoured.

### Files touched

| File | Change |
|---|---|
| `db/migrations/083_card_liabilities.sql` | new — one row per card, all money in integer cents, APR as a fraction in [0,1] |
| `db/migrations/084_card_liability_terms.sql` | new — effective-dated term history; one open row per card enforced by a unique partial index; a trigger that refuses an in-place rate edit |
| `src/card-liabilities/index.mjs` | new — PURE. `utilisation`, `availableCreditCents`, `summarise`, `mergeCardView`, `coerceLiabilityRow`, `readIsBusiness`, `readLast4` |
| `src/card-liabilities/index.test.mjs` | new — pure unit tests, no database |
| `src/card-liabilities/store.mjs` | new — the database half. `upsertCardLiability`, `listCardLiabilities`, `getCardLiability`, `openTerms`, `currentTerms`, `changeTerms`, `listTerms`, `termsAsOf` |
| `src/card-liabilities/store.pg.test.mjs` | new — real Postgres |
| `api/read/card-liabilities.mjs` | new — `GET /api/read/card-liabilities?client_id=<uuid>` |
| `src/http/card-liabilities-read.pg.test.mjs` | new — the endpoint end to end, incl. the role gate |
| `netlify/functions/api.mjs` | `read/card-liabilities` added to `ROUTES` |
| `docs/workflows/finance-os-banking.md` | new — this board |

### Exports added

`src/card-liabilities/index.mjs`: `utilisation`, `availableCreditCents`,
`summarise`, `mergeCardView`, `coerceLiabilityRow`, `readIsBusiness`,
`readLast4`, `TERM_FIELDS`, `BANK_REPORTED_FIELDS`.

`src/card-liabilities/index.mjs` also re-exports `toCents` and `readApr` from
`src/tradelines/index.mjs`, and exports `asCents` / `asRate` (Postgres returns
`bigint` and `numeric` as strings; a bare comparison on those is wrong above a
million).

`src/card-liabilities/store.mjs`: `upsertCardLiability`, `listCardLiabilities`,
`getCardLiability`, `openTerms`, `currentTerms`, `changeTerms`, `listTerms`,
`termsAsOf`, plus `TERM_FIELDS` and a re-export of `withTransaction`.

### Routes affected

`GET /api/read/card-liabilities` — new. Staff-gated with a real `requireRole`
call after `requireAuth` (`requireAuth` drops a `roles` key; see the comment in
`api/read/tradelines.mjs`). `client_id` is required and must be a uuid, for the
same reason it is required there: this is per-person financial detail and a
paginated firehose of everybody's card balances is how a breach happens.

### Journeys impacted

**None updated, and here is why:** `docs/journeys/` does not exist in this
repository. CLAUDE.md §4 describes eight journey pairs and a
`docs/journeys/CHANGELOG.md`; `ls docs/` returns only `diagrams` and
`workflows`. **This is a finding, not an omission by W6.** Inventing eight
hand-authored "intended" journeys to satisfy the rule would be writing the
source of truth from a guess, which §4 forbids in the strongest terms it has.
`npm run diagrams:check` (the generator that DOES exist) still passes.

### How it was verified

Against a real Postgres 16, from a database created empty each time.

```
migrations apply from scratch      52 applied, 0 errors
re-run                             0 applied  (a no-op, as required)
pure unit tests (no database)      60 pass, 0 fail
card-liability pg tests            33 pass, 0 fail
endpoint pg tests                  14 pass, 0 fail
npm test, DATABASE_URL unset       0 fail, 228 skipped
npm test, virgin db, first run     24 fail — the SAME 24 NAMES as clean main
mutation check                     20/20 caught
```

The 24 failures were diffed by NAME, not by count, against a control run of
clean `main` on its own virgin database. The two lists are byte-identical: no
new failing name, and none of the pre-existing ones accidentally fixed.

**Two things this found in itself and fixed rather than tolerated:**

1. **Microseconds versus milliseconds.** Postgres stores instants to the
   microsecond; a JavaScript `Date` only holds milliseconds. So
   `termsAsOf({ at: row.effective_from })` — the most obvious call anyone will
   ever make against 084 — was asking about an instant a few hundred
   microseconds before the row began and being handed the **previous** row.
   Off by one row, only ever at the boundary, with no error anywhere. Both the
   migration and the store now truncate to milliseconds so every stored instant
   is exactly representable by the only client this system has.
2. **An order-dependent test of its own making.** The endpoint test originally
   created an extra active staff row in the default org. Three other suites
   (`campaign-endpoints`, `conversations-read`, `inquiries`) pick their staff
   fixture with `... WHERE org_id = $1 AND status='active' LIMIT 1` and no
   `ORDER BY`, so they could pick it up instead of the one they meant — which
   turned an unrelated campaigns test red on first runs only. The fixture now
   lives in its own non-default org. This repo already carries five
   order-dependent suites; a sixth was not worth four saved lines.

### Findings (not fixed here — other units' files)

* **`api/read/tradelines.mjs` reports an unknown credit limit as $0 available.**
  It computes `Math.max(0, (limit ?? 0) - (balance ?? 0))`, so a card whose limit
  the bureau did not report shows "$0 available" rather than "unknown". A closer
  reads that as "this card is maxed out" when the truth is "we do not know". It
  is existing code in another unit's file and was left alone under scope
  discipline. `availableCreditCents()` in `src/card-liabilities/index.mjs`
  deliberately does not repeat it, and the mutation check includes that exact
  substitution as a mutation to make sure a test catches it here.
* **`docs/journeys/` does not exist.** CLAUDE.md §4 describes eight journey
  pairs and a changelog; `ls docs/` returns only `diagrams` and `workflows`.
  Nothing was invented to satisfy the rule.
* **`npm run lint` and `npx tsc --noEmit` are not runnable in this repo.**
  There is no `lint` script in `package.json`, no ESLint config and no
  `tsconfig.json`. CLAUDE.md §6 items 1 and 2 could not be run. This is a
  pre-existing repo fact, stated rather than silently skipped.

### Blockers and open questions

* **Open — for the owner:** does the 0%/promotional intro APR need modelling?
  (Assumption 2 above.) Not built.
* **Open — for W5:** `card_liabilities.account_ref` needs a foreign key once the
  accounts table exists. One migration, one line.
* **Open — nobody claimed:** nothing populates `tradeline_id`. A bank-card to
  bureau-card matcher is unbuilt and deliberately so.
* **Not a blocker, recorded:** `docs/journeys/` does not exist (above).
