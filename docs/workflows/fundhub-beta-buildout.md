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

**None, and this is verified rather than assumed.** `npm run journeys:check`
reports `docs/journeys is up to date (9 files)` with this branch merged.

The journey generator reads the routing table and each handler's gate. This unit
adds **no route and no gate** — the purge runner is a terminal command, not an
endpoint, so `netlify/functions/api.mjs`'s `ROUTES` map is untouched. Nothing for
the generator to pick up.

`docs/journeys/` did not exist when this unit started. It does now: W2 built it on
`claude/journeys-actual-generated` and it merged to `main` as `e68bb63`. That
branch point is merged into this one, so the check above ran against the real
generator rather than against an empty folder.

### The retention windows — OWNER-SET

The owner set these directly, as the decision-maker for this business, and asked
for them to be recorded as owner-set. They are not derived, not defaults, and
not this build's invention.

| Data class | Owner stated | Stored | Action at expiry |
|---|---|---|---|
| `crs_raw_payloads` | 25 months | 762 days | de-identify |
| `pii_access_log` | 25 months | 762 days | delete |
| `soft_pull_ledger` | 25 months | 762 days | delete |
| `bank_transactions` | 24 months | 731 days | de-identify |
| `mock_data` | 7 days | 7 days | delete |

**Months round UP to days, never down.** `retain_days` is an integer number of
days; months are 28–31 days long, so the conversion direction is a real choice.
Rounding up costs a few days of storage. Rounding down destroys records *before*
the window they were meant to cover has elapsed, permanently. 762 and 731 are the
longest possible 25- and 24-month spans — verified against Postgres's own
calendar in `scripts/retention-purge.pg.test.mjs`, not computed by hand. A naive
25 × 30.4 = 760 would have been **two days short** for a window starting in the
wrong month.

**Default org only.** Every other org — white-label tenants, anything created
later — still gets a policy row with `retain_days` NULL and is still reported by
`v_retention_policy_gaps`. One business's retention decision is not another's.

**Condition stated by the owner, recorded here so it does not get lost:** counsel
reviews these before real customers are onboarded. Note the trade-off that comes
with signing off — `v_retention_policy_gaps` reports a class until it is *both*
set *and* signed off, so the default org is now silent in that report. The
condition therefore lives in each row's `notes` column and here, not in the gaps
report. **If counsel changes a number, that is a NEW migration** — `migrate.mjs`
keys `schema_migrations` by `<dir>/<file>`, so editing 100 after it has been
applied is a silent no-op. Supersede it the way 089 superseded 088.

**Why 100 was edited rather than superseded this time:** migration 100 has never
been applied to any real database (production is unreachable from here) and the
branch is unmerged, so there is no `schema_migrations` row to make an edit inert.
That stops being true the moment it is applied anywhere. **If 100 has already been
applied in your environment, do not edit it — add a new migration.**

---

## Open findings

1. ~~**`docs/journeys/` and `docs/compliance/` do not exist.**~~ **RESOLVED for
   journeys** — W2 generated `docs/journeys/` from code on
   `claude/journeys-actual-generated`, merged to `main` as `e68bb63`. Merged into
   this branch; `npm run journeys:check` is clean. `docs/compliance/` (CLAUDE.md
   §7) still does not exist, and the owner has confirmed the folders are coming —
   left as-is, not flagged again.

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

5. **The transaction helper will need consolidating once PR #59 lands.** This unit
   exports the working `withTransaction` from `src/finance/soft-pulls.mjs` rather
   than writing a second copy. `docs/workflows/pii-and-journeys.md` records that
   PR #59 introduces `src/db/with-transaction.mjs` as a shared module, and that
   W1 will delete the broken copy in `src/pii/index.mjs` once it merges. When that
   happens `scripts/retention-purge.mjs` should import from the shared module too,
   and the `export` added here can go back to being private. Not a blocker — one
   import line — but it is the third helper in a tree that should have one.

6. **`bank_transactions` de-identification is partial by choice.** Merchant name
   and the verbatim provider payload are scrubbed; the amount, the dates and the
   client link stay. Severing `client_id` too would be stronger de-identification
   and would destroy per-client cash-flow history. That trade is a policy call,
   not an engineering one, and it is left to a human.

---

## Verification status

Verified against a throwaway local Postgres 16, not against production.

| Gate | Result |
|---|---|
| `npm test` (no `DATABASE_URL`) | **2238 pass, 0 fail**, 347 skip. The new `.pg` suite skips (26 skipped, 0 passed) rather than passing hollow. |
| `npm test` (with `DATABASE_URL`) | **26 failures, all pre-existing.** `main` on its own fresh database gives 27. Diffed both ways: **zero new failures**, and one baseline failure (`GET /api/read/inquiries`) that did not reproduce — one of the order-dependent inquiries suites CLAUDE.md §12 warns about. |
| Migration 100 applies | **yes** — applied cleanly as the 67th migration on a virgin database, twice (before and after the owner's windows landed) |
| New unit tests | **30 pass** |
| New database tests | **26 pass** against real Postgres |
| Month → day conversion | **checked against Postgres's calendar.** Longest 25-month span = 762 days, longest 24-month span = 731. Stored values match exactly: never short, never overshooting. |
| End-to-end CLI | **run for real, twice.** Dry run → every row count and both scrubbable fields unchanged. `--apply` with the owner's windows → an 800-day-old credit report was wiped while a **700-day-old one kept its payload**, proving the 762-day boundary. Access log, ledger row and demo event deleted; bank row kept with `merchant_name` scrubbed and `amount_cents` still `-4599`. |
| `npm run lint` | **no lint script exists in this repo** — not claimed |
| `npx tsc --noEmit` | **no TypeScript in this repo** — not claimed |
| Playwright | **not present in this repo** — not claimed |
| Applied to the real database | **no.** `api.netlify.com` and `api.supabase.com` are blocked by the network policy, so `DATABASE_URL` could not be read and the migration has not run anywhere but the throwaway local server. |
