# CRS Softview client — 2026-08-07

**Batch:** crs-softview  
**Started:** 2026-08-07  
**Owner decisions locked:**
- Build CRS Softview client from scratch (prior "crs-softview.mjs exists" report was wrong).
- Auth is Basic Auth (USERNAME/PASSWORD) on a host — not API key / account id.
- Sandbox only for all testing. Production credentials exist but MUST NOT be set yet.
- CRS forbids testing in production. Only CRS-provided test identities.
- Write `crs_results` + tradelines + fulfil request + emit events without duplicate rows.
- Metro 2 / W1 stays blocked and out of scope.

## Env var names (canonical)

| Context | CRS_API_USERNAME | CRS_API_PASSWORD | CRS_API_HOST |
|---|---|---|---|
| Sandbox (set now) | FundHubSbox | (secret) | api-sandbox.stitchcredit.com |
| Production (do NOT set) | FundHubAPI | (secret) | mware.crscreditapi.com |

## Task list

| ID | Unit | Owner | Status |
|---|---|---|---|
| W2-A | Postman/contract + test identities | this session | done |
| W2-B | Result coordinator (one write, events, no dupes) | this session | done |
| W2-C | Client + soft-pull wiring + tests | this session | done |
| W2-D | Sandbox Netlify secrets + one deploy | this session | done — deploy `d42a2ff` ready; migration 157 still blocked |

## Findings / blockers

- Sandbox CRS login smoke: **ok** (token issued) with `ADAPTERS_DRY_RUN=0` locally.
- Netlify already has sandbox `CRS_API_*` on production / deploy-preview / branch-deploy. Production CRS host/creds are **not** set (correct).
- `ADAPTERS_DRY_RUN` and `MESSAGING_DRY_RUN` remain on in Netlify — live site will not call CRS until the fence is turned off.
- **Blocked:** cannot apply migration 157 from this machine. Netlify marks `DATABASE_URL` as a secret and `env:get` / API return only stars. Need a usable `DATABASE_URL` (or owner runs `node db/migrate.mjs`).
- Metro 2 / W1 stays out of scope.

## Change manifests

### Files touched (CRS Softview)

- `db/migrations/157_crs_result_identity.sql` — `processing` status; provider identity columns + uniqueness
- `db/expected-migrations.mjs` — registers 157
- `src/messaging/providers/crs-softview.mjs` (+ test) — only CRS outbound path; sandbox host allow-list; ADAPTERS fence
- `src/finance/crs-identities.mjs` (+ test) — sandbox fixture identities; refuses production host
- `src/finance/crs-client.mjs` (+ test) — login / refresh / order / retrieve
- `src/finance/crs-map.mjs` — merge tri-bureau reports into storage shape
- `src/finance/crs-pull.mjs` (+ test) — `runCrsPull` coordinator (claim → order → store → `analysis.completed`)
- `src/finance/soft-pulls.mjs` (+ unit/pg tests) — `coordinateCrsResult`, `claimSoftPull`, processing status
- `src/workflows/c-00-crs-soft-pull-request.mjs` — ledger request then `runCrsPull`
- `src/adapters/crs.mjs` (+ test) — anchored emit; stable event keys
- `src/handlers/client-lifecycle.mjs` (+ test) — reuse anchored row (anti-duplicate)
- `src/lib/outbound-fetch.mjs` — response headers (CRS `RequestID`)
- `docs/workflows/crs-softview-2026-08-07.md` — this board
- `docs/workflows/crs-credentials-2026-08-07.md` — contract notes from collision session
- `docs/workflows/crs-integration-path-2026-08-07.md` — path notes

### Journeys

- Route tables unchanged (`/api/finance/soft-pull` already listed). Behavior change is Inngest C-00 (not a new route).

### Exports / env

- Reads: `CRS_API_USERNAME`, `CRS_API_PASSWORD`, `CRS_API_HOST`, `ADAPTERS_DRY_RUN`
- Sandbox host only in code; production host hard-refused

