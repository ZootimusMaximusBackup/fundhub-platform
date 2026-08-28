# P2 — Underwrite $0 diagnosis (2026-08-19)

Findings only. No app / test / env / intended-journey edits. No deploy. No Fixer.

Ground truth for underwrite dollars is **MISSING** in `docs/journeys/*-intended.md`. Scored against Chris’s P2 prompt on `docs/workflows/audit-2026-08-19.md`.

Prior W-UW observation (`docs/workflows/audit-engine-2026-08-18-evidence/w-uw/`) was re-traced against **current** `simulate-client.mjs`, `adapter.mjs`, `engine.mjs`, and `client-detail.mjs` `triMerge`. Keys still match.

## Verdict

The engine is not broken; the live simulate seed starves it because scores sit under `consumerSignals.scores.perBureau` and `crm_payload.scores` while the adapter only reads `crs_results.result.scores`.

## Four CRS nestings (`src/adapters/crs.mjs` comment)

`normalizeCrsResult` lists four places it will take `outcome_tier`:

1. `engineResult.outcome` — top-level, canonical
2. `engineResult.crm_payload.outcome` — crm_payload alias
3. `engineResult.result.outcome` — legacy result wrapper
4. `engineResult.outcomeResult.outcome` — internal detail key

(That adapter **can** also read scores from `consumerSignals.scores.perBureau` and `crm_payload.scores`. Underwrite’s `triMerge` cannot.)

## Exact mismatches

| # | What the underwrite path reads | What simulate writes | Match? |
|---|---|---|---|
| 1 | `crs_results.result.scores.{ex,eq,tu}` (also `experian`/`equifax`/`transunion` aliases) via `triMerge` / `scoresFromResult` | **Not written.** Scores are only at `result.consumerSignals.scores.perBureau.{ex,eq,tu}` and `result.crm_payload.scores.{ex,eq,tu}` | **MISMATCH — this is the $0 starve** |
| 2 | `crs_results.result.scoreModels` / `score_models` | Not written | miss (optional fallback) |
| 3 | `crs_results.result.bureaus.{EX,EQ,TU}.scores[]` | Not written | miss (optional fallback) |
| 4 | `clients.custom_fields.crs_inquiries_ex` | Not written (`custom_fields` never set) | MISMATCH |
| 5 | `clients.custom_fields.crs_inquiries_eq` | Not written | MISMATCH |
| 6 | `clients.custom_fields.crs_inquiries_tu` | Not written | MISMATCH |
| 7 | `clients.custom_fields.crs_negative_items_count` | Not written | MISMATCH |
| 8 | `clients.custom_fields.crs_late_payments_count` | Not written | MISMATCH |
| 9 | `clients.custom_fields.business_age_months` | Not written | MISMATCH |
| 10 | `card_liabilities.tradeline_id` + `payment_status` | No `card_liabilities` row | MISMATCH (gap only; status defaults to `open`; not the $0) |
| 11 | Letter pack: `crs_results.result.bureaus.{TU,EX,EQ}` (`runTierEngineFromCrsResult`) then `engine.normalized.tradelines` | Simulate has top-level `tradelines[]`, no `bureaus` map, no `normalized` | **MISMATCH — empty letter pack** |

**Not a mismatch (tradelines):** simulate plants CRS sandbox keys (`creditorName`, `creditLimitAmount`, `currentBalanceAmount`, `accountIdentifier`, `accountOpenedDate`). Ingest maps those onto `tradelines.lender / kind / credit_limit_cents / balance_cents / opened_on`. Adapter reads those columns. Four lines land. Utilization from those lines is 17.44%. The engine never sees them when no bureau has a score.

**Lender matches (related, not this starve):** W-CONV `02-lender-matches.json` was `match_count: 0` because `lender_count: 0`. `matchForClient` reads `clients.custom_fields` state + `inquiry_log` + the lenders table. It does not read UnderwriteIQ.

## 1. What adapter + engine READ for a client’s file

`engine.mjs` reads **no table**. It only takes an in-memory `{ experian, equifax, transunion }` bag plus `businessAgeMonths`.

`adapter.mjs` is also pure. The live I/O is `api/read/underwrite.mjs`:

| table | columns |
|---|---|
| `clients` | `id`, `custom_fields` (scoped by `org_id`) |
| `tradelines` | `*` — adapter uses `id`, `kind`, `credit_limit_cents`, `balance_cents`, `opened_on`, `closed_at`, `lender` |
| `card_liabilities` | `*` — adapter uses `tradeline_id`, `payment_status` |
| `crs_results` | `result`, `created_at` |

`clients.custom_fields` keys the adapter pulls:

- `crs_inquiries_ex` / `crs_inquiries_eq` / `crs_inquiries_tu`
- `crs_negative_items_count`
- `crs_late_payments_count`
- `business_age_months`

`crs_results.result` keys `triMerge` / `scoresFromResult` pull (this is the score gate):

- skip if `result.environment === "sandbox"`
- `result.scores.ex|experian`, `.eq|equifax`, `.tu|transunion`
- `result.scoreModels` / `result.score_models` (same bureau keys)
- else `result.bureaus.EX|EQ|TU.scores[]` (`scoreValue`, `modelName`)

A bureau with no score is **not handed to the engine**. No bureau → no tradelines passed → `$0`, score painted `0`, `lite_banner_funding: null`.

Adapter source label for that miss: `crs_results.result.scores`.

## 2. What simulate WRITES

`src/demo/simulate-client.mjs` → `loadSimulatedClient`. Helpers: `buildSimulatedCrsPayload`, `firstSalesStage` (read-only), `ingestCrsResult` → `normalizeFromCrs` → `upsertTradelines`.

Live button (`POST /api/demo/simulate`) calls `loadSimulatedClient` only. It does **not** call `emitCrsResult`.

| table | columns / keys written |
|---|---|
| `clients` INSERT | `org_id`, `email`, `first_name`, `last_name`, `phone`, `channel_source='simulated'`, `tags=['is_demo','simulated']`, `consent_sms=true`, `is_demo=true` |
| `clients` UPDATE | `outcome_tier='FULL_FUNDING'`, `updated_at` |
| `clients.custom_fields` | **not written** |
| `crs_results` | `org_id`, `client_id`, `result` (jsonb), `outcome_tier='FULL_FUNDING'` |
| `tradelines` (via ingest) | `org_id`, `client_id`, `lender`, `kind`, `credit_limit_cents`, `balance_cents`, `apr`, `source`, `source_ref`, `account_ref`, `opened_on`, `raw`, `as_of` |
| `cards` | `org_id`, `client_id`, `pipeline_id`, `stage_id`, `owner` (if a sales stage exists) |
| `bank_accounts` | best-effort: `name`, `account_type`, `mask`, `current_balance_cents`, `currency_code`, `raw` |

`crs_results.result` keys planted by `buildSimulatedCrsPayload`:

- `outcome` = `FULL_FUNDING`
- `reason_codes` = `["sim_demo","low_util"]`
- `preapprovals.totalCombined` = `125000`
- `consumerSignals.scores.perBureau.{ex,eq,tu}` = `718 / 724 / 731`
- `consumerSignals.utilization.pct` = `18`
- `crm_payload.outcome` = `FULL_FUNDING`
- `crm_payload.contact.{email,name}`
- `crm_payload.scores.{ex,eq,tu}` = `718 / 724 / 731`
- `crm_payload.customFields.total_funding_estimate` = `125000`
- `crm_payload.customFields.crs_utilization` = `18`
- `tradelines[]`: `creditorName`, `accountType`, `creditLimitAmount`, `currentBalanceAmount`, `accountIdentifier`, `accountOpenedDate`, `bureau`

No top-level `result.scores`. No `result.bureaus`. No `result.normalized`.

## 3. Re-confirm (current source, this session)

Same chain as the live read: `toBureaus` → `computeUnderwrite` on today’s `buildSimulatedCrsPayload` + ingested lines.

| input | available bureaus | combined $ | banner |
|---|---|---|---|
| Raw simulate `result` (live seed) | `[]` | `0` | `null` |
| Same file + top-level `result.scores.{ex,eq,tu}` | EX/EQ/TU | `412500` personal | `137500` |
| That plus the six `custom_fields` counts | EX/EQ/TU | `939500` | `137500` |

W-UW `stored-crs.json` / `engine-output.json` match the first row (`available: []`, totals `$0`).

If someone later runs `emitCrsResult` with lifecycle handlers on, `onAnalysisCompleted` does `result = result || { scores, utilization, … }`. That **adds** top-level `scores`. The Finance OS simulate button does not do that.

## 4. Test runs

Environment: local `.env` present. `DATABASE_URL` set: **yes**. Target host recorded as `aws-1-us-west-2.pooler.supabase.com:5432/postgres` (no secret printed).

| command | DB? | result | shape used |
|---|---|---|---|
| `node --test src/underwrite/fixtures.test.mjs` | not needed | **15 pass / 0 fail / 0 skip** | Engine-native fixtures (`experian: { score, tradelines… }`). Not the simulate CRS nest. FIXTURE 1 computes card funding `$110000`. FIXTURE 3 (no bureaus) is the same `$0` / score `0` the starved live file hits. |
| `node --test src/underwrite/underwriteiq.pg.test.mjs` | yes | **1 pass / 0 fail / 0 skip** | Live `loadSimulatedClient` **then** `emitCrsResult` (lifecycle merges `result.scores`). Asserts `adapter.available.length > 0`. This is **not** the raw simulate-only shape the live underwrite read uses. |

Also found (not required): `src/underwrite/adapter.test.mjs` plants `result: { scores: { ex, eq, tu } }` — the shape `triMerge` already knows.

**Rule applied:** fixtures pass on fixture shapes; live simulate shape starves the engine. Fault is the **seed / adapter boundary**, not the engine.

## 5. Teardown orphans for `41a3199f-1835-4ac8-91c0-d4f37bd92037`

Read-only count on the same `DATABASE_URL`. `clients.id` = **0** (matches board note).

No table named `letters` or `letters_generated`. Letter table is `dispute_letters`.

Every public table/view with a `client_id` column was counted. **All zero.** Events with this id in `client_id` or `payload` text: **0**.

| table | count | sample ids |
|---|---|---|
| `clients` (by `id`) | 0 | — |
| `dispute_letters` | 0 | — |
| `events` | 0 | — |
| `documents` | 0 | — |
| `tradelines` | 0 | — |
| `crs_results` | 0 | — |
| `contracts` | 0 | — |
| `messages` | 0 | — |
| `client_consents` | 0 | — |
| `cards` | 0 | — |
| `inquiry_removal_cases` | 0 | — |
| `inquiry_log` | 0 | — |
| `inquiry_prep` | 0 | — |
| all other `client_id` tables/views (72 checked) | 0 | — |

**Orphans: none.** W-TEAR leftovers from 2026-08-18 are gone.

## Evidence

- This file
- `docs/workflows/audit-engine-2026-08-18-evidence/w-uw/stored-crs.json`
- `docs/workflows/audit-engine-2026-08-18-evidence/w-uw/engine-output.json`
- `docs/workflows/audit-engine-2026-08-18-evidence/w-uw/NOTES.md`
- Current-source re-run of `toBureaus` + `computeUnderwrite` on `buildSimulatedCrsPayload` (this session)
- Test TAP: fixtures 15/15; `underwriteiq.pg.test.mjs` 1/1
