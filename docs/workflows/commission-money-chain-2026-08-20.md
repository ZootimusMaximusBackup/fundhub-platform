# Commission money chain — 2026-08-20

COMPLIANCE REVIEW REQUIRED — payment rails and commission timing.

## Task list

| Workflow | Owner | Status | Scope |
|---|---|---|---|
| 1. Ground and schema | cloud agent | done | Trace sources and define the durable data contract. |
| 2. Payment identity | cloud agent | done | Carry product, motion, sale, payment, and actor identity from link to receipt. |
| 3. Commission logic | cloud agent | done | Exact-payment keys, safe attribution, rule selection, funded amount only, dated rates. |
| 4. Proof | cloud agent | claimed | Unit tests, transaction-and-rollback Postgres tests, migration checks, lint, and type checks. |

## Shared context brief

Owner-set on 2026-08-20:

- Closer: 16.67% of each paid funding deposit.
- Closer: 20% of each paid downsell or upsell.
- Closer: 0.25% of the actual funded amount.
- Sales manager: 5% of each paid funding deposit.
- Sales manager: 5% of each paid downsell.
- Sales manager: 0.25% of the actual funded amount.
- There is no sales-manager upsell rule.

Ground truth:

- `sale_payments.amount`, on the exact paid row, is the payment source.
- `funding_rounds.funded_amount`, on the funded round, is the funding source.
- Migration 246 is applied and must not be edited.
- Payment-link `purpose`, product titles, descriptions, prices, call notes, and amounts do not prove downsell or upsell motion.
- `payment_links.created_by_staff_id`, stored call outcomes, and existing sale attributions are valid actor context only when their staff role matches.
- There is no team-manager assignment field. A sales manager is credited only when a real manager actor is present in the link, call, event, or existing sale attribution.

## Durable data contract

- `payment_links`: nullable `product_id`, `sale_id`, `sale_motion`, `closer_staff_id`, and `sales_manager_staff_id`.
- `sales`: nullable `sale_motion`; a different motion is a different active sale context.
- `sale_payments`: `product_id`, `payment_link_id`, and nullable `sale_motion`.
- `commission_rules`: nullable `sale_motion` scope plus front-end `paid_amount`.
- `sale_motion` accepts only `downsell` or `upsell`. Null means no motion was recorded.
- Motion-specific links require product identity. Legacy links may remain null and are not backfilled from text or amount.
- A payment event carries the stored link fields. The money writer validates and attaches the exact sale and exact payment.
- Front-end commission keys include `sale_payments.id`. Two real payments therefore get two keys; a replay of one payment gets the same key.
- Attribution is stored for each real role. Split limits are per sale, basis, and role so closer and manager can each hold their own 100% credit.
- Funded processing refuses a missing `funded_amount`; it never substitutes approved, requested, or client amounts.

## Change manifests

### Workflow 1

- Read migration 246 without changing it.
- Read commission, payment-link, Commas event, sale, funding-round, and call-outcome paths.
- Read the closer and sales-manager intended journeys.
- Defined the contract above. No application files changed.

### Workflow 2

- Added `product_id`, `sale_id`, `sale_motion`, closer, and manager context to payment links.
- Added a required explicit downsell/upsell choice for non-funding Present pay links. Motion is not derived from an offer, title, price, notes, or amount.
- Added stable product codes to the existing offer catalog and copied trusted link identity into Commas events.
- Carried link identity into the exact sale and `sale_payments` receipt.
- Files: `src/payment-links/index.mjs`, `src/adapters/commas.mjs`, `src/config/offers.mjs`, `src/sales/closer-deck.mjs`, `api/payment-links.mjs`, `api/closer-deck.mjs`, `public/app/present.js`.

### Workflow 3

- Added migration 247 for durable identity, exact receipt links, motion rule scope, and per-role attribution splits.
- Added migration 248 for closer downsell/upsell and manager downsell rates. It has no manager upsell row.
- Front-end calculations now use one exact payment and put `sale_payment_id` in the ledger and idempotency key.
- Closer and manager attribution is accepted only when an active staff row has the matching role. Missing actors stay missing.
- Funded commission refuses a missing `funded_amount` and never substitutes approved amount.
- Files: `db/migrations/247_commission_money_chain_identity.sql`, `db/migrations/248_owner_motion_commission_rates_20260820.sql`, `src/commissions/*`, `src/handlers/money-chain.mjs`.

### Workflow 4

- Focused unit tests pass for motion selection, paid-amount math, payment-link identity, manager attribution, and multi-payment keys.
- A local PostgreSQL 16 database applied all 179 migrations. A second migration run applied 0.
- Transaction-and-rollback PostgreSQL tests pass for two downsell part-payments, upsell with no manager rule, closer/manager attribution, and funded-versus-approved behavior.
- The existing money-chain PostgreSQL suite passes after isolating its old fixture rule from the owner-set rule and expecting the owner-set funded closer row.
- Migration manifest, lint, journey generation, and type-check availability checks pass. The repository has no TypeScript config.

## Blockers and open questions

- The closer front-end figure is 16.67% of the collected deposit per the owner-set rate in the 2026-08-20 journey changelog. $500.10 on a $3,000 deposit is correct for that rate. The test asserted $500.00, which is one sixth. Open question for the owner: 16.67% or one sixth. Not a code defect.
- No owner decision is missing for the rates or motion rules.
- The repository has no durable “this closer reports to this manager” field. This work does not choose a manager by roster position or by “only one active manager”; absent manager context remains unattributed.
