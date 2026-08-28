# Commission payout CRM — 2026-08-22

COMPLIANCE REVIEW REQUIRED — commission timing / payout recording.

## Scope (owner-approved)

CRM tracking only: period ledger + Approve + Mark paid with `payout_ref`.
No auto ACH. Commas stays client-pay-in only.

## Status

| Unit | Status |
|---|---|
| `src/commissions/payout.mjs` | done |
| `POST /api/commissions` | done |
| Products & Commissions UI | done |
| Unit + Postgres proof (rollback) | done |
| Live deploy + human click | waiting — other threads building; no Netlify yet |
| Journey `-actual.md` regen | deferred to ship (working tree mixes other routes) |

## Files

- `src/commissions/payout.mjs` + `payout.test.mjs` + `payout.pg.test.mjs`
- `api/commissions.mjs`
- `netlify/functions/api.mjs` (route)
- `public/app/products-commissions.html`
- `src/commissions/index.mjs` (re-export)
- `docs/journeys/*-actual.md` + CHANGELOG
