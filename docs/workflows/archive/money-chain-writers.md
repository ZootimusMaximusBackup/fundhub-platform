# Money-chain writers — change manifest

Batch: wire live event handlers so sale / payment / funding-round / commission /
entitlement rows are written on the money spine. Design sources:
`src/commissions/PROPOSED-EVENTS.md`, `docs/MONEY-CHAIN-AUDIT.md`.

## Status

| Unit | Owner | Status |
|---|---|---|
| Migration 137 (idempotency keys + Commas aliases) | this session | done |
| `src/handlers/money-chain.mjs` writers | this session | done |
| Register on bus (`src/register-all.mjs`) | this session | done |
| `.pg.test.mjs` + unit helpers | this session | done |
| Read API verification in pg tests | this session | done |

## Owner calls (made in session — do not re-raise)

1. **`sale.closed` writes the `sales` row.** No separate `sale.recorded` event.
2. **Product resolve:** `resolve_product_id(name)` first; if miss, map semantic
   bucket (`crs`/`deposit`/`diy`/`success_fee`) → `products.code`.
3. **Attribution only from the event payload** (`attributions[]`, `closerId`,
   `advisorId`, `staffId`). Never invent a closer/advisor from client ownership.
4. **`product_entitlements` stays empty in migrations** (032's rule). Writers
   call `grantFromTransaction`; unmapped products are a no-op. Tests seed maps.
5. **Do not emit `commission.earned`.** Not in `CANONICAL_EVENTS` yet
   (`PROPOSED-EVENTS.md`).
6. **Commas name aliases** for the live `nameIncludes` needles land in 137.

## Files touched

- `db/migrations/137_money_chain_idempotency.sql` (new)
- `db/expected-migrations.mjs` (regenerated)
- `src/handlers/money-chain.mjs` (new)
- `src/handlers/money-chain.test.mjs` (new)
- `src/handlers/money-chain.pg.test.mjs` (new)
- `src/register-all.mjs` (register money-chain)
- `docs/workflows/money-chain-writers.md` (this file)
- `docs/MONEY-CHAIN-AUDIT.md` (status note)

## Journeys

No new HTTP routes. Role `-actual.md` files unchanged. Event-handler wiring is
below the journey route tables.

## COMPLIANCE REVIEW REQUIRED

Touches payment rails, fee timing (deposit → front-end commission), and
success-fee-adjacent funding commissions. Ship only after explicit human OK on
the compliance surface — writers themselves post ledger/sale rows, not
customer-facing credit claims.
