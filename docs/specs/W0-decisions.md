# W0 — Owner decisions for the white-label channel

**Owner-set 2026-08-31.** This file is the single source of truth for the commercial
terms of the white-label partner channel. Where any other spec (W1–W5) disagrees with
this file, **this file wins** — the others were written before some of these calls were
made, and each stale passage now points here.

Per CLAUDE.md, these are owner decisions. They are recorded, not recommended, and they
are not open for re-litigation.

---

## The offer

| Term | Value |
|---|---|
| Partner share | **50%** of funding and repair, **front end and back end** — including half the 10% success fee |
| E-products | Excluded. Courses and digital products stay 100% FundHub |
| Entry fee | **$10,000, one time.** No monthly fee on the base program |
| Financing | Entry is financeable down to a 405 FICO. Financing is a **payment option**, not a qualification — the review call decides who becomes a partner, never the lender |
| What the $10,000 buys | The white-label program **plus real education and training** (curriculum in design — see "Open" below) |
| Recruit bonus | Partner brings a partner → **$2,000**, one time. Nothing ongoing |
| Sub-affiliates | Paid out of the **partner's half**. FundHub's 50% never moves |
| Refund window | **Short.** Owner: "keep it a short refund period" — most partners enter on payment plans, and refunding a payment plan does not make sense. Recorded as **3 days** pending the exact figure |

## Production floor — the only partner filter

**10 clients per month.** Below it, the partnership ends.

Entry no longer filters anyone (anyone financeable can buy in), so this bar is the whole
filter. The mechanism in `W1-money-model.md` §6 stands — rolling window, grace period,
warnings, downgrade — but the threshold is **client count, not dollars**.

> Owner also stated a $10,000/month production figure. Ten clients a month clears that
> comfortably (10 × $3,000 deposit = $30,000 collected), so the client-count bar is the
> binding one and the revenue figure is satisfied automatically.

## Payouts — fast, and final

**No hold-backs. No clawbacks. Pay as fast as possible.**

Owner: *"When money goes out, we assume it never comes back."*

This closes `W1` O2 and O3 as **NO**:

- No hold-back period before a partner accrual becomes payable.
- No holding a partner's payout while one of their affiliates is attributed but
  unconverted. Pay the partner; do not withhold against a future deduction.

Consequence, accepted: a refund or chargeback after a partner has been paid is
FundHub's loss. The ledger still records the reversal (`void-with-reason`, per the
no-delete trigger) so the books are accurate; it simply is not recovered from the partner.

## Affiliates earn on the back end

**Yes.** An affiliate earns on the 10% success fee, not only on the deposit.

This closes `W1` O4 as **YES** and **changes current live behaviour** — migrations
260/261 use a `deposit_collected` basis, so affiliates earn nothing on the success fee
today. This needs a **new rule row** (rates are versioned; never `UPDATE` a live percent),
not a code change.

Effect on the partner, since sub-affiliates come out of the partner's half:

```
$12,000 success fee
  FundHub                 $6,000   ← never moves
  Partner                 $6,000
    their Tier 1 affiliate  -$1,200
    their Tier 2 affiliate    -$300
  Partner net             $4,500
```

## Funding and repair are one ecosystem

They are **always set up together** and sold as one thing. There are multiple offers
inside each, but they go hand in hand.

This closes `W4` D2: there is **no funding-only version**. Any spec passage proposing
funding-first-then-repair is superseded.

## The Live Trial is optional

Never a requirement. Someone who wants in can buy in directly without trialling.

This closes `W5` O2 as **optional**.

## Marketing is a separate paid package

The base white-label program does **not** include marketing. A partner can run their own
marketing, or buy FundHub's as an add-on. Same for licensing and other done-for-you
services.

Two consequences:

1. **Creative sign-off** (`W4` D3) applies **when FundHub runs the marketing** — that is,
   when the partner has bought the marketing package. A partner running their own
   marketing is a different control question.
2. **The commercial model is a menu, specced in `W6-pricing-menu.md`.** The base is
   $10,000 with no monthly; marketing, marketing insights and other services are
   stackable monthly add-ons.

## Two laws of the pricing menu

**The 50% never moves.** No add-on, package or service changes it, in either direction.
Half is half; everything else is a menu.

**Every partner connects their ad account — free and required.** It is a condition of
using FundHub's fulfilment, not a product. FundHub gets telemetry from 100% of partners
(collision protection, and Layer 3 of the creative spine fills from day one); what the
Brain tells the partner stays a paid add-on.

Full menu: `docs/specs/W6-pricing-menu.md`.

## Consumer data from the Decline Autopsy

**Retain in full. No purge.** Owner-set.

This supersedes `W3-decline-autopsy.md` A3 (30-day retention) and its purge design. The
retention-class registration in that spec should register the class without a purge
schedule rather than deleting rows on a clock.

## The Ascension funnel

Does not exist yet and is not in the repository — it is to be **built**, in a separate
work batch, now that the offers are settled. `W5`'s funnel design should be read as the
partner-side flow, not as the Ascension funnel itself.

---

## Still open

| Item | Note |
|---|---|
| ~~Pricing restructure~~ | **CLOSED — specced in `W6-pricing-menu.md`.** The three add-on prices themselves remain owner-settable |
| **Exact refund window** | "Short" is recorded as 3 days pending confirmation |
| **The $10,000 training curriculum** | Research in progress; modules to be agreed before the page describes the deliverable |
| **What the $10,000 includes besides training** | The deliverable list must be real before it is published |
| **Ascension funnel** | To be designed in its own batch |
