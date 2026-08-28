# Thread collision review — 2026-08-27

**Owner asked for this.** Companion to `e2e-round-2026-08-27.md`. That board answers
"did this hole get fixed." This one answers "did two threads collide, and is anything
we think shipped actually dead."

Written by session `fundhub-platform-60`. Agents coordinate through this file — do not
message each other. Claim a row before working it.

---

## Context brief (read this before claiming anything)

`main` is the only thing Netlify deploys. A commit that lives only on a side branch is
written down and dead in production. That is not theoretical:

* `fundhub.ai/go` (Credit Comeback Club short link) **404ed for three days.** Its redirect
  lived only on `vc/save-2026-08-25` (`df0b1334`, 2026-08-24). Shipped 2026-08-27 as
  PR #236, verified live: `/go` → 302 → `xyl.in/e5hosp5` → intake form 200, affiliate id
  intact.

### Do NOT merge `vc/save-2026-08-25`

It is a stale snapshot, not pending work. Measured 2026-08-27:

| | |
|---|---|
| `main` is AHEAD of it by | ~18,500 lines |
| Files where `main` already has a newer version — **ignore these** | 217 |
| Files the save-branch touched last — need a look | 134 (99 product code) |
| Files missing from `main` entirely — real orphan candidates | 39 (11 product code) |

Comparing commit *ancestry* makes this branch look like 9,100 lines of lost work. It is not.
Compare **file contents and per-file last-touch dates**, as this board does.

---

## FINDING 1 — migration numbers collided (blocking, unclaimed)

Two threads each picked the same "next number." Three times.

| # | on `main` | on `vc/save-2026-08-25` |
|---|---|---|
| 259 | `259_contracts_staff_id.sql` | `259_call_outcome_transcript.sql` |
| 260 | `260_recon_pulse.sql` | `260_affiliate_commission_rates_20260824.sql` |
| 261 | `261_application_decision_play.sql` | `261_affiliate_tier1_20pct_20260824.sql` |

**Not a silent no-op.** `db/migrate.mjs:169` keys `schema_migrations` on the full
`<dir>/<file>`, so both members of a pair are distinct keys and both would apply.

**The real risk is order.** Line 168 sorts by filename, so within a number the tie breaks
alphabetically, not by intent — `260_affiliate…` would run *before* `260_recon_pulse`.
If a save-branch migration depends on a table that `main`'s same-numbered file creates, it
fails on apply. Nobody chose that order; `.sort()` did.

**None of the three has run in production** — they are not on `main`, and only the
production context migrates (CLAUDE.md §11). Confirm with `/api/health` before acting.

**Do not renumber by editing.** Editing an applied migration is a silent no-op
(CLAUDE.md §12). Supersede with a new file at a free number.

- [ ] `unclaimed` — decide per pair: still wanted, or superseded? Renumber survivors above
      `main`'s current max. Owner decision on the two affiliate-commission ones — they set
      partner pay rates.

## FINDING 2 — product code missing from `main` (unclaimed)

Eleven non-test product files exist only on the save-branch. Each needs a live check
before anyone assumes it is a gap — the feature may have been rebuilt elsewhere.

| file | what it is |
|---|---|
| `src/payments/commas-safe-copy.mjs` | Commas checkout wording |
| `src/company-brain/transcribe.mjs` | call transcription |
| `src/company-brain/meet-local-whisper.mjs` | local Meet transcription |
| `api/campaigns/meta-agency.mjs` | Meta agency campaigns |
| `src/adplatforms/meta.mjs` | Meta ad platform |
| + 3 migrations (Finding 1), 3 `src/company-brain/*` | |

- [ ] `unclaimed` — for each: does the live site already do this? If yes, close it. If no,
      cherry-pick onto fresh `origin/main` — **never** copy a whole file across.

## FINDING 3 — the working checkout is behind `main`

`netlify.toml` in the shared checkout is missing `pg` from `external_node_modules` and the
whole `SECRETS_SCAN_OMIT_KEYS` line. Copying that file wholesale 502s every `/api/*` call,
login included, and blocks the build at secrets scanning.

**Cut every branch from `origin/main`, in a fresh worktree.** Do not trust the checkout.

- [x] `done` — PR #236 was built this way; both settings verified intact after merge.

---

## Manifest — session fundhub-platform-60

* `netlify.toml` — added `/go` → `xyl.in/e5hosp5` (302). PR #236, merged, live-verified.
* `docs/workflows/thread-collision-2026-08-27.md` — this file.
* No migration added. No JS/TS touched. No journey affected.
