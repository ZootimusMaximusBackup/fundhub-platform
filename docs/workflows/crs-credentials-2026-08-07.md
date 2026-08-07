# CRS credentials + sandbox client — 2026-08-07

One flow (owner). Netlify env, download review, then the sandbox CRS client.

**HALTED MID-BUILD — two sessions are building the same thing.** See "Collision"
below. Nothing here is finished; nothing here has been committed.

## Status

| Unit | Owner | Status |
|------|-------|--------|
| Review Downloads credential + Postman files | this session | done |
| Set Netlify `CRS_API_*` by context | this session | done, then overwritten by another session |
| Sandbox login smoke (no credit order) | this session | done — 200, token issued, clientName FUNDHUB |
| Sandbox identity guard (fail closed) | this session | built, untested |
| CRS HTTP client (login/refresh/order) | this session | built, untested |
| Tri-bureau mapper | this session | built, untested |
| Pull coordinator | this session | built against the WRONG seam — needs rework, see Collision |
| Wire `diagnostic.paid` | — | not started |
| Tests, lint, tsc | — | not started |

## Collision (read this first)

A second session is working the same task under
`docs/workflows/crs-softview-2026-08-07.md`. Its task **C3 "Build CRS client and
queue integration"** is the same work as this build. It edited shared files at
11:07–11:11 today, during this session.

Two concrete conflicts:

1. **Netlify production context was changed.** This session set the production
   context to the live CRS host with the production credentials, as the owner
   instructed. The other session replaced it with the sandbox host and sandbox
   credentials, recording an owner decision of "Production CRS credentials must
   remain unset". Verified at 11:1x: `CRS_API_HOST` in the **production** context
   is now `api-sandbox.stitchcredit.com`. The username and password values are
   masked by the CLI and were not printed, so which credential pair is in place
   was not independently confirmed. **Owner decision required — not re-set by
   this session.**

2. **Persistence seam moved.** The other session built the one-row coordinator
   this build was going to write:
   - `coordinateCrsResult()` in `src/finance/soft-pulls.mjs` — transactional,
     anchors on `(provider, provider_result_id)`, closes the request, ingests
     tradelines, refuses cross-org replays.
   - `db/migrations/157_crs_result_identity.sql` — adds `crs_results.provider`
     and `provider_result_id`, plus uniqueness guards. Registered in
     `db/expected-migrations.mjs`. **Not applied to any database yet.**
   - `onAnalysisCompleted()` now reuses an anchored row instead of inserting a
     second one — the double-write fix, already done and better than the version
     planned here.
   - `emitCrsResult()` now REFUSES without `crsResultId` and `requestId`
     (`missing_result_anchor`), and keys events `crs-result:<id>:<name>:v1`.

   `src/finance/crs-pull.mjs` in this build calls the older `recordPull()` and
   emits `analysis.completed` itself. It must be reworked onto
   `coordinateCrsResult()` before it is used. It is not wired to anything, so
   nothing runs it today.

## Downloads reviewed (`~/Downloads`, 2026-08-07)

| File | What it is |
|------|------------|
| `api-credentials-FundHubSbox-2026-08-07.txt` | Sandbox username/password + host. Forbids testing on own identity; sandbox only. |
| `api-credentials-FundHubAPI-2026-08-07.txt` | Production username/password + host. Live data, no testing, FCRA permissible purpose, US data residency. |
| `fundhub-llc-20260807-CRS-Sandbox.json` | Postman collection `FUNDHUB LLC(20260807)-CRS-Sandbox`. Not a sample bureau payload. |
| `CRS Sandbox — JSON Payload Library.md` | Real TransUnion and Experian sample payloads. No Equifax sample. |

### Auth contract (from the collection, not inferred)

1. `POST /api/users/login` with `{ username, password }` — no API key.
2. Response carries `token`, `refreshToken`, and `expires: 3600` (**seconds**).
3. Later calls send `Authorization: Bearer <token>`.
4. `POST /api/users/refresh-token` with `{ refreshToken }`.
5. The order returns its `RequestID` in a **response header**, not the body.

### Consumer prequal routes (sandbox base `https://api-sandbox.stitchcredit.com/api`)

| Bureau | Order path |
|--------|-----------|
| TU | `/transunion/credit-report/standard/tu-prequal-fico9` |
| EX | `/experian/credit-profile/credit-report/standard/exp-prequal-fico9` |
| EQ | `/equifax/credit-report/standard/efx-prequal-fico9` |

Experian nests under `/credit-profile/`; the other two do not.

### Payload shape (read from the vendor's samples)

Top level: `requestData`, `repositoryIncluded`, `responseDetail`, `creditFiles`,
`inquiries[]`, `tradelines[]`, `publicRecords[]`, `scores[]`.

- `tradelines` is already top level, so the existing tradeline reader finds it.
- `scores[]` mixes credit scores with income estimators. In every sample, only
  the credit scores carry an integer `scoreValue` **and** an integer
  `scoreMaximumValue`; the estimators carry a null maximum and values like
  `"47 B"`. That filter is read off the data, not invented.
- No Equifax sample exists, so its model name is unknown. The mapper falls back
  to the numeric filter and records the model name it used.

### Sandbox test identities — one per bureau

CRS publishes a different canned person for each bureau, so a tri-bureau sandbox
pull is three different invented people. A sandbox pull is therefore **not** a
tri-merge of one person and must never be read as one.

## Netlify context mapping (as this session set it, before it was overwritten)

| Context | Host | Credentials |
|---------|------|-------------|
| `deploy-preview`, `branch-deploy` | sandbox | sandbox |
| `production` | live | production |

Current actual state: all three contexts point at the sandbox host.

## Change manifest

Files added by this session (all untracked, none wired, none tested):

- `src/finance/crs-identities.mjs` — hosts, the vendor's sandbox identities, and
  the fail-closed gate. Refuses an unrecognised host; refuses any non-test
  identity on the sandbox host; refuses a test identity on the production host.
  Called by the client on every order, so no caller can skip it.
- `src/finance/crs-client.mjs` — login, token cache, refresh, order, retrieve.
  All traffic via `transmit()` behind the ADAPTERS fence.
- `src/finance/crs-map.mjs` — three bureau reports into one payload. Strips the
  bureau's echo of the client's SSN before storage.
- `src/finance/crs-pull.mjs` — coordinator. **Built on the wrong seam, see
  Collision.**

File modified by this session:

- `src/lib/outbound-fetch.mjs` — `transmit()` now returns response `headers`.
  Additive; every existing caller is unaffected. Needed because the CRS
  `RequestID` exists only in a header and callers cannot reach the Response.

Not done: `diagnostic.paid` wiring, any test, lint, `tsc`, journeys, changelog.

No deploy was run by this session.

## 2026-08-07 11:20 — STOPPED. The other session never stood down.

Owner ruled at ~11:15 that this session finishes and the softview session stops.
The softview session is still running. It wrote to shared files at 11:17:40 and
11:18:08, while this session was mid-build. Proof, not inference:

- `src/finance/crs-pull.mjs` — this session wrote `CRS_PROVIDER = "crs"` and one
  `coordinateCrsResult()` call. The file on disk now says `"crs_softview"` and
  has two calls, at lines 212 and 327.
- `src/finance/crs-identities.mjs` — `identityForBureau()` lost its `identity`
  parameter. `crs-pull.mjs:266` still passes one. Extra properties are ignored
  in JavaScript, so this does not throw; the real client is loaded and then
  silently discarded.
- `src/finance/crs-client.mjs` — gained a production-host refusal at line 162
  that this session did not write.

### Current state, measured not assumed

All five files parse. `c-00` keeps its 3 original tests green. The new identity
suite is 15 pass / 4 fail, and all four failures are the same disagreement, not
a bug: the tests assert a real identity is allowed on the production host, and
the code now refuses that host outright.

### The one behaviour change nobody approved

The softview session hard-coded the production host as refused, in code, with
`production_host_refused`. The owner's decision was that the **Netlify variable**
points at sandbox and that flipping to live is a separate deliberate call he
makes later. Those are different things: a config value he can change, versus a
code path he cannot reach without a new deploy. This was not asked for and is
left in place pending his answer rather than reverted unilaterally.

### Done since the last entry

- `src/finance/crs-pull.mjs` reworked onto `coordinateCrsResult()`. One stored
  row, one event keyed `crs-result:<id>:analysis.completed:v1`. `emitCrsResult()`
  deliberately not called — it also emits `decision.rendered`, which needs an
  outcome tier no bureau report contains.
- `src/workflows/c-00-crs-soft-pull-request.mjs` wired: ledger request first
  (that is where the consent gate lives), provider call second, as separate
  steps. `costCents` left NULL — the $32 is revenue, not the pull's cost.
- `src/finance/crs-identities.test.mjs` — 19 tests, including a structural one
  that fails if any allow-listed SSN leaves the never-issued 666 range.

### Not done

Tests for the client, mapper, pull coordinator and `c-00`. Lint, `tsc`, full
suite, migration 157 applied, journeys, changelog. No deploy.

## Open questions for the owner

1. **Stop the softview session.** It cannot be stopped from inside this one.
   Until it is, anything written here can be overwritten mid-edit.
2. **Production host: refused in code, or reachable by config?** See above.
3. **Cross-bureau duplicate tradelines** — when two bureaus report the same card
   under different account identifiers, nothing can prove they are one account
   without a matching heuristic. Today both lines would be stored, which
   overstates available credit. No rule has been decided, so none was invented.
