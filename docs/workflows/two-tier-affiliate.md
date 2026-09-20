# Two-tier affiliate — make it actually work

Batch board. Opened 2026-09-20. Branch `claude/portal-welcome-video-v6iwef`.
Research: 5 parallel Sonnet agents, read-only, run `wf_55742915-9b3`.
Findings below were re-verified by hand where the agents disagreed.

---

## Ground truth (verified, with evidence)

### Correction to my own earlier finding

`docs/ads/portal-welcome-video.md` said the Refer a friend button does not exist.
**That was wrong, and it was wrong because I searched one file.** Exactly the failure
CLAUDE.md §2 names.

There are **two** client-facing screens, not one:

| Screen | Path | Has Refer a friend? |
|---|---|---|
| Client Portal (where the welcome video plays) | `/app/client-portal.html` | **No** — full-file grep, zero hits |
| Progress page | `/progress.html` | **Yes** — `public/progress.html:213`, `:1310` (`#refGo`), wired to `POST /api/affiliates/refer` |

`client-portal.html:610` links out to `/progress.html`. So a client *can* reach the
button — two clicks away, on a different page, below "Your documents" and "What has
happened so far". The welcome video tells them to press a button that is not on the
page they are looking at.

### What is genuinely built and working

- `POST /api/affiliates/refer` — `api/affiliates/refer.mjs:85-191`. Client-only principal
  (`:87`). Idempotent three ways: early return on `accounts.affiliate_id` (`:132-146`),
  `SELECT ... FOR UPDATE` in one transaction (`:109-121`), unique index
  `accounts_affiliate_uniq` (`044_accounts.sql:81`). Returns `{ok, enrolled, created, code, shareUrl}`.
  Routed at `netlify/functions/api.mjs:413`.
- Rates are live data, owner-set: 20% direct / 5% downline —
  `db/migrations/261_affiliate_tier1_20pct_20260824.sql`. `affiliate_id NULL` = applies to
  every affiliate (`033_affiliates.sql:211-214`), so a brand-new affiliate is covered
  with no extra row.
- Commission math is real and correct — `src/affiliates/economics.mjs`: `findRule()` (`:144-170`)
  returns null rather than inventing a rate; `commissionFor()` (`:175-205`) computes in
  integer cents via `src/commissions/money.mjs`.
- Accrual is wired to the live payment path — `convert()` (`economics.mjs:315-414`) is called
  by `convertSafe()` from `src/handlers/money-chain.mjs:467-481`, inside `settle()`, on every
  `sale_payments` insert.
- Tier-2 unlock is implemented and one-way — `maybeUnlockTier2()` (`economics.mjs:445-478`).
- Direct (tier 1) attribution fires in production — `src/workflows/af-02-referral-ownership-capture.mjs:50-75`
  resolves `a1` to an affiliate and calls `attribute(..., tier:"direct")`.
- Click capture works — `public/start.html:29-58` posts to `/api/public/affiliate-click`
  (`api/public/affiliate-click.mjs`). The comment in that file saying "NOTHING CALLS THIS YET"
  is stale and wrong.
- Schema for two tiers exists — `affiliates.recruited_by` (`033_affiliates.sql:68`) with a
  cycle/cross-org guard (`:157-188`), `direct_downline_count` trigger rollup (`:750-772`),
  `affiliate_referrals.tier` accepting `'direct'|'downline'` (`:316-317`), `tier2_unlocked_at`.

### What is broken — the three real gaps

**GAP 1 — Tier 2 never earns a cent. Nothing in production ever calls
`attribute(tier:'downline')`.**
`grep -rn "tier: *['\"]downline" src/ api/ scripts/` returns hits in **test files only**
(`economics.pg.test.mjs:133,485,507,512`; `success-fee-share.pg.test.mjs:142`).
`af-02-referral-ownership-capture.mjs:44` writes the `a2` code into
`clients.custom_fields.affiliate_tier2_owner` as a raw string and stops there. It never
resolves `a2` to an affiliate row, never writes an `affiliate_referrals` row, never accrues.
Compare `:50-75`, which does all three for `a1`. The 5% is defined, tested, and unreachable.

**GAP 2 — No affiliate ever gets an upline. `affiliates.recruited_by` has no production writer.**
`grep -rn 'recruited_by' src/ api/ scripts/ netlify/ --include=*.mjs` (excluding tests):
`economics.mjs:464` **reads** it, `api/read/affiliates.mjs:83` **reads** it. Zero writes.
(`src/partners/recruit.mjs` writes `partners.recruited_by_partner_id` — a different table in
a different system. Not this.) So the downline edge is a column that is always NULL.

**GAP 3 — Nothing ever pays anyone. No production writer for `affiliate_payouts`
or `affiliate_payout_lines`.**
Every INSERT into those tables across the whole repo is a test fixture or demo seed
(`src/http/affiliate-stats.pg.test.mjs:250,255`, `src/demo/simulate-client.mjs`,
`src/demo/platform-seed.mjs`, `scripts/purge-sim-data.mjs`). No workflow, sweeper or
scheduled job batches converted referrals into a payout.
`api/read/affiliate-portal.mjs:134-150` can read payouts, but none are ever created.
Money owed sits forever as `affiliate_referrals.commission_due`.

### Noted, not in scope unless asked

- `affiliate_referrals.commission_due` / `basis_amount` are `numeric(14,2)` **dollars**, not
  integer cents — a schema-level exception to the CLAUDE.md §12 money rule. The arithmetic
  itself is correct (cents internally, converted at `economics.mjs:210-212`). Changing the
  column type is its own migration decision.
- `api/read/affiliates.mjs` header flags a known drift: `custom_fields` vs `affiliate_referrals`
  as two disagreeing sources of direct-referral counts.
- Stale comments in `public/app/affiliate.html:470,579,591,770` claim `LEADS`/`PAYOUTS` are
  never assigned. They are assigned, at `:1193` and `:1207`. Comments should be corrected.
- `api/public/affiliate-click.mjs:~30-34` "NOTHING CALLS THIS YET" — stale, wrong.

---

## Task list

| # | Task | Owner | Status |
|---|---|---|---|
| 1 | Refer a friend card in `client-portal.html` | — | pending |
| 2 | Write `affiliates.recruited_by` when a referred client enrols | — | pending |
| 3 | Resolve `a2` and accrue the 5% downline in af-02 | — | pending |
| 4 | Tests for 1–3 | — | pending |
| 5 | Journeys + changelog + stale-comment cleanup | — | pending |
| 6 | Payout generator (GAP 3) | — | **blocked — owner decision needed** |

## Blockers / open questions

- **Q1 (blocking task 3): what defines tier 2?** See the plan section below. Awaiting Chris.
- **Task 6** needs owner decisions: payout cadence, minimum threshold, and whether the
  license/tax gates (`api/read/affiliate-portal.mjs:56-62`) block creating a payout or only
  releasing it. Not inferrable. Flagged, not started.

## Change manifests

(written here by each task as it completes)
