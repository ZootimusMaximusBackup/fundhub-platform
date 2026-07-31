# finance-os-banking

Shared board for the finance-os-banking batch. W1–W10 were all executed in one
session on the branch `claude/banking-surface-tiles-6mf6uc`, in dependency order,
because the gate check W10 was told to run found that W5–W8 had never been
started (the original entry below is kept — the finding is the useful part).

**One branch, one pull request.** The brief's example named per-workflow
branches, which is right for ten agents running in parallel and wrong for one
agent running ten workflows in sequence: ten branches off each other's commits
would be a stack nobody can review or revert independently. Each workflow is one
commit, tagged `[W#]`, so a single one can still be reverted on its own.

## Status

| # | What it built | Status |
|---|---|---|
| W1 | `logStaffEvent()` wired into its one real call site | done |
| W2 | 075 subscriptions, 076 client_cards | done |
| W3 | 077 soft_pull_requests + the audit read/write pair | done |
| W4 | 078 alerts, 079 upsell_triggers + the pure evaluators | done |
| W5 | 080–082 plaid_items, bank_accounts, entity_kind + the seam | done |
| W6 | 083–084 card_liabilities + history + parser | done |
| W7 | 085–086 bank_transactions, recurring_bills + detector | done |
| W8 | 087 reminders + cash-flow projector and payment window | done |
| W9 | `finance-os.html` + `/api/read/finance-os` | done |
| W10 | `banking-surface.html` + `/api/read/banking-surface` | done |

## Verification

Against real Postgres 16, migrations applied from scratch and re-applied as a
0-migration no-op.

```
npm test, no DATABASE_URL   2208 tests · 1940 pass · 0 fail · 268 skipped
npm test, with Postgres     2663 tests · 2630 pass · 24 fail · 8 skipped
```

The 24 Postgres failures are 4 pre-existing suite names — `creative generation`,
`creative read endpoints`, `module invariants`, `social, onboarding and metering`
— identical to the baseline measured at commit `cc121cf` on the same database
with staff seeded. **Zero new failing names.** Names were diffed, not totals.

Both screens were driven in Chromium against the dev server with real data:
signed in as seeded staff, neither screen bounces, both paint live rows, and a
control page outside `ALL` still bounces (so the gate is live, not inert).

## W10 — the original gate check (kept)

W10's brief told it to stop unless W5–W8 had merged. They had not, and nothing
they were meant to build existed anywhere. That finding stands and is why the
rest of this batch was built first:

| Expected by the brief | Found at gate time |
|---|---|
| Migrations 080–087 | Absent; migrations stopped at 067 |
| `bank_accounts`, `card_liabilities`, `recurring_bills`, `entity_kind` | No such tables or columns anywhere |
| `cashflow.paymentWindow()` | No such module |
| `public/app/finance-os.html` (W9) | Did not exist |
| `../fundhub-docs/sources/client-control-panel-wireframe.md` | Not a directory; the in-repo `fundhub-docs/sources/` holds one unrelated file |
| `bank-*` branches on the remote | None |

## Assumptions recorded

1. **The seven-row grammar is reconstructed, not quoted.** The approved wireframe
   is not in this repository. The grammar used — identity, blockers, headline,
   detail, timing, actions, system — is derived from the two rules the brief
   quoted verbatim ("blockers only when they exist", "system facts small and
   read-only") plus `client-control-panel.html`, the closest approved screen. It
   is written out at the top of `src/http/finance-os-view.mjs` so it can be
   diffed against the real document when that turns up.

2. **`client_cards` (076) is accounts receivable, not the client's credit.** The
   brief named the table; what it holds was a judgement. It is the card that pays
   Fundhub. This is now the third card-shaped table in the schema and 076's
   header names all three, because confusing them is expensive.

3. **`shiftId` on telemetry is resolved with `currentShift()`** — option 2 of the
   three `TELEMETRY-CALLSITES.md` offered. One extra SELECT on a desk action, and
   a null shift_id cannot be repaired later without guessing.

4. **The earliest safe day is recommended, not the latest.** Both are defensible;
   holding cash longer is the textbook answer but makes one missed reminder a
   late payment. `latest` is still returned for a caller who wants the float.

5. **Detected bills are excluded from payment-window projections.** They are
   guesses, and a guess that closes somebody's payment window is a guess that
   changed their behaviour. Only other cards' reported minimums compete.

## Compliance flags raised

| Workflow | Flag |
|---|---|
| W2 | **Payment rails.** No PAN and no CVV is stored; enforced by CHECK and asserted by test. Review before any writer is built. |
| W3 | **Permissible purpose.** `soft_pull_requests.reason` is free text, deliberately and temporarily — no FCRA purpose vocabulary exists in this repo and inventing one in a migration would be inventing the compliance model unreviewed. Not a compliance artifact until counsel names the purposes. |
| W4 | **Credit-repair messaging.** Alert text states what moved, never what happens next; a test asserts no will/guarantee/improve wording. Upsell rationale is internal and must never reach a consumer. |
| W5 | **SOC 2.** Not in place. No access log for bank data equivalent to `pii_access_log`; retention and deletion undecided; vendor review not done. |
| W8 | **Estimates shown to the user.** Reminders built on inferred bills carry `basis` and `confidence`, enforced against each other by CHECK. |
| W10 | **Bank-data reads are unlogged.** Same SOC 2 gap as W5, restated at the endpoint that actually reads the data. |

## What is NOT built, and is the honest gap

* **Nothing syncs.** `src/banking/plaid.mjs` is a documented, empty seam and
  makes no network call. Every banking table is populated by nobody. `plaid` was
  not added as a dependency — this repo has two, `pg` and `inngest`.
* **Nothing sends.** No reminder is delivered; `reminders.sent_at` is NULL on
  every row this system can produce.
* **No writers for the new tables.** The evaluators (W4) return findings and do
  not persist them; `recordReminders` (W8) is called by nobody; C-00 was not
  rewired to write `soft_pull_requests` because that touches a workflow file
  owned elsewhere.
* **`entity_kind` has no write path.** The banking screen surfaces "classify
  these accounts" as text, not a button. Building the endpoint was not asked for.
* **`pull_run` and `text_sent` telemetry have no actor** and were deliberately
  not wired. See W1's commit message.
