# White-label offer — spec batch, 2026-08-31

Five specs, written in parallel. **Specifications only — no code was written, no
migrations applied, nothing built.** Branch `claude/white-label-models-offer-page-31vn4q`.

## Status

| # | Spec | File | Status |
|---|---|---|---|
| W1 | Money model | `docs/specs/W1-money-model.md` | done |
| W2 | Creative intelligence spine | `docs/specs/W2-creative-intelligence.md` | done |
| W3 | Decline Autopsy | `docs/specs/W3-decline-autopsy.md` | done |
| W4 | Live Trial | `docs/specs/W4-live-trial.md` | done |
| W5 | Offer page + funnel | `docs/specs/W5-offer-page-funnel.md` | done |

## The offer, as locked by the owner

| | |
|---|---|
| Partner share | 50% of repair + funding, **front end and back end** (incl. half the 10% success fee) |
| E-products | Excluded — courses and digital products stay 100% FundHub |
| Entry fee | **$10,000 one time. No monthly fee.** |
| Financing | Entry is financeable through FundHub's own rails, down to a 405 FICO. Financing is a **payment option**, not a qualification — the review call decides who becomes a partner |
| Recruit bonus | Partner brings a partner → **$2,000**, one time, nothing ongoing |
| Sub-affiliates | Paid out of the **partner's half**. FundHub's 50% never moves |
| Affiliate schedule | Tier 1 20%, Tier 2 5% — live today (migrations 260/261) |
| Trial leads, day 8 | Prospect keeps them; FundHub fulfils; prospect paid at affiliate 20% |
| Partner filter | Entry no longer filters anyone, so the **production floor is the only filter** |

## The money, proved end to end

One $120,000 funded client, in whole cents, reconciled:

```
Client pays          10% of $120,000     = $12,000
  of which deposit                         $3,000  (counts toward the 10%)
  invoiced later                           $9,000

FundHub                                    $6,000
Partner gross                              $6,000
  their Tier 1 affiliate      -$600
  their Tier 2 affiliate      -$150
Partner net                                $5,250

FundHub's half never moves, however deep the downline.
```

**The $10,000 entry, by lender band** (financed, so FundHub receives part):

| Band | Lender remits | Less $2,000 recruit bonus |
|---|---|---|
| Prime 680+ (85%) | $8,500 | $6,500 |
| Near prime 600+ (75%) | $7,500 | $5,500 |
| Lender B tier 3 (62%) | $6,200 | $4,200 |
| Sub Prime A (42%) | $4,200 | $2,200 |
| Lender B tier 5 (30%) | $3,000 | **$1,000** |

**Sharp edge, flagged not fixed:** at the worst band with a recruiter attached,
FundHub nets $1,000 on a $10,000 sale — two thirds of the arriving cash goes
straight back out as the bonus. Still positive at every band; worth knowing before
the recruit bonus is advertised widely.

## What the specs found

1. **Nothing in production writes partner money.** The only `INSERT INTO
   partner_revenue` in the repo is a test fixture. The 50% is hand-math today. The
   affiliate side has the same hole — `convert()` in `src/affiliates/economics.mjs`
   is correct and simply never called from a payment event. W1 §15 specifies the
   writer; the schema in `db/migrations/042_partners.sql` is production-ready and
   needs no new table.
2. **The $47/month Winner's Board has no recurring-billing rail in this codebase.**
   The product could be finished and still unable to take money. (W2 §11.2)
3. **The partner application makes people live partners instantly.**
   `api/public/partner-apply.mjs` hardcodes status `active` and, in the same
   transaction, creates a login, a brand row, and a **published** page at
   `/sites/{partnerId}` — before any review call or signed agreement. One-word fix,
   already supported by the database. (W5 finding F1)
4. **That same form rejects anyone who already has an account** (409
   `already_registered`) — which is exactly the warm buyer this funnel is built to
   create. (W5 finding F2)
5. **Meta blocks money-related ads from unverified businesses**, and FundHub does not
   control that check. W4 moves verification in front of the pay button and adds a
   held-start trial so the clock only runs once verification lands.
6. **The Meta partner-account blocker gates convenience, not capability** — roughly
   85% of the creative-intelligence spine ships today, because FundHub's own account
   reads fine and a partner can invite FundHub from their side without approval.
7. **Real competitor ad spend does not exist** — not in any API, any browser, or any
   vendor. Every number in AdSpy, BigSpy, Minea and the rest is inferred. Layer 1
   data costs ~$51/month; two Winner's Board subscribers cover the entire bill.

## Open — owner decisions

| Ref | Question |
|---|---|
| W1 O1 | **What is the 90-day production floor, in dollars of collected client cash?** Now the only partner filter. Mechanism is fully specified; the number is a judgement call |
| W1 O2 | Hold a partner's payout while their affiliate is attributed but unconverted, or pay gross and recover later? |
| W1 O3 | Hold-back period before a partner accrual becomes payable (e.g. 30 days past the refund window)? |
| W1 O5 | Is the $10,000 entry refundable, and in what window? |
| W4 D1 | Zero calls book in seven days — service remedy (recommended) or cash refund? |
| W4 D2 | Funding-only trials in v1 (recommended), or funding and repair from day one? |
| W4 D3 | Who owns the mandatory day-0 creative approval gate? A gate nobody owns is not a gate |
| W5 O1 | **What is the $10,000 product called?** Must be a genuine training/enablement program (Commas finances courses only). Blocks page copy |
| W5 O2 | Is the Live Trial required before entry, or can an applicant buy in directly? |
| W3 Q5 | Retention period for uploaded decline rows. 30 days is a proposal, not a decision |

## Compliance

**COMPLIANCE REVIEW REQUIRED** on all five — fee timing, payout schedule, partner
marketing, consent capture, and consumer data. Labels are markers per CLAUDE.md §7.

Standing constraint carried by every spec: **no earnings claims on any public page.**
FundHub's projection files record zero measured paid closes, so modeled partner
earnings must not appear publicly.

## Build order, once decisions land

```
accrual writer  →  affiliate/partner payout wiring  →  Layer 1 ingestion
     →  Winner Score  →  offer page  →  funnel
```

Nothing downstream is safe to build before the accrual writer, because every other
piece assumes partner money can be recorded.
