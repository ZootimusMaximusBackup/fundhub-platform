# fundhub-beta-buildout — shared board

This file is the communication layer between the workflows in this batch. Agents do
not message each other; they read and write here. Keep it readable by a non-coder.

**Board created by:** banking-compliance-revoke-erasure (this file did not exist when
that workflow started — recorded as a finding, not silently assumed to live elsewhere).

---

## Task list

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Revoke a bank login (credential removal, account cascade, deliberate transaction handling) | banking-compliance-revoke-erasure | done |
| 2 | Orphan bug: bank transactions lose every route back to the person when a client is deleted | banking-compliance-revoke-erasure | done |
| 3 | Client erasure / de-identification with an auditable request record | banking-compliance-revoke-erasure | done |
| 4 | Key rotation for encrypted provider tokens, no plaintext ever written | banking-compliance-revoke-erasure | done |
| 5 | Prove rotation with a test that rotates then decrypts | banking-compliance-revoke-erasure | done |
| — | `src/banking/provider.mjs` | another workflow | not mine — untouched |

**Migration numbers claimed by this workflow: 101 and 102. No others.**

---

## Shared context brief

### The tables this touches

- `plaid_items` (080) — one row per **bank login**. Holds the encrypted access token.
  `client_id` cascades on client delete.
- `bank_accounts` (081) — the individual accounts behind a login. Cascades from both
  `clients` and `plaid_items`.
- `bank_transactions` (085) — the money ledger. `client_id` is `ON DELETE SET NULL`
  (deliberate: deleting a client must not destroy the evidence money moved).
  `bank_account_id` has **no foreign key** — 085's header records that as a known gap.

### The orphan bug, in one paragraph

Delete a client and two things happen at once. `bank_transactions.client_id` is set to
NULL, and every `bank_accounts` row for that client is cascade-deleted. The transaction
rows keep a `bank_account_id` value, but the account it names no longer exists. So there
is no route from the person to the rows and no route from the rows back to the person.
A later erasure request cannot find them. They are invisible and permanent.

### The fix (migration 101)

`bank_transactions.subject_client_id` — a durable copy of the client id that is
**deliberately not a foreign key**, so nothing cascades or nulls it. Populated by a
BEFORE INSERT/UPDATE trigger so any writer picks it up, including a psql session or a
backfill this repo does not own. Backfilled for existing rows.

### Decisions other workflows need to know

1. **Revoking a bank login does NOT delete transactions.** It removes the credential and
   the accounts. The ledger stays, anchored by `subject_client_id`. Anyone writing an
   ingest path must not assume a revoke clears history.
2. **Erasure de-identifies; it does not DELETE the client row.** `pii_access_log.client_id`
   references `clients(id)` with no cascade, so a hard delete would be refused by the
   database anyway.
3. **Nothing here is automatic.** There is no scheduler and no retention sweep. Both
   actions run only on an explicit request that writes an audit row first.
4. **CRS is untouched.** `src/tradelines/`, `crs_results` and the soft-pull fulfil path
   were not modified. They are recorded as KEPT on every erasure with a written reason.

---

## Change manifest — banking-compliance-revoke-erasure

### Files added

| File | What it is |
|---|---|
| `db/migrations/101_bank_transaction_subject_anchor.sql` | The orphan fix: durable client anchor, trigger, backfill, index |
| `db/migrations/102_erasure_requests.sql` | The audit record: who asked, when, what was removed, what was kept and why |
| `src/db/with-transaction.mjs` | The correct transaction helper, shared |
| `src/banking/revoke.mjs` | Revoke a bank login |
| `src/banking/revoke.test.mjs` | Revoke unit tests, stubbed db |
| `src/banking/revoke.pg.test.mjs` | Revoke against real Postgres (skips with no `DATABASE_URL`) |
| `src/banking/key-rotation.test.mjs` | Rotation proof: rotate, then decrypt (pure, runs every pass) |
| `src/banking/key-rotation.pg.test.mjs` | Rotation against real Postgres: no plaintext in the table, no downtime |
| `src/banking/orphan-anchor.test.mjs` | Schema-contract test — fails if migration 101 is reverted |
| `src/privacy/erasure.mjs` | Client erasure / de-identification |
| `src/privacy/erasure.test.mjs` | Erasure unit tests, stubbed db |
| `src/privacy/erasure.pg.test.mjs` | Erasure against real Postgres (skips with no `DATABASE_URL`) |
| `api/banking/revoke.mjs` | `POST /api/banking/revoke` |
| `api/privacy/erasure.mjs` | `POST/GET /api/privacy/erasure` |
| `src/http/banking-revoke.test.mjs` | Endpoint tests, stubbed db |
| `src/http/privacy-erasure.test.mjs` | Endpoint tests, stubbed db |

### Files changed

| File | Change |
|---|---|
| `src/banking/plaid.mjs` | Added key rotation (`plaidTokenKeyId`, `rotatePlaidTokenCiphertext`, `rotatePlaidTokens`) and `KEY_ID_PATTERN`. Nothing existing changed. |
| `netlify/functions/api.mjs` | Two ROUTES entries: `banking/revoke`, `privacy/erasure` |

### Exports added

- `src/banking/plaid.mjs` — `plaidTokenKeyId`, `rotatePlaidTokenCiphertext`, `rotatePlaidTokens`, `KEY_ID_PATTERN`
- `src/banking/revoke.mjs` — `revokeBankLogin`, `listBankLogins`, `RevokeError`
- `src/privacy/erasure.mjs` — `eraseClient`, `listErasureRequests`, `ErasureError`, `KEPT_WITH_REASON`
- `src/db/with-transaction.mjs` — `withTransaction`

### Routes affected

- `POST /api/banking/revoke` — owner/admin only
- `POST /api/privacy/erasure`, `GET /api/privacy/erasure?client_id=` — owner/admin only

### Journeys impacted

`docs/journeys/` **does not exist in this repository.** No `-actual.md` file was updated
and none was invented. Recorded under blockers below.

---

### How this was verified

A real PostgreSQL 16 was started locally, all 68 migrations applied including 101 and 102,
and the suite run against it. Both migrations apply cleanly from scratch.

| Check | Result |
|---|---|
| Full suite, no `DATABASE_URL` (the CI condition) | 2680 tests, **0 fail**, 350 skip |
| This workflow's tests, against real Postgres | 160 tests, **0 fail** |
| New `.pg.test.mjs` files with `DATABASE_URL` unset | **skip**, never pass (21 + 8) |
| New failures vs `origin/main` on the same database | **none** — failure lists diffed, empty |

The repository has pre-existing failures against a real database (~36 after the first run;
CLAUDE.md §12 records this and the order-dependence behind it). `origin/main` was checked
out into a separate worktree and run against its own fresh database to establish that
baseline. Every failure in this branch's run is also in the baseline's. Nothing here
added one.

**Two bugs in this workflow's own tests were caught only by running against a real
database**, and both would have shipped as green otherwise: the `orgs` seed omitted the
NOT NULL `slug` column, and the cleanup deleted clients by email — which silently misses
an erased client, because erasure sets the email to NULL.

## Blockers and open questions

1. **`docs/journeys/` is absent.** CLAUDE.md §4 requires every flow to have an intended
   and an actual Mermaid file, and requires `-actual.md` to be updated in the same commit
   as the code. The directory does not exist and neither does `docs/journeys/CHANGELOG.md`.
   Generating an `-actual.md` with no `-intended.md` to read first would invert the rule
   that says read the intended journey before building, so nothing was written. **Someone
   needs to decide whether these journeys are being tracked.**

2. **`docs/compliance/` is absent.** CLAUDE.md §7 says domain rules live there and must be
   read before touching related code. There was nothing to read. The compliance decisions
   in this work are therefore written into the migration headers and the module headers,
   where the next reader will find them.

3. **`src/pii/index.mjs` `revealSsn()` runs with autocommit.** Its `withTransaction` uses
   the `typeof db.connect !== "function"` probe. `src/db.mjs` exports `db` as `{ query }`
   with no `connect()`, so the probe takes the no-transaction branch on the handle every
   production caller passes. Rule 3 in that file's own header — "if the log write fails,
   the reveal fails" — does not hold as shipped. `src/finance/soft-pulls.mjs` already
   recorded this and declined to fix it. **Not fixed here either** — it is a behavioural
   change to a compliance path and deserves its own review. Reported, not touched.

4. **`bank_transactions.bank_account_id` still has no foreign key.** Adding one would
   change what happens when a client is deleted (cascade would destroy the ledger,
   restrict would refuse the delete). That is a decision with a compliance consequence,
   not a schema tidy-up, so it was left alone and the durable anchor was added instead.
