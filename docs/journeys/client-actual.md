# Client journey — ACTUAL (generated from code)

> **SCOPE WARNING — READ THIS FIRST.**
>
> This file covers **one segment only**: soft-pull consent and the gate it puts
> in front of a credit pull. It was written while building migration 099 and it
> was traced from the code named in each node.
>
> Everything else in the client journey — signup, payment, deliverables, the
> portal at large — is **NOT** covered here and must not be read as absent from
> the product because it is absent from this diagram.
>
> **There is no `client-intended.md`.** `docs/journeys/` did not exist before
> this file; no journey in the tracked list (`client`, `role-owner`,
> `role-sales-manager`, `role-closer`, `role-funding-advisor`,
> `role-inquiry-remover`, `affiliate`, `white-label`) has either an intended or
> an actual file. CLAUDE.md §4 says agents do not author intended journeys, so
> none was invented here. **The gap between intended and actual for this segment
> is therefore unmeasured** — that absence is a finding, not something this file
> resolves.

## Soft-pull consent — what the code does today

Traced from:

- `db/migrations/099_client_consents.sql` — the table
- `src/consent/index.mjs` — `consentStatus` / `hasValidConsent` / `captureConsent` / `revokeConsent`
- `src/consent/disclosures.mjs` — the server-owned wording
- `api/consent/capture.mjs` — the endpoint
- `public/app/consent-capture.html` — the screen
- `src/finance/soft-pulls.mjs` — `requestSoftPull` (GUARD 0)
- `api/finance/soft-pull.mjs` — the pull endpoint

```mermaid
flowchart TD
    A[Someone opens consent-capture.html?client_id=ID] --> B{Session valid?}
    B -->|No| B1[401 — sign in again]
    B -->|Yes| C{Principal kind}

    C -->|staff| D{Role in owner/admin/closer/funding_advisor?}
    D -->|No| D1[403 — forbidden, nothing written]
    D -->|Yes| F
    C -->|client| E{Is this their own client_id?}
    E -->|No| E1[403 — forbidden]
    E -->|Yes| F

    F{Session carries an org_id?}
    F -->|No| F1[400 — refused, NOT defaulted to any org]
    F -->|Yes| G[GET reads consent status + history<br/>server sends the disclosure wording]

    G --> H[Screen shows the words, the state, and the history]
    H --> I{Action}

    I -->|Record consent| J[POST action=grant<br/>capture_method: typed / checkbox / signature]
    J --> J1{Typed or signed<br/>with no name?}
    J1 -->|Yes| J2[400 — refused]
    J1 -->|No| J3[Server looks up the wording BY VERSION<br/>body consent_text is IGNORED]
    J3 --> J4{Version known?}
    J4 -->|No| J5[400 — refused, not upgraded to current]
    J4 -->|Yes| J6[INSERT client_consents<br/>words copied in verbatim + immutable]

    I -->|Withdraw consent| K[POST action=revoke + reason]
    K --> K1{Reason given?}
    K1 -->|No| K2[400 — refused]
    K1 -->|Yes| K3[UPDATE ... WHERE id AND org_id AND revoked_at IS NULL]
    K3 --> K4{Row matched?}
    K4 -->|No| K5[409 — no live consent with that id]
    K4 -->|Yes| K6[Revoked. Trigger blocks any later edit or undo]
```

### The gate on the pull path

```mermaid
flowchart TD
    P[POST /api/finance/soft-pull] --> P1[requestSoftPull]
    P1 --> Q[Rule 1: attribution from the SESSION<br/>no requester = 401, no query issued]
    Q --> R[GUARD 0: read client_consents<br/>scoped by org + client + kind]

    R --> S{revoked_at IS NULL<br/>AND expires_at NULL or future<br/>AND granted_at not future?}
    S -->|No| T[403 code=consent_required<br/>NO ROW WRITTEN]
    S -->|Yes| U[GUARD 1: idempotency replay lookup]

    U --> V[GUARD 2: already-open request lookup]
    V --> W[INSERT soft_pull_requests status='queued']
    W --> X[STOPS. Nothing transmits — provider seam is empty]

    T --> T1{Which way did it fail?}
    T1 -->|none on file| T2[Go capture consent]
    T1 -->|expired| T3[Go capture a new consent]
    T1 -->|revoked| T4[STOP — do not ask again]
    T1 -->|no org on session| T5[Scope failure, ours not theirs]
```

### Deliberately NOT gated

`fulfilSoftPull()`, `recordPull()` and the CRS ingest path in `src/tradelines/`
are untouched by the gate. A pull that already happened is a fact; refusing to
store or normalise an answer that already arrived would lose the only copy of
what a bureau said about a person. Consent governs whether we may **ask**.

### Verified vs unverified

| Claim | State |
|---|---|
| Gate refuses when no consent exists | Verified — `src/finance/soft-pulls.test.mjs`, and by reverting the gate |
| Revoked consent fails immediately, nothing cached | Verified — unit test asserts two calls, two answers |
| Gate runs before both duplicate guards | Verified — asserted on query order |
| Org comes from session, body/query ignored | Verified — `src/http/consent-capture.test.mjs` |
| Consent wording cannot be set from the request body | Verified — `src/http/consent-capture.test.mjs` |
| CHECK constraints refuse an unattributed/blank consent | Verified against real Postgres 16 — `src/consent/consent.pg.test.mjs`, 27/27 |
| Immutability + one-way revocation triggers | Verified against real Postgres 16 — same suite |
| Migration 099 applies to a virgin database | Verified — full 67-file chain, no errors. **Not yet applied to Supabase** |
| Screen behaviour in a browser | **UNVERIFIED** — no Playwright in this repo |
