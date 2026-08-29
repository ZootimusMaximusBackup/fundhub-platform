# fulfillment-fixes-2026-08-29 — workflow f2 change manifest

**Agent:** agent-f2
**Branch:** `fix/funded-amount-input-f2`
**Status:** `done`
**Date:** 2026-08-29

> **Note on the shared board.** The batch board named in my brief,
> `docs/workflows/fulfillment-fixes-2026-08-29.md`, **does not exist** — not in
> the working tree and not anywhere in git history (`git log --all
> --diff-filter=A` finds no such file). I could not read it before starting or
> claim my task in it, and I did not create it, because inventing another
> workflow's coordination file is worse than reporting its absence. This file
> is my manifest. Nothing here depended on another workflow's output.

---

## The task

Staff could not record how much money a bank approved. There was no input for it
anywhere in the product, so two screens sent a funding status update with no
dollar amount on it.

`src/workflows/cards.mjs` (`guardFundedAmount`) correctly refuses to park a card
on the **Funded** stage with no dollars against it, because
`funding_rounds.funded_amount` is what a client's success fee is billed from.
With no way to supply an amount, **every drag onto Funded was refused**. No round
was ever marked funded, so the round-funded event never fired, so no success-fee
invoice was ever created, so no client was ever billed. The system was honest and
deadlocked.

---

## Which amount each screen captures

This was the one genuinely ambiguous point in the brief. It resolved cleanly from
the code, so I did not stop to ask:

| Screen | Captures | Goes to | Why |
|---|---|---|---|
| Client control panel — **"Bank yes"** | **approved** amount | `applications.approved_amount` | The button stamps an `applications` row to status `Approved`. `approved_amount` is already an allowed patch key on that table, and `sumApprovedApplications` sums exactly that column across Approved applications to *suggest* a funded amount. |
| Pipeline board — **drag onto Funded** | **funded** amount | `funding_rounds.funded_amount` | `guardFundedAmount` wants "what actually funded". The guard's own refusal text says so, and `onRoundFundedMoney` refuses to accept an approved amount as a substitute. |

The two are deliberately different numbers. A bank approving $45,000 and $45,000
actually reaching the account are separate facts, and the money chain already
treats them separately.

---

## Money units — traced, not assumed

**The unit on the wire and in the database is WHOLE DOLLARS, not cents.**

* `funding_rounds.funded_amount`, `funding_rounds.approved_amount` and
  `applications.approved_amount` are all `numeric(14,2)` (`db/schema/001_init.sql`).
* CLAUDE.md §12's "money is integer cents" describes `src/commissions/money.mjs`,
  which converts *into* cents at its own door — `src/commissions/calculate.mjs`
  calls `toCents(round.funded_amount)`, which multiplies by 100. That multiply is
  the proof the column holds dollars. Cents never leave `src/commissions/`.
* `public/app/pipeline.html` already carries a long comment stating this same
  rule for the values it displays. This change follows it.

**How drift is avoided.** `450.10 * 100` is `45009.999999999996` in JavaScript,
which is how a $450.10 approval silently becomes $450.09. The parser never
multiplies: it splits the typed string on the decimal point and reads the two
halves as whole numbers, giving exact integer cents, then renders a fixed 2dp
dollar string. The server repeats the check through `money.mjs`'s `toCents` /
`fromCents`.

**Blank is never zero.** A blank box, a cancelled prompt, a space, `undefined` —
all refuse and send nothing at all. Nothing in this change can write a `0` for an
amount nobody entered. That is the specific failure `docs/CLOSEOUT-FEE-BASIS.md`
records, and a zero here would flow into an invoice looking completely
legitimate.

---

## Files touched

| File | What changed |
|---|---|
| `public/app/money-input.js` | **NEW.** The one shared parsing rule. `window.FHMoneyInput.parseAmount` returns `{ok:true, cents, dollars}` or `{ok:false, reason, message}`. Accepts `45000`, `$45,000`, `45000.00`, `45,000.50`. Refuses blank, zero, negatives, words, more than 2dp, and anything over $1bn. Shared rather than duplicated because a money rule that differs between two screens is exactly the bug that surfaces months later in a payout report. |
| `public/app/client-control-panel.html` | Loads `money-input.js`. Added an **"Approved $"** text box on each lender row, beside the existing play-name box and the Bank yes / Bank no buttons. "Bank yes" now refuses to save with an empty or invalid box and sends `approved_amount` as a 2dp dollar string. "Bank no" ignores the box and sends no amount. |
| `public/app/pipeline.html` | Loads `money-input.js`. A move onto `funding_card_stacking` / `funded` now asks **"How much actually FUNDED?"** before sending, and puts `funded_amount` on the request. Cancel or blank abandons the move and the card goes back. Deliberately **not** prefilled from the card's on-screen figure — that number is the column's *estimate*, and offering it would invite someone to press OK and record an estimate as the amount that funded. No other column asks for money. |
| `src/applications/status.mjs` | New exported `normalizeApprovedAmount()` — server-side validation through `money.mjs`. Absent/blank returns `null` (unknown stays unknown, no patch key emitted, column untouched); anything invalid throws `ApplicationStatusError` with code `invalid_approved_amount` **before any row is created**. `logBankDecision` gained an `approvedAmount` option and forwards it as `patch: { approved_amount }`. |
| `api/applications.mjs` | Reads `body.approved_amount` (or `approvedAmount`) and passes it to `logBankDecision`. |
| `src/http/money-input.test.mjs` | **NEW.** 33 tests on the shared parser plus the wiring on both screens. |
| `src/applications/status.test.mjs` | +5 tests: dollars round-trip, no float drift, a missing amount never touches the column, invalid amounts refuse before any write, a denial carries no amount. |
| `e2e/funded-amount.spec.mjs` | **NEW.** 11 Playwright tests driving both screens in a real browser. |
| `docs/journeys/CHANGELOG.md` | One line prepended (223 → 224 lines, verified against `main`). |

**No new route.** Both endpoints already existed and were already reachable.
`api/pipeline-cards.mjs` already accepted `funded_amount` — only the screen was
never sending it. `netlify/functions/api.mjs` needed no change.

**No new page, screen, tab or menu row.** Both inputs sit inside existing UI.

---

## Journey documentation

`docs/journeys/role-funding-advisor-actual.md` is **generated**
(`npm run journeys`) and its header says "do not edit by hand". I ran the
generator: **it produced no diff.** That is the correct and honest outcome — the
file is a map of which API routes the role can reach, and this change adds no
route and no permission gate. Hand-writing prose into it would be wrong and would
be erased by the next run.

The behaviour change is recorded in `docs/journeys/CHANGELOG.md` instead, with
that reasoning stated.

**Gap between intended and actual:** none introduced.
`role-funding-advisor-intended.md` is itself a route-permission map (and carries
a warning that it was written after the fact from the same extracted route data).
Neither file describes step-by-step funding actions, so neither covers "record
the funded amount" in either direction.

---

## Verification

**Lint:** `npm run lint` — clean, 1596 files parse.

**Types:** `npx tsc --noEmit` — exit 0.

**Test suite** — measured on this machine, local Postgres 16 (Homebrew, macOS),
against a scratch database `fundhub_scratch_f2` created for this run with all
migrations applied. Never CI, never production.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| `main` @ `4f551ff1` (baseline) | 7139 | 7131 | 8 | 0 |
| this branch | 7177 | 7169 | 8 | 0 |

**+38 tests, all passing. Zero new failures.** The 8 failures are byte-identical
in name on both sides and are pre-existing on `main`:

1. `*** no route's gate is left unverified ***`
2. `repair and funding offers map to contract template keys`
3. `computeKpis counts funded rounds, not clients.funded` — the known silent-$0
   KPI bug; another worktree (`fix/dashboard-kpis-money-units`) is on it
4. `S-23 has Invoice this client and mints a payment link`
5. `start.html lands on apply.fundhub.ai/apply with a1+ref, not the CF root`
6. `registry: every routed api/ handler and live public/app desk is listed…` —
   names `campaigns/meta-agency` and `staff/avatar`, not anything of mine
7. `the app's database role holds no superuser-level privilege` — the known
   artifact of connecting as the database owner (CLAUDE.md §12)
8. `hasLLC is missing only when no company is on the file…`

**Skipped: 0.** The pg phase really ran.
`src/funding/card-stacking-rounds.pg.test.mjs` — the test that proves this whole
chain — **ran and passed**: 2 tests, 0 skipped, including
`four-stage walk + funded guard + closeout fee`.

**Playwright:** `e2e/funded-amount.spec.mjs` — **11 passed**. Plus
`pipeline.spec.mjs`, `pipeline-honest.spec.mjs`, `proxy-apply.spec.mjs`,
`ccp-present-param-aliases.spec.mjs`, `screens-smoke.spec.mjs` — **54 passed**,
no regressions on either screen.

What the browser tests actually prove, by clicking real buttons:

* the amount box is on screen on both screens
* a typed `$45,000` arrives at the endpoint as `"45000.00"`
* `450.10` arrives as `"450.10"` — no drift
* **a blank box sends no request at all**, on both screens
* **a cancelled Funded prompt sends no request at all**
* junk, negatives and zero are refused on screen before any request
* "Bank no" still works and carries no amount
* moving to any column other than Funded never asks for money

---

## Findings worth someone's time (not fixed — out of scope)

1. **The batch board file does not exist.** See the note at the top.
2. **`docs/journeys/CHANGELOG.md` has an unresolved merge-conflict marker on
   `main`.** Line 3 of that file at `4f551ff1` is a literal `<<<<<<< HEAD`.
   Someone committed a half-merged changelog. I did **not** introduce it and did
   **not** fix it — it is in a file several workflows append to, and quietly
   rewriting someone's mid-merge state is how work gets lost. My own line was
   prepended cleanly above it (223 → 224 lines, one insertion). Worth a
   deliberate cleanup by whoever owns that merge.
3. **`api/applications.mjs`'s other branch takes an unvalidated `patch`.** When a
   caller sends `application_id`, `body.patch` is forwarded straight into
   `setApplicationStatus`, whose allow-list includes `approved_amount` and
   `requested_amount`. That path does no money validation at all, so a bad value
   can still reach a `numeric(14,2)` column there. Pre-existing; the "Bank yes"
   path I built does not use it. Worth closing separately.
4. **`src/applications/status.mjs` is not `// @ts-check`ed.** `tsc --noEmit`
   passes (exit 0) but `tsconfig.json` has `checkJs: false`, so only files that
   opt in with a `// @ts-check` line are really type-checked. `money.mjs` opts
   in; `status.mjs` does not, so my `normalizeApprovedAmount` is parsed but not
   type-checked. Adding the opt-in is the kind of one-file tightening that
   config's own comment asks for — but it would surface unrelated errors in that
   file, so it does not belong in this change.
