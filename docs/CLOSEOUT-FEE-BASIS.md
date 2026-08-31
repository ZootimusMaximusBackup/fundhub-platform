# Closeout fee basis — owner decision

Date: **2026-08-30** (owner-set, final)
Supersedes: the 2026-08-04 decision, recorded at the bottom of this file.
Source: Chris, direct.

## Decision

The 10% success fee is calculated from **confirmed approvals**.

A confirmed approval is a bank yes that has a real dollar amount recorded
against it. A bank yes with no amount is a real and normal state — the funding
advisor often does not know the limit yet — but it is **not** confirmed, and
nothing is billed on it.

In the database that is:

```
SUM(applications.approved_amount)
  WHERE funding_round_id = <this round>
    AND status = 'Approved'
    AND approved_amount IS NOT NULL
    AND approved_amount > 0
```

The rate is `sales.agreed_success_fee_percent` on the sale this round is linked
to, in percent units (10 means 10%). It is frozen on the sale. There is no
house default.

## Why

Chris:

> "Approved is correct. They can really be used interchangeably. Technically we
> are getting people approved, NOT funding the actual credit cards. But yeah if
> that is cool then make sure we bill based on **confirmed approvals**."

We get people approved. We do not fund the cards. So the number we are paid on
is the number we produced, and the word "confirmed" is doing real work: only an
approval somebody has written a dollar amount against counts.

## Why the per-application sum and not `funding_rounds.approved_amount`

The two can disagree, and which one wins is a money decision, so it is written
down.

* **"Approved, amount unknown" is a shipped state** (owner-set 2026-08-29, see
  `src/applications/status.mjs`). Only the application rows can tell a
  confirmed approval from an unconfirmed one. A round-level roll-up has already
  thrown that distinction away.
* **`funding_rounds.approved_amount` is derived.** On the Card Stacking rail it
  used to fall through to the *funded* amount when no approvals existed, so it
  can hold a real number on a round where nothing was confirmed at all. Billing
  off it would quietly reinstate the funded basis this decision replaces.
* **The lender breakdown already works this way.** `funding_closeout_items` is
  one row per confirmed approval, so the invoice total and the breakdown
  reconcile to the cent.

## Nothing confirmed is a refusal, never a $0 bill

A funded round with no confirmed approvals produces:

* no invoice,
* no closeout row,
* a named reason (`no_confirmed_approvals`), and
* a task telling a person to record the approved amounts.

Same for a client whose sale never agreed a fee percent
(`no_agreed_fee_percent`). A $0 invoice is not a smaller bill — it is a bill
that says we are owed nothing, sent to somebody who owes us money. NULL means
unknown and it survives (`CLAUDE.md` §12).

## Column note

`funding_closeout.total_approved_amount` keeps its historical name, and under
this decision **that name is finally accurate**: the value is the confirmed
approved total. From 2026-08-04 to 2026-08-30 the column was named "approved"
while holding the funded amount.

`funding_closeout.fee_percent` stores the rate as a **fraction** (`0.10`).
Every function argument in the code uses **percent units** (`10`). The two meet
in exactly one place, `createFundingCloseout`, and the argument is named
`feePercentUnits` so the factor of 100 cannot be passed silently.

## Code

| What | Where |
|---|---|
| The definition of confirmed approvals, and the rate lookup | `src/funding/success-fee.mjs` |
| The closeout record | `src/funding/closeout.mjs` — `createFundingCloseout` |
| The invoice | `src/workflows/f-07-funding-locked.mjs` |
| The event that carries both to the invoice | `src/funding/card-stacking-rounds.mjs` |

Both the closeout record and the invoice read the basis from
`success-fee.mjs`, so they cannot disagree.

## What still requires a funded amount

Unchanged: a Card Stacking card cannot be moved to **funded** without a funded
amount greater than zero. That guard is about the stage move, not the fee, and
it stays exactly as it was.

---

## SUPERSEDED — the 2026-08-04 decision

Kept so the next reader can see the basis changed, and why.

> Date: 2026-08-04
> Source: `docs/END-TO-END-VERIFICATION.md` operational finding
>
> **Decision.** The 10% success fee is calculated from
> `funding_rounds.funded_amount` — the amount the client was funded / is billed
> against. Approved application rows are a **lender breakdown only**. They must
> not gate or replace the fee.
>
> **Why.** A round can be marked funded without every lender application
> sitting in `Approved` status. Using Approved apps as the fee basis produced a
> silent $0 invoice — verified live in the end-to-end harness.
>
> **Column note.** `funding_closeout.total_approved_amount` keeps its
> historical name. Its value is now the fee basis (the round's funded amount).

**What changed and why the old reasoning no longer holds.** The 2026-08-04 fix
was aimed at a real failure — a silent $0 invoice — but it fixed it by changing
the basis rather than by refusing. Under this decision the same situation is
handled at the source: a round with nothing confirmed writes no fee row at all
and raises a named reason for a person, so there is no $0 invoice to prevent.
