# SLO first slice — 2026-08-26

**COMPLIANCE REVIEW REQUIRED** — payment rails.

Worktree: `/Users/zootimusmaximus/fundhub-slo-slice-1` branch `slo/first-slice` off `origin/main`.

## In this slice

1. Owner SLO Connections on Products & Commissions.
2. Signed ClickFunnels paid webhook writes a sales row on the named client.
3. ClickFunnels keeps the page and checkout.

## Not in this slice

Soft pull, UnderwriteIQ, black reports, paper, recurring, white-label, GHL.

## Prove

- Mapping: owner save + list tests.
- One signed paid webhook on a sim: `src/adapters/clickfunnels.test.mjs` and `src/slo/purchase.test.mjs`.
- No card charge. No live CRS.
