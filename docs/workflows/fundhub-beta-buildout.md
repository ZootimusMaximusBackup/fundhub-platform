# fundhub-beta-buildout

Shared board. Agents coordinate through this file, not with each other.
Human-readable on purpose — you should be able to see what happened without
opening a code file.

---

## Task list

| Unit | What it is | Owner | Status |
|---|---|---|---|
| MIGRATION-100 | Retention policy table, gaps view, purge runner (dry-run by default) | this session (`claude/migration-100-retention-policy-sn3x49`) | **done** |

No other units were claimed in this batch. The owner declined a parallel split
and asked for this one to run on its own.

---

## MIGRATION-100 — change manifest

**Branch:** `claude/migration-100-retention-policy-sn3x49`, cut fresh from `origin/main` @ `e67e2db`.

**COMPLIANCE REVIEW REQUIRED.** This unit touches consumer-credit records, the
PII access log and the soft-pull ledger. Nothing ships without human sign-off.

### Files added

| File | What it does |
|---|---|
| `db/migrations/100_retention_policy.sql` | `retention_policy` table (one row per org per data class) + `v_retention_policy_gaps` view |
| `src/retention/policy.mjs` | Reads the table. NULL stays NULL — an unset retention period never becomes a number. |
| `src/retention/classes.mjs` | The five data classes: how each is counted, and whether it is de-identified or deleted |
| `scripts/retention-purge.mjs` | The runner. Dry run by default; `--apply` is the only way it writes. |
| `scripts/retention-purge.test.mjs` | Unit tests, no database needed |
| `scripts/retention-purge.pg.test.mjs` | Database tests, including "a dry run changes nothing" |

### Files changed

| File | Change |
|---|---|
| `src/finance/soft-pulls.mjs` | Added the word `export` to `withTransaction`. No behaviour change — it is now importable instead of being copied. |

### Exports added

- `src/retention/policy.mjs` → `RetentionError`, `DATA_CLASSES`, `loadPolicy`, `policyGaps`
- `src/retention/classes.mjs` → `CLASSES`, `MOCK_MARKERS`, `classFor`, `countFor`, `applyFor`
- `src/finance/soft-pulls.mjs` → `withTransaction` (was already there, now exported)

### Routes affected

None. This unit adds no HTTP handler, so `netlify/functions/api.mjs`'s `ROUTES`
map is untouched and `src/http/routes.test.mjs` is unaffected.

### Journeys impacted

None updated, because **`docs/journeys/` does not exist in this repository.**
Neither does `docs/compliance/`, nor `docs/journeys/CHANGELOG.md`. CLAUDE.md §4
and §7 describe both as if they were present. Writing eight journey files from
memory would be inventing them, so this is reported as a gap rather than filled
in. See "Open findings" below.

### The decision this unit did NOT make

Every seeded `retain_days` is **NULL**, which means UNSET. Nobody has decided
how long any of this data is kept, and a retention period for consumer-credit
records is a legal question, not an engineering one. The consequence is that
the purge runner removes **nothing at all** today, even with `--apply`, on every
class, until a human sets a number and signs it off. That is the intended
starting state.

---

## Open findings

1. **`docs/journeys/` and `docs/compliance/` do not exist.** CLAUDE.md §4 requires
   an `-intended.md` / `-actual.md` pair per journey and §7 points at
   `docs/compliance/` for domain rules. Neither directory is in the repo. No
   journey could be read before building, and none could be updated after.

2. **Deleting a `crs_results` row can fail outright.** `soft_pull_requests.crs_result_id`
   is `ON DELETE SET NULL`, but `soft_pull_requests_result_ck` demands that a
   `fulfilled` row has a non-NULL `crs_result_id`. So the SET NULL violates the
   CHECK and the delete errors. This is why credit-report payloads are
   de-identified in place rather than deleted — see the migration header.

3. **The soft-pull ledger cannot be partially redacted.** `trg_soft_pull_requests_immutable`
   blocks updates to `client_id`, `requested_by_*`, `reason` and `requested_at`.
   De-identifying the row is impossible without changing that trigger, which is a
   compliance-path change and out of scope here.

4. **Mock data has no marker in the schema.** There is no `is_demo` column
   anywhere. The only identifiable mock rows are the ones
   `scripts/demo-journey.mjs` writes, recognised by their `demo:` idempotency
   keys. The demo *client* and everything cascading from it is counted and
   reported but never deleted — a cascading client delete touches five tables and
   is not something a script should do on its own.

5. **`bank_transactions` de-identification is partial by choice.** Merchant name
   and the verbatim provider payload are scrubbed; the amount, the dates and the
   client link stay. Severing `client_id` too would be stronger de-identification
   and would destroy per-client cash-flow history. That trade is a policy call,
   not an engineering one, and it is left to a human.

---

## Verification status

Verified against a throwaway local Postgres 16, not against production.

| Gate | Result |
|---|---|
| `npm test` (no `DATABASE_URL`) | **2238 pass, 0 fail**, 343 skip. The new `.pg` suite skips (23 skipped, 0 passed) rather than passing hollow. |
| `npm test` (with `DATABASE_URL`) | **26 failures, all pre-existing.** `main` on its own fresh database gives 27. Diffed both ways: **zero new failures**, and one baseline failure (`GET /api/read/inquiries`) that did not reproduce — one of the order-dependent inquiries suites CLAUDE.md §12 warns about. |
| Migration 100 applies | **yes** — applied cleanly as the 67th migration on a virgin database |
| New unit tests | **30 pass** |
| New database tests | **23 pass** against real Postgres |
| End-to-end CLI | **run for real.** Dry run twice → every row count and both scrubbable fields unchanged. `--apply` → deleted the access log, the ledger row and the demo event; kept the credit-report row (payload tombstoned, `outcome_tier` intact) and the bank row (`merchant_name` NULL, `raw` tombstoned, `amount_cents` still `-4599`). |
| `npm run lint` | **no lint script exists in this repo** — not claimed |
| `npx tsc --noEmit` | **no TypeScript in this repo** — not claimed |
| Playwright | **not present in this repo** — not claimed |
| Applied to the real database | **no.** `api.netlify.com` and `api.supabase.com` are blocked by the network policy, so `DATABASE_URL` could not be read and the migration has not run anywhere but the throwaway local server. |
