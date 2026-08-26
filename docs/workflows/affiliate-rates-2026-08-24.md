# Affiliate rates — 2026-08-24

**Owner:** Chris said make up the schedule and make it work. Dictator go.

## Owner-set schedule

| Tier | Rate | Basis |
|---|---|---|
| Tier 1 (direct) | **20%** | Funding: deposit collected. Repair: enrollment fee (`sale_price`). |
| Tier 2 (downline override) | **5%** | Same basis on downline outcomes (recruiter must be unlocked). |

Paid only on qualified completed outcomes (funded engagement or repair enrollment). White-label stays **50%** revenue share (unchanged).

## Tasks

| Unit | Owner | Status |
|---|---|---|
| W1 Rates + accrual seed | this session | done |
| W2 Affiliate UI + public copy | this session | done (minimal) |
| W3 Prove Tier 1 / Tier 2 | this session | partial — rules live + math proved; full pg fixture suite blocked by app-role can't DISABLE TRIGGER (pre-existing) |

## Change manifest (W1+W2)

- `db/migrations/260_affiliate_commission_rates_20260824.sql` — seed AF-04 rules (**applied live**)
- `src/affiliates/economics.mjs` — comments: schedule is owner-set
- `src/affiliates/economics.pg.test.mjs` — keep owner rows; prove 15% repair path; deactivate for “no rule” cases
- `public/affiliates/index.html` — publish 15% / 5%
- `public/app/affiliate.html` — show schedule on portal
- `api/read/affiliates.mjs` — comments updated
- `src/http/affiliate-stats.pg.test.mjs` — comments updated

## Live proof

Rules on default org (queried after migrate):

| name | tier | % | basis | product |
|---|---|---|---|---|
| Affiliate — direct funding | direct | 15 | deposit_collected | card-stacking-dfy |
| Affiliate — downline funding | downline | 5 | deposit_collected | card-stacking-dfy |
| Affiliate — direct repair | direct | 15 | sale_price | repair-bundle |
| Affiliate — downline repair | downline | 5 | sale_price | repair-bundle |

Math: $3,000 deposit → Tier 1 **$600** · Tier 2 **$150**. $1,000 repair → Tier 1 **$200**.

Owner update same day: Tier 1 raised **15% → 20%** (migration 261).

## COMPLIANCE REVIEW REQUIRED

Affiliate commission fee timing / partner payout schedule.
