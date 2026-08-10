# CRS Softview client — 2026-08-07

**Batch:** crs-softview  
**Started:** 2026-08-07  
**Status:** COMPLETE

**Owner decisions locked:**
- Build CRS Softview client from scratch (prior "crs-softview.mjs exists" report was wrong).
- Auth is username/password login on a host — not API key / account id.
- Sandbox only for all testing. Production CRS credentials MUST NOT be set yet.
- CRS forbids testing in production. Only CRS-provided test identities.
- Write `crs_results` + tradelines + fulfil request + emit events without duplicate rows.
- Metro 2 / W1 stays blocked and out of scope.
- Keep `vendor/underwriteiq/` (darwin808 snapshot). Do not delete it.
- Full engine lives in `vendor/underwriteiq-full/` (ZootimusMaximus/underwrite-iq-lite).
- Live underwriter keeps `liteBannerFunding = null` (not upstream `15000`).

## Env var names (canonical)

| Context | CRS_API_USERNAME | CRS_API_PASSWORD | CRS_API_HOST |
|---|---|---|---|
| Sandbox (set) | FundHubSbox | (secret) | api-sandbox.stitchcredit.com |
| Production (do NOT set) | FundHubAPI | (secret) | mware.crscreditapi.com |

## Task list

| ID | Unit | Owner | Status |
|---|---|---|---|
| W2-A | Postman/contract + test identities | this session | done |
| W2-B | Result coordinator (one write, events, no dupes) | this session | done |
| W2-C | Client + soft-pull wiring + tests | this session | done |
| W2-D | Sandbox Netlify secrets + one deploy | this session | done |
| W2-E | Tier adapter → `decision.rendered` | this session | done |
| W2-F | Migrations 157–159 on production | this session | done |
| W2-G | Vendor full UIQ + comparison report | this session | done |

## Findings (closed)

- Sandbox CRS login + TU smoke + tri-bureau tier smoke: ok.
- Smoke audit client `b8182618-3759-4a1f-9c53-0f6a9ad1cc19` kept with `is_demo=true`.
- `ADAPTERS_DRY_RUN=1` on all Netlify contexts (fence on).
- Overlapping darwin808 vs ZootimusMaximus paths: Zootimus newer by commit date on every conflict; document/PDF layer is in Zootimus, not darwin.
- darwin808 `main` never contained `api/lite/crs/` — that folder is only on ZootimusMaximus/underwrite-iq-lite.

## Change manifests

### Runtime

- `src/messaging/providers/crs-softview.mjs` — only CRS outbound path
- `src/finance/crs-*.mjs` — client, identities, map, pull, tier
- `src/finance/vendor/crs-engine.cjs` — static bridge to vendored engine
- `src/finance/soft-pulls.mjs` — claim / coordinate / processing
- `src/workflows/c-00-crs-soft-pull-request.mjs` — ledger then pull
- `src/adapters/crs.mjs` — anchored emit
- `db/migrations/157_crs_result_identity.sql`
- `db/migrations/158_soft_pull_processing_resolved_ck.sql`
- `db/migrations/159_soft_pull_processing_status_check.sql`

### Vendored (unwired inspection + engine source)

- `vendor/underwriteiq/` — darwin808 snapshot (kept)
- `vendor/underwriteiq-full/` — ZootimusMaximus/underwrite-iq-lite main (includes `api/lite/crs/`)
- `vendor/underwriteiq-crs/` — crs folder copy (if present; engine loads via underwriteiq-full)

### Not in this batch

- Metro 2 (`docs/metro2/`, `src/metro2/`) — out of scope
- Production CRS host/creds — not set
- Turning the outbound fence off permanently — left on

## 2026-08-10 — dual live gate (owner option C)

Live pulls need **two** keys: `CRS_API_HOST` = production host **and**
`CRS_ALLOW_LIVE` explicitly on (`1` / `true` / `yes` / `on`). Either missing
fails closed.

- `src/finance/crs-identities.mjs` — `livePullAllowed()`, gate, `identityForBureau`
- `src/finance/crs-client.mjs` — config respects both keys
- `src/messaging/providers/crs-softview.mjs` — transport allows production only when live is on
- Netlify: `CRS_ALLOW_LIVE=0` on production / deploy-preview / branch-deploy
- Tests: identities, client, map, provider, c-00
