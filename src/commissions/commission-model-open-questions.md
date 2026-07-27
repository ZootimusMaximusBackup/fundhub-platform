# Commission model — open questions

For **Chris** and **Darwin**. Written alongside `db/migrations/010`–`015` and
`src/commissions/`.

Chris answered questions **1–9** (including **6a** and the rule-version date) on
2026-07-26. Those answers are recorded below as **CHRIS PROVISIONAL** and are
built into the model, but **Darwin confirms before anything goes live**. Nothing
in this list is guessed at — where an answer is still missing, the model treats
the number as configuration and the code refuses to invent one.

**Two defaults changed on Chris's instruction and are worth Darwin's eye first,
because both are quiet and both move money:**

| | default | why |
|---|---|---|
| rule version date (#9) | **sold date** | a raise must not retroactively reprice closed deals |
| `tier_mode` (#6a) | **marginal** | a whole-ladder cliff is expensive and gameable |

**One consequence Chris should confirm he wants: [#4a](#4a-no-deposit-no-front-end-commission-chris-confirm-you-want-this)
— a closed deal with no deposit yet earns the closer nothing at all.**

---

## First, the thing most likely to be missed

### ⚠️ `db/migrations/` is not wired to the migration runner

`db/migrate.mjs` line 13 reads:

```js
const DIRS = ["schema", "seed"];
```

The commission migrations live in `db/migrations/`, which that list does not
include, so **`npm run migrate` will not apply any of them** as things stand.
`db/migrate.mjs` was owned by another session during this build and was
deliberately not edited. The change is one line:

```js
const DIRS = ["schema", "migrations", "seed"];
```

Ordering is safe: `schema/` applies in full first, so `001_init.sql` is always in
place before `010_products.sql` runs. Every file is `IF NOT EXISTS` /
`DROP…CREATE` and re-runnable, so it can be wired whenever.

### ⚠️ The SQL has not been executed against a live Postgres

There was no Postgres and no `DATABASE_URL` on the build machine, so migrations
010–015 are **unrun**. They are written against the conventions in
`001_init.sql` and reviewed by hand, but they have not been proven. Someone
should apply them to a scratch database before they go near production. The
JavaScript is fully exercised — 96 unit tests, all passing.

Two things in particular are worth watching on first apply, because they are the
least ordinary SQL in the set:

- the two `EXCLUDE USING gist` constraints in `013` (they need `btree_gist`,
  which the migration creates)
- the `COALESCE` sentinels inside the rule exclusion — they exist because `NULL`
  never conflicts with `NULL` under an exclusion constraint, but `NULL` here
  means "all", which very much does conflict

---

## Answered — CHRIS PROVISIONAL, pending Darwin

### 1. `$500 flat per $3K deposit` — flat per sale ✅

> One deposit, one $500. Not per-unit.

Built as `calc_method = 'flat'`. The `flat_per_unit` method is kept in the model
and tested, because other products may need it, but the card stacking closer is
not paid that way.

**Darwin:** confirm this does not change on a part-paid deposit. Today a $1,500
deposit against a $3,000 agreed price still fires the whole $500, because the
rule is flat and the base is non-zero. If it should be pro-rated, that is a
`percent` rule on `deposit_collected`, not a flat one.

### 2. `0.25% of funded` — per round ✅

> On that round's `funded_amount`. Not lifetime.

Built as `amount_basis = 'amount_funded'`, which reads
`funding_rounds.funded_amount` for the one round that funded. A client who funds
three rounds generates three back-end commissions.

### 3. Back end pays on funding regardless of success-fee collection ✅

> Earned at `round.funded`. Collection is AR's problem, not the rep's.

Built. The calculator never looks at whether the fee was paid; there is a test
asserting the commission is identical with and without a `success_fee` payment
on the sale. A rule *can* be configured to pay on the success fee amount
(`amount_basis = 'success_fee'`) — that is the fee's **size**, still not its
collection status.

### 4. Closer front end earns on deposit **collected** ✅

> Money in the door.

Built as `amount_basis = 'deposit_collected'`, summed from `sale_payments` where
`kind = 'deposit'`. `sale_price` remains available as a basis if a product ever
needs to pay at signature.

#### ⚠️ 4a. **No deposit, no front-end commission.** Chris, confirm you want this.

This is a direct and non-obvious consequence of answer #4, so it is called out
separately rather than buried. Because the front end pays on money in the door:

- A deal closed, contract signed, client committed — but **no deposit has landed
  yet** — earns the closer **nothing**. Not a pending commission, not a zero-dollar
  row. **No ledger row at all**, plus a `zero_base` warning.
- The commission appears the moment the first deposit is recorded, not when the
  deal is closed.
- If the deposit never arrives, the closer is never paid for that deal, and there
  is nothing to claw back because nothing was ever earned.
- A flat rule does **not** fire on a base of zero. The $500 is not a
  signing bonus; it is triggered by collection.

This is almost certainly what "money in the door" means, and it is the
conservative reading — the system will never pay out on a deal that did not
actually pay us. But it does mean a closer's dashboard will show a closed deal
with no commission against it for as long as the deposit is outstanding, and
somebody will ask about that. Worth being sure before reps see it.

There is a test asserting exactly this behaviour
(`front end: no deposit means no commission, even on a flat rule`).

**If that is wrong**, the fix is configuration, not code: point the rule at
`amount_basis = 'sale_price'` and the closer earns at signature instead.

### 5. Additive bonus stacking ✅ — **NEEDS DARWIN'S REVIEW**

> Sarah's bonuses sit on top of base commission.

Built as `commission_rules.stacking`:

- `base` — rules **compete**. Exactly one wins per (person, basis), by scope
  specificity. This is the person's commission.
- `bonus` — rules **stack**. Every matching bonus applies on top, each as its own
  ledger row so a payout report shows base and bonus separately.

The `commission_rules_no_overlap` exclusion constraint applies only to `base`
rules; stacking several bonuses is the point of them.

**This mechanism is new and has not been validated against a real comp plan.**
Specifically, Darwin should decide:

- **5a.** Should a bonus be able to pay on a different `amount_basis` from the
  base it stacks on? Today it can — a bonus on `cash_collected` can sit on top of
  a base on `deposit_collected`. That is flexible and possibly too flexible.
- **5b.** Should bonuses be capped in aggregate? Each rule has its own
  `min_amount`/`max_amount`, but there is no ceiling on base + all bonuses
  combined.
- **5c.** Can a bonus be scoped to a person the way a base rule can? Today yes.
  If Sarah's structuring is always org-wide or role-wide, tightening this would
  remove a way to get it wrong.

### 6. Tiered rates ✅

> Build the table now rather than retrofitting later.

Built: `commission_rule_tiers`, with `calc_method = 'tiered'` on the parent rule.
Brackets are on the **amount basis**, not the commission — "rounds over $50,000
pay 0.5%" is a bracket of `[50000, null)` at `0.5`. Bounds are half-open
`[min, max)`, so a base landing exactly on a boundary falls in the upper bracket.
An exclusion constraint prevents overlapping brackets within one rule.

#### 6a. `tier_mode` — **MARGINAL** ✅

> Only the dollars above a bracket pay the higher rate. Whole-ladder creates a
> cliff where funding one dollar more jumps the entire commission, which is both
> expensive and an incentive to game the number.

Default changed to `marginal`, in the calculator and in the
`commission_rules.tier_mode` column default. `whole` remains available per rule.

The cliff Chris is describing, on a 0.25 / 0.5 / 1% ladder:

| funded | `marginal` | `whole` |
|---|---|---|
| $49,999 | $124.99 | $124.99 |
| $50,001 | $125.00 | $250.01 |

Two dollars more funding moves the commission by **1 cent** under marginal and by
**$125** under whole. There is a test asserting the absence of that cliff.

One consequence to know: **marginal requires a percent on every bracket.** A
ladder of flat amounts cannot be expressed marginally, so such a rule must set
`tier_mode = 'whole'` explicitly. The calculator throws a message saying exactly
that rather than guessing.

### 7. Clawback on refund — full reversal ✅

> Reverse in full, negative row. Prorating is a case-by-case call a human makes.

Built as `reverseDraft()`, which produces a negative row carrying
`reverses_ledger_id`. `portion` defaults to `1` (full). A partial reversal is
possible but must supply its own idempotency key, because "the reversal of row X"
is unique by definition — this makes prorating a deliberate act, never a default.
A reason is mandatory. Nothing is ever deleted or edited.

**Still open — 7a.** Who is allowed to post a reversal, and does a reversal of an
already-**paid** commission net against the next payout run or raise a debt? The
model records the fact either way; the policy is not encoded.

### 8. `$6.25/hr` is payroll, not commission ✅

> Out of scope.

Correct and confirmed. It is hourly wage off `shifts`, and nothing in this model
touches it. The commission ledger holds commission only. If a timesheet screen
wants to show "wage + commission" side by side it can read both.

### 9. Rule version date — **SOLD date, not earned** ✅

> A deal sold in July should pay July's rate even if it funds in October.
> Otherwise a raise retroactively repriced deals people already closed, and reps
> can't predict what they'll be paid when they close.

Default changed. `asOf` now falls back to `sale.sold_at`, and only to the earning
date when there is no sale to date from (a manual adjustment).

So: a card stacking deal sold 1 July, funding 15 October, is paid at the rate in
force **on 1 July**, even if the advisor rate doubled on 1 August. The
`earned_at` stamped on the ledger row is still the real October funding date —
only the *rate version* is picked by the sale date.

Earned-date behaviour remains available by passing `asOf = occurredAt`
explicitly. Both readings are tested.

Knock-on worth noting: raising a rate now only affects **deals sold after the
change**. To give a raise on deals already in the pipeline, the new rule's
`effective_from` has to be backdated to before those sales were written — which
is visible, dated and auditable, rather than a silent side effect of the clock.

---

## Still open — nobody has answered these

### 10. Front-end earning granularity on instalment plans

A `flat` rule earns once per (sale, rule) — the idempotency key is built from the
sale, not the payment, so a second deposit does not re-fire the $500. Correct for
flat.

But a **percent-of-cash-collected** rule on a payment plan is ambiguous: should
each instalment earn incrementally, or should the total be recomputed and the
earlier row superseded? The calculator supports incremental earning today (pass
`eventRef` = the payment id) but nothing decides which is right. Only matters if
a percent-based front-end rule is ever configured on a payment plan.

### 11. Round-to-sale linkage when a client has bought twice

`funding_round_sales` freezes which sale a round belongs to, and
`SQL_LINK_ROUND_TO_SALE` resolves it as *the client's most recent active
funding-category sale at or before the round's creation*. That is a reasonable
default and it is written once, never recomputed.

It is a guess for a client who has bought card stacking **twice**. If renewals
and second-wave funding (N-06) are common, someone should decide whether round 4
belongs to the original sale or the renewal, and set `link_method = 'explicit'`
rather than letting the resolver pick.

### 12. What happens to `staff.comp`

`staff.comp` (jsonb, `001_init.sql`) is the bare blob this model replaces. It has
**not** been touched, migrated or deprecated — that table belongs to other work.
Once rates are in `commission_rules`, someone should decide whether `comp` holds
anything that is not now represented, and either migrate it or empty it. Two
sources of truth for what a rep is paid is exactly the problem this was built to
end.

### 13. Approval workflow

The ledger has `earned → approved → paid` with `approved_by` / `paid_by` text
fields and a database trigger that forbids backward transitions and freezes
amounts once approved. **Who approves, and on what cadence, is not modelled.**
There is no batch/payout-run table — payouts are grouped by querying
`v_commission_statement` and stamping `payout_ref`. If a formal payout run with
its own approval and totals is wanted, that is one more table.

---

## Cross-session note: `invoice.raised` and DS-02

A separate session porting **DS-02** hit this same gap and stubbed the Commas
invoice-creation call as a staff task, because no outbound invoice capability
exists anywhere in the platform. **The AR series is blocked on the same thing.**

Three workstreams need one capability:

| Needs it | For what |
|---|---|
| DS-02 | Commas invoice creation, currently stubbed as a manual task |
| AR-series | unpaid invoice → AR pipeline → sequences → AR voice agent (spec §12) |
| This model | 10% success fee invoiced on `round.funded` (spec §12, ports AX20/AX21) |

The proposed `invoice.raised` event in `PROPOSED-EVENTS.md` is where this
plausibly lives. **Darwin: please build it once.** From this model's side the
requirement is small — the success fee amount and the client are already
derivable (`v_sale_balance.success_fee_due`), and back-end commission does **not**
wait on it (answer #3), so this is not blocking commission. It is blocking AR.

What this model does *not* have, and would need if `invoice.raised` becomes real:
an `invoices` table. `v_sale_balance` computes a balance from sales, funded rounds
and payments, which is enough for a balance-due figure but is **not** an invoice
record — no invoice number, no issue date, no dunning state. Whoever builds the
AR side should own that table rather than bolting it onto `sales`.

---

## What the confirmed rates would look like as rows

**Not executable, deliberately.** `013_commission_rules.sql` seeds **zero** rates.
Spec §14's numbers are a sentence in a spec, not a signed comp plan, and every
answer above is provisional. This is here so the shape is obvious when Darwin
signs off — enter them through the admin screen, or a follow-up seed.

Reading of spec §14, under CHRIS PROVISIONAL 1–4:

| name | basis | stacking | scope | method | amount_basis |
|---|---|---|---|---|---|
| Closer — deposit | `front_end` | `base` | role `closer`, product Card Stacking DFY | `flat` $500 | `deposit_collected` |
| Closer — funded | `back_end` | `base` | role `closer` | `percent` 0.25 | `amount_funded` |
| Advisor — funded | `back_end` | `base` | role `funding_advisor` | `percent` 0.25 | `amount_funded` |

Note the closer needs **two** rows: §14 gives them a front-end flat *and* 0.25% of
funded. Different basis, so both fire and neither competes with the other. That
is the model working as intended, not a workaround.

Sarah's bonuses are `stacking = 'bonus'` rows, once #5 is reviewed.

---

## Ground rules the model holds to, for reference

1. **Every rate is a row.** There is not one product name, dollar amount or
   percentage hard-coded in `src/commissions/`, and there must never be one.
2. **Product identity is the record.** Sales reference `product_id`. Renaming a
   product keeps the old name as a routing alias automatically, so inbound
   webhooks carrying the old string still resolve.
3. **Route by name, never amount.** Some legacy alias strings contain dollar
   figures (`'$3,000 deposit'`). They are matched as opaque labels; no code parses
   money out of a product string.
4. **Editing a rate never rewrites history.** Rates are superseded by closing the
   live row and opening a new one, and each ledger row carries a frozen snapshot
   of the rule that produced it.
5. **Missing configuration is surfaced, never invented.** No rule configured
   produces a warning and no ledger row. The system does not guess a rate and does
   not quietly pay zero.

**One honest limitation:** `amount_basis` is the single field on
`commission_rules` that is *not* admin-editable, because each value is a formula
the calculator implements. Adding a value there is a code change. Everything else
on that table — names, rates, scopes, dates, tiers — is a row a person edits.
