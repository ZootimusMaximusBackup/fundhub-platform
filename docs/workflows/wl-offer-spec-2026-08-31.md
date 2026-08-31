# White-label offer — spec batch, 2026-08-31

Five specs, written in parallel. **Specifications only — no code was written, no
migrations applied, nothing built.** Branch `claude/white-label-models-offer-page-31vn4q`.

## Status

| # | Spec | File | Status |
|---|---|---|---|
| **W0** | **Owner decisions — READ FIRST, supersedes the rest** | `docs/specs/W0-decisions.md` | **done** |
| W1 | Money model | `docs/specs/W1-money-model.md` | done |
| W2 | Creative intelligence spine | `docs/specs/W2-creative-intelligence.md` | done |
| W3 | Decline Autopsy | `docs/specs/W3-decline-autopsy.md` | done |
| W4 | Live Trial | `docs/specs/W4-live-trial.md` | done |
| W5 | Offer page + funnel | `docs/specs/W5-offer-page-funnel.md` | done |
| W6 | Pricing menu | `docs/specs/W6-pricing-menu.md` | done |
| W7 | Training curriculum | `docs/specs/W7-curriculum.md` | done |

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

## Decisions — closed 2026-08-31

Recorded in full in `docs/specs/W0-decisions.md`, which **supersedes** any spec passage
that disagrees with it.

| Was open | Decided |
|---|---|
| Production floor | **10 clients per month.** Below it, the partnership ends. Not a dollar figure |
| Hold-back before paying a partner | **None.** Pay as fast as possible |
| Hold a payout against an unconverted affiliate | **No.** Pay the partner |
| Affiliates on the 10% success fee | **Yes** — changes live behaviour, needs a new rule row |
| Funding-only trials in v1 | **No.** Funding and repair are one ecosystem, always sold together |
| Is the Live Trial required | **Optional.** Anyone can buy in directly |
| Creative sign-off | Applies **when FundHub runs the marketing** — which is a separate paid package |
| Decline-autopsy data retention | **Retain in full. No purge** |
| $10,000 entry refund | **Short window.** Recorded as 3 days pending the exact figure |
| What the $10,000 is | The white-label program **plus training** — curriculum in design |

## Still open

| Item | Why it matters |
|---|---|
| **Add-on prices** | The menu is specced (`W6-pricing-menu.md`). The three prices — $497 / $2,497 / $197 — are recommendations from market comps, not owner-set |
| **Partner subscriptions don't fit the schema** | `subscriptions.client_id` is NOT NULL and points at `clients`; entitlements are client-scoped too. A partner add-on cannot be recorded today. Migration needed before anything monthly sells |
| **The training curriculum** | Research running. Modules must be agreed before any page describes the deliverable |
| **What the $10,000 includes besides training** | The deliverable list has to be real before it is published |
| **The Ascension funnel** | Does not exist and is not in the repo. To be built in its own batch now the offers are settled |
| **Exact refund window** | "Short" is recorded as 3 days |

## Blockers found by the curriculum research

Not training problems. These stop the channel launching, and one is live on the core
product right now.

1. **THE REPAIR CONTRACT CONTRADICTS THE PRICE — LIVE TODAY, NOT WHITE-LABEL.**
   `src/config/offers.mjs` prices `REPAIR_DFY` at $1,000 once (`priceCents: 100000`) and
   fills the contract's `monthly_fee` field with that same price (line 196), while the
   seeded `CREDIT-REPAIR-AGREEMENT` body reads *"You pay {{field.monthly_fee}} per month
   while services are active"* with `term_days: 180`
   (`db/migrations/169_contract_template_placeholders.sql:78`). **Every repair client has
   signed an agreement for $1,000/month for six months — $6,000 — against a $1,000
   product.** Owner decision required; not touched.
2. **Day one does not work.** The end-to-end white-label walk on 2026-08-27 failed: no
   pipeline card created, CRM search cannot find partners, Partner Home told a real
   signed-in partner "No partners on file", and zero welcome email and zero SMS were
   delivered.
3. **The money spine was not launch-ready** as of 2026-08-21 — deposits failing to save
   with a Postgres 23502, no real card ever charged or refunded, credit pulls sandbox
   only. Re-verify before teaching any payment step as current.
4. **There is nowhere for the $10,000 training to live.** `src/education/enrollments.mjs`
   handles enrollment requests only; its own header states there is no lessons table, no
   player and no entitlement check anywhere in `db/`.
5. **No partner agreement template exists.** The payout gate depends on
   `agreement_signed_at` being stamped, but no PARTNER-LICENSE row is seeded anywhere.
   The document that makes someone a partner is not in the system.
6. **"10 clients a month" has no definition.** Nothing says whether a $32 soft pull, a
   $200 trial and a $3,000 deposit each count as one client — and the floor cannot be
   computed at all today, because the only `INSERT INTO partner_revenue` in the repo is a
   test fixture.
7. **No state operating map.** Georgia makes operating a credit repair organisation for a
   fee a misdemeanour; Texas, Florida and Georgia require registration and bonds. Nothing
   lists where a partner may sell.
8. **The program's own legal characterisation is unaddressed.** W5 bans franchise and
   business-opportunity *words* in copy, but nothing addresses whether a brand licence
   plus a mandated method plus a $10,000 fee plus a production minimum plus parent-run
   fulfilment is itself one.

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
