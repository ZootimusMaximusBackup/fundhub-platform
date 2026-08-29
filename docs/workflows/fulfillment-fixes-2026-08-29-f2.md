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

---

# Round 2 — the owner corrected the requirement

**Agent:** agent-f2b
**Branch:** `fix/funded-amount-input-f2` (extends the work above, does not replace it)
**Status:** `done`
**Date:** 2026-08-29

## What the owner changed

Two corrections, both of which move the design.

**1. The role.** Closers do not touch bank approvals. Closers close clients. The
**funding advisor / fulfillment team** submits the credit card applications and
handles what comes back. Nothing written in this round calls that person a
closer. (Neither `role-funding-advisor-intended.md` nor
`role-closer-intended.md` describes funding steps at all — both are
route-permission maps — so neither one has anything to say about who records an
approval. That is a gap in those documents, not a licence to guess, so the
correction was applied to wording only.)

**2. Approval and amount are TWO SEPARATE MOMENTS.** In the owner's words:

> "We should be able to say yes, it's approved, and then also enter in the
> dollar amount. So yes, technically it's a two-step thing, because sometimes we
> know it's approved, we don't know what the dollar amount is."

When a bank comes back, the team often does not know the limit. They have to
reach out and ask the client, or wait for the client's approval email to arrive
through the mail routing that watches for keywords and surfaces matches in the
per-client inbox on the client control panel. So **"approved, amount unknown" is
a real and valid state**, and Round 1's refusal was wrong.

---

## What changed, in four parts

### 1. The amount is OPTIONAL on "Bank yes"

An empty box no longer refuses. It sends **no `approved_amount` key at all**, so
`applications.approved_amount` keeps its NULL and the approval is recorded as a
dated fact with no money against it.

**Blank is still never zero.** This is now the centre of the design rather than
a side note: the server-side `normalizeApprovedAmount` (Round 1) already turned
blank into `null` and emitted no patch key, so the column is not written at all.
Nothing added here can produce a `0` for an amount nobody typed.

**A wrong amount is still refused.** A box with `abc`, `-500` or `0` in it is a
typo, not an unknown, and saving a typo quietly would be worse than either.

### 2. The Funded guard is UNTOUCHED and still strict

`guardFundedAmount` was not edited, not weakened, and not routed around. A card
still cannot be parked on Funded without a dollar amount, and a round whose only
approval carries no amount still cannot be marked funded — proven by a new
database test that drives the real `moveCardToStage` path, not just the guard.

Two moments, two rules: the approval is allowed to be incomplete, the number a
client is billed from is not.

### 3. The amount can be filled in LATER — in the same box

**Where, and why there.** The lender rows in the client control panel's
*Funding · Apply door* block are the only place in the product where an approval
is already displayed: the block already re-read the client's decisions after
rendering and painted the saved **play name** back into the box it was typed
into. The approved amount now rides the same read and the same idea. Somebody
comes back to the row they pressed "Bank yes" on, types the figure the bank
finally gave them, presses "Bank yes" again, and `logBankDecision` finds the
existing application by client + lender and patches it — **the same row, not a
second approval**.

That read needed one thing it did not have: the applications themselves.
`listClientDecisionPlays` cannot answer it — it reads `application_decisions`,
discards every row with no play name, and the amount does not live on that table
at all. So `GET /api/applications?client_id=` gained an **added** `applications`
key alongside the unchanged `decisions`. No new route.

### 4. A missing amount is VISIBLE, in two places that already exist

**Why this part is load-bearing.** `src/funding/closeout.mjs` filters the
invoice's lender breakdown on `COALESCE(approved_amount, 0) > 0` — **verified,
and it holds**: a NULL approved amount does not crash anything and is never
counted as zero. But it is also **silently left out of the breakdown**, so the
client is never billed a success fee for that bank. Nothing surfaced that, so an
unpriced approval would sit forever and nobody would get billed — the exact
failure this batch exists to fix.

| Where | What shows | Why there |
|---|---|---|
| Client control panel — the lender's own row | Amber **"Amount needed"** chip | The row the approval was logged on. Per lender, exactly where the fix is applied. |
| Client control panel — top of the Funding block | One sentence: *"N bank approvals are still waiting on their dollar amount."* | Counted across the **whole file**, not just the twelve lenders showing — an approval from a bank that has dropped off the match list is precisely the one that rots unseen. |
| Pipeline board — the client's card | Amber **"Amount needed"** chip | The cross-client surface the fulfillment team watches every day. A per-client marker only helps if somebody opens that client; this one does not need anybody to go looking. |

The board flag is a new read-only `approval_amount_missing` boolean on
`/api/dashboard/pipeline`, true only when an application is `Approved` **and**
`approved_amount IS NULL`. A recorded `0` is a fact somebody entered and is not
flagged. The card paints it only on an explicit `true` — a reply that never
carried the key shows nothing, because a card must never claim all-clear on
something nobody measured.

**No new page, screen, tab or menu row.** Every one of these sits inside a card
or a row that already existed.

**Colour note.** The chips use literal amber (`#FEF3C7` / `#92400E` /
`#FCD34D`), not `--warn` / `--alert`. `paintBrand` in `shell.js` overwrites those
variables from the company colour ramp, which turns every warning on a tenant
board the same blue as everything else.

---

## Files touched this round

| File | What changed |
|---|---|
| `src/applications/status.mjs` | **+`listClientApplications()`** — a client's application rows with `lender_id`, `status` and `approved_amount` exactly as the column holds it, null and all. Nothing else in that file was edited; `normalizeApprovedAmount` and `logBankDecision` are Round 1's and already did the right thing with a blank. |
| `api/applications.mjs` | The `client_id` GET returns an **added** `applications` key beside the unchanged `decisions`. No new route. |
| `public/app/client-control-panel.html` | An empty amount box now saves. The saved amount is painted back into the box. "Amount needed" chip per lender row, a waiting count above the list, both refreshed after every save. |
| `api/dashboard/pipeline.mjs` | New read-only `approval_amount_missing` per card, from one `EXISTS` on `applications`, org-scoped to the card's own pipeline. |
| `public/app/pipeline.html` | `.c-needs-amount` chip on a card, painted only on an explicit `true`. |
| `src/applications/approved-amount-optional.pg.test.mjs` | **NEW.** 4 real-Postgres tests. See below. |
| `src/http/pipeline.pg.test.mjs` | +1 test: the card flags a NULL amount, clears when the dollars arrive, and never flags a denial. |
| `src/http/money-input.test.mjs` | +6 tests on the new screen wiring. The Round 1 test "neither screen sends a zero when the box is empty" is **kept unchanged and still passes** — that rule did not move. |
| `e2e/funded-amount.spec.mjs` | The blank-box test was **inverted on purpose** (see below). +8 new browser tests. |
| `docs/journeys/CHANGELOG.md` | One line prepended. 224 → 225 lines, verified after the edit. The stray `<<<<<<< HEAD` on line 5 is pre-existing on `main`, is being fixed separately, and was left alone. |

## The one test whose meaning was reversed, and why

`e2e/funded-amount.spec.mjs` previously asserted **"A BLANK BOX SENDS NOTHING"**.
That test was correct for Round 1's rule and is wrong for the owner's. It now
asserts the blank box **saves the approval and sends no amount** — two separate
claims, both checked, including that the request carries no `approved_amount`
key at all (not `0`, not `""`, not `null`).

No other test was weakened, skipped or deleted.

## Verification

**Lint:** `npm run lint` — clean, 1597 files parse.
**Types:** `npx tsc --noEmit` — exit 0.

**Test suite** — local Postgres 16 (Homebrew, macOS), scratch database `fh_f2b`
created for this run with all 216 migrations applied to it empty. Never CI,
never production. `npm run verify:e2e` was not run.

`scripts/run-suite.mjs` exits before the database phase if any unit test fails,
and unit tests already fail on this branch, so **both phases were run explicitly**
— otherwise ~1,880 database tests are silently skipped and the number proves
nothing.

Each measurement below is the FIRST run against a freshly migrated database, so
the two sides are comparable. Baseline ran on `fh_f2b`, this work on `fh_f2b2`.

| Phase | | tests | pass | fail | cancelled | skipped |
|---|---|---|---|---|---|---|
| unit | branch HEAD (baseline) | 7177 | 7169 | 7 | 0 | 1 |
| unit | **this work** | **7183** | **7175** | **7** | 0 | 1 |
| pg | branch HEAD (baseline) | 1877 | 1847 | 29 | 0 | 1 |
| pg | **this work** | **1882** | **1853** | **28** | 0 | 1 |

**+11 tests, all passing. Zero new failures, in either phase.**

The 7 unit failures are identical by name on both sides. The pg failure names
are identical on both sides **except one**: `once a rule is configured, the
commission is computed from it` failed at baseline and PASSES here. It is a
flake in the commissions suite; nothing in this change touches commissions.

The pg failures are almost entirely the partner-isolation suites, which
false-fail when the suite connects as the database owner because a superuser
bypasses row-level security (CLAUDE.md §12). They are pre-existing.

**A NOTE ON RE-RUNNING THE SUITE AGAINST THE SAME DATABASE.** The first attempt
at the "after" measurement reused `fh_f2b`, the database the baseline had
already run against, and `src/demo/simulate-client.pg.test.mjs` aborted its whole
suite with `duplicate key value violates unique constraint "orgs_slug_key"` on
`t16-teardown-suite` — an org the baseline run had left behind. That cancelled 7
tests and looked exactly like a regression. It was leftover state, confirmed by
querying for the row. **Measure on a database that has never run the suite
before**, or that failure will be blamed on whatever change is in the tree.

**`src/funding/card-stacking-rounds.pg.test.mjs` — the test that proves this
whole chain — still passes**, including
`four-stage walk + funded guard + closeout fee`.

**Playwright:** `e2e/funded-amount.spec.mjs` — **19 passed** (11 kept, 8 new).
Plus `pipeline.spec.mjs`, `pipeline-honest.spec.mjs`, `proxy-apply.spec.mjs`,
`ccp-present-param-aliases.spec.mjs`, `screens-smoke.spec.mjs` — **54 passed**,
no regressions on either screen.

What the browser tests prove by clicking real buttons:

* a blank box **saves the approval** and the request carries no
  `approved_amount` key at all — not `0`, not `""`, not `null`;
* the row then says "Amount needed" and the block says "1 bank approval is
  still waiting on its dollar amount";
* re-opening the screen on a saved amount-less approval shows the same two
  things, with the box **empty** — never a 0;
* a saved approval that already has an amount paints `45000.00` back into the
  box and is not flagged;
* typing the amount in later sends `"45000.00"`, patches the one row rather
  than adding a second, and clears both the chip and the count;
* a typo (`forty thousand`) is still refused with no request sent;
* the count still shows when the lender list is empty — the file with no rows
  to chip is exactly the one where an approval would otherwise rot;
* the board card shows "Amount needed" on an explicit `true`, and shows nothing
  both when the flag is `false` and when the key never arrived.

**New database tests** (`src/applications/approved-amount-optional.pg.test.mjs`),
all 4 passing:

1. a "Bank yes" with no amount saves, and the column is NULL — asked of
   **Postgres** (`approved_amount IS NULL`, `= 0` is UNKNOWN, `::text` is null),
   not of JavaScript, because `Number(null)` is `0` and a coercion check there
   would have proved nothing;
2. that approval still cannot be marked funded — the guard refuses AND the real
   `moveCardToStage` path refuses, and no zero funded amount is written;
3. the amount fills in later onto the same application row, with still exactly
   one application for that lender;
4. once the amount is in, the round funds at 45000 and the closeout bills 4500 —
   and the second bank whose limit is still unknown is **left out of the line
   items**, not billed as zero.

## Journey documentation

`npm run journeys` was run and produced **no diff**. That is the correct and
honest outcome: `role-funding-advisor-actual.md` is generated from route data,
and this change adds no route and no permission gate. The behaviour is recorded
in `docs/journeys/CHANGELOG.md` instead, with that reasoning stated on the line.

**Gap between intended and actual:** none introduced. The standing gap is
unchanged and worth repeating — neither `role-funding-advisor-intended.md` nor
`role-closer-intended.md` describes any step-by-step funding action, so neither
one covers "record the approval" or "record the amount" in either direction, and
neither one says who does it. The owner's correction about closers could not be
checked against them.

## Findings (not fixed — out of scope)

1. **Round 1's finding 3 still stands.** `api/applications.mjs`'s other branch
   (`application_id` + `patch`) forwards an unvalidated `patch` whose allow-list
   includes `approved_amount`, so a bad money value can still reach the column
   there. Neither the "Bank yes" path nor anything added this round uses it.
2. **Round 1's finding 4 still stands.** `src/applications/status.mjs` has no
   `// @ts-check`, and `tsconfig.json` sets `checkJs: false`, so
   `listClientApplications` is parsed but not type-checked.
3. **The batch board named in the original brief still does not exist.** See the
   note at the top of this file.
