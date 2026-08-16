# CRS continue — 2026-08-16

Shared board. TransUnion is waiting on CRS support. Do not pull TU.

## Tasks

| Unit | Owner | Status |
| --- | --- | --- |
| 1 Ship Equifax FICO picker + deploy | this chat | done |
| 2 Live Playwright 100 | moved | see `docs/workflows/next-stack-2026-08-16.md` |
| 3 Full LexisNexis product (was: business credit pull) | moved | see next-stack |
| 4 Rename Business FSR copy | moved | next-stack unit 5 |

## Shared context

- Prove client `9af65808-a619-4e65-ae91-239766a006b7`
- Live CRS user `FundHubAPI` on `mware.crscreditapi.com` works
- Stored production result already has EX FICO + EQ FICO (IncomeView was rewritten to FICO 9)
- TU still E1006 — CRS email sent. Leave it.

## Change manifests

### Unit 1 — done 2026-08-16

- `src/finance/crs-map.mjs` — `pickCreditScore` keeps FICO / Fair Isaac even when the bureau omits max
- `src/http/client-detail.mjs` — board reads raw bureau FICO if the cached score was an income model
- Tests: `src/finance/crs-map.test.mjs`, `src/http/client-detail.test.mjs` (28 pass)
- Journeys: none (no new step)
- Live: `https://fundhub.ai` deploy `6a8163f346b72ceb214edcb5`
- Prove file already has EX + EQ FICO stored. TU still E1006.

### Unit 1b — TU off 2026-08-16 (owner)

- `CRS_ACTIVE_BUREAUS=EX,EQ` on Netlify + local `.env`
- `src/finance/crs-identities.mjs` `activeBureausFromEnv`
- `src/finance/crs-pull.mjs` orders that list
- TransUnion is not called until the env is changed back

### Unit 1c — income for closer leverage 2026-08-16 (owner)

- `income_estimates` on client detail + closer deck (Experian Income Insight + Equifax IncomeView+)
- Pipeline Credit block + closer discovery slide show `$/yr` guesses
- Not bank balances. Closer exploit only.
