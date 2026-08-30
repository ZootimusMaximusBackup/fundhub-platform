# Bank email classifier — a rejection was being read as an approval

**Date:** 2026-08-29
**Branch:** `fix/bank-email-classifier-negation` off `main` at `4f551ff1`
**Agent:** agent-clf (single workflow — see "Why this was not split")
**Status:** done

---

## What was broken, in plain words

A bank sends us an email about a client. Something in the system reads that email
and decides what it says: approved, denied, counteroffer, and so on.

It got denials wrong.

An email saying **"Unfortunately, you were not approved for the requested credit
limit"** was filed as **APPROVED**.

The reason is small and silly. The reader looked for the word `approved` by
checking whether it appeared *anywhere* in the text. The phrase `not approved`
has the word `approved` inside it. So a denial matched the approval rule, and
the approval rule was checked first, so the approval rule won.

## What a real client experienced

The label is not just written to a log. `src/workflows/f-11-bank-email-event-router.mjs`
reads it, and when it says APPROVED it does three things:

1. **Moves the client's funding card into the `approved` stage** of the
   `funding_card_stacking` pipeline (`moveCardToStage`).
2. **Sets their next action to "Prepare Next Funding Round"** (`mergeCustomFields`).
3. **Files the task "APPROVAL: log amount + update round"** for the funding advisor.

So: a client got turned down by a bank, and our system recorded that they had been
approved. Their card moved forward. Staff were told to prepare the next round of
funding, based on money that was never coming.

And the other half is just as bad — **because the event never said DENIED, the
denial follow-up never ran.** `f-09-funding-declined-no-path.mjs` is the workflow
that picks up a decline and adjusts the plan. It listens for DENIED. It never
heard it. Nobody was told the client had been declined, and nothing was adjusted.

## Every phrasing that was affected

Confirmed by running the old classifier directly. All of these returned APPROVED:

| Email text | Was | Should be |
|---|---|---|
| "Unfortunately, you were not approved for the requested credit limit." | APPROVED | DENIED |
| "Adverse action notice: your request was not approved." | APPROVED | DENIED |
| "After careful review, we have not approved your application." | APPROVED | DENIED |
| "Your application will not be approved." | APPROVED | DENIED |
| "We are sorry, you were not\napproved for this product." (line-wrapped) | APPROVED | DENIED |
| "We approved you for a reduced amount of $2,000." | APPROVED | COUNTEROFFER |
| "You are approved for a lower credit limit than you requested." | APPROVED | COUNTEROFFER |
| "Your annual fee has been refunded." | APPROVED | not an approval |
| "Your application remains unapproved at this time." | APPROVED | not an approval |

The last two are the same fault in a different coat: `refunded` contains `funded`,
and `unapproved` contains `approved`.

## The fix

Three changes, all inside the classifier. **Nothing downstream was touched.**

**1. Match whole words, not letters inside other words.**
Keywords now match on word boundaries. A space inside a keyword matches any run of
whitespace, so a denial whose "not approved" fell across a line break — normal in
forwarded plain-text mail — still matches. This alone kills `refunded`/`funded` and
`unapproved`/`approved`.

**2. Read the negative before running the keyword contest.**
Word boundaries alone do **not** fix "not approved" — `approved` really is a whole
word in there. So negation is checked first. If the bank said it did *not* approve
("not approved", "unable to approve", "cannot approve", "will not be approved",
"could not fund"), the APPROVED rule is dropped outright and DENIED is recorded.

Dropping the whole rule matters. A denial letter is full of approval vocabulary —
it says "credit limit" and "approval" while explaining what it is refusing. Removing
only the one negated word would leave "credit limit" behind, and APPROVED would win
again on that.

The gap allowed between the negative and the approval word is a **closed list of
function words** (`be`, `been`, `yet`, `able to`, …), not a wildcard. A wildcard gap
starts eating ordinary sentences — both of these must stay APPROVED and are pinned
by test:

- "You are approved. This does not affect your approved limit."
- "Do not reply to this email. You have been approved for $10,000."

**3. A shorter phrase inside a longer one from another rule is discarded.**
It is the same words being read twice, and the more specific reading is the right
one. This is what makes "not approved" beat "approved" without reordering anything.

### Rule order was deliberately NOT changed

Putting DENIED first only swaps which case breaks: a genuine approval containing
`unfortunately` or `reduced` would then read as a denial.

The existing order encodes something real — **an email that states a decision IS
that decision, even when it also asks you to do something.** These pass before and
after, and are now pinned so the fix cannot quietly turn the rule list into a
length contest:

- "Congratulations! Approved. Please upload your ID to activate the card." → APPROVED
- "You are approved. Verify your identity to finish setup." → APPROVED
- "Unfortunately your application was declined. You may upload additional documentation to appeal." → DENIED
- "Adverse Action Notice - Action Required: review the enclosed notice." → DENIED

## The judgement call — read this one

**"We approved you for a reduced amount of $2,000." is now COUNTEROFFER, not APPROVED.**

This one is genuinely ambiguous and the reasoning matters more than the answer.

Both labels move the card to the same stage, so the stage is not what is at stake.
**The task is.** APPROVED files *"APPROVAL: log amount + update round"* — which reads
as "this round is done". COUNTEROFFER files *"COUNTER: review + log offer + next
step"* — which puts a person on the shortfall and asks what happens next.

A client who asked for $10,000 and was offered $2,000 needs the second one. Calling
it an approval is how somebody ends up $8,000 short with nobody chasing the
difference. So: COUNTEROFFER.

Guard on the other side: it has to be a reduced **amount**. A reduced *rate* is good
news. "Congratulations, you are approved. Your APR has been reduced." is still
APPROVED, and that is pinned by test.

## The other rule pairs — what was checked, and what was found

Asked for explicitly. Two passes:

**Pass 1 — keyword against keyword, mechanically, across all 6 rules (30 keywords).**
Exactly **one** collision exists in the whole list: `"approved"` (APPROVED) sits
inside `"not approved"` (DENIED), and APPROVED is listed first. That is the bug.
No other keyword is a substring of a keyword in another rule.

**Pass 2 — keywords against real prose, which is where the harder cases live.**
Probed `MISSING_DOCS` (`upload`, `verify your`) and `COUNTEROFFER` (`reduced`)
against genuine approval and denial wording. **All of these were already correct on
`main`,** by rule order, and all still pass — they are the four pinned cases listed
under "Rule order was deliberately NOT changed" above, plus the reduced-APR case.

So: `upload`, `verify your` and `reduced` are weak keywords that would misfire under
any scheme that ranked purely on phrase length. They are safe **because** rule order
puts outcome above process. That is the reason the fix works with the order rather
than against it.

**One real gap found and deliberately NOT filled:** after the word-boundary fix,
"unapproved" and "disapproved" classify as **NOISE** — better than APPROVED, but
they are denials and DENIED has no keyword for them. Adding keywords would change
NOISE into a task being raised, which is a behaviour change beyond this fix's scope.
Recorded here rather than done. (§8 scope discipline.)

## Files touched

| File | Change |
|---|---|
| `src/adapters/mailgun.mjs` | Word-boundary matching, negation and reduced-amount handling, overlap suppression. `classifyBankEmail` and `classifyFull` merged into one implementation. |
| `src/adapters/mailgun.test.mjs` | +24 tests. |
| `docs/journeys/CHANGELOG.md` | One line appended (223 → 224 lines, verified). |
| `docs/workflows/bank-email-classifier-fix-2026-08-29.md` | This file. |

**Exports added:** `_classifyFull` from `src/adapters/mailgun.mjs` — test-only, so the
full classifier can be asserted directly rather than through the webhook.

**Exports removed:** none. **Routes:** none. **Props:** none. **Migrations:** none.
**Env vars:** none. **Dependencies:** none.

**Deliberately not touched:** `src/workflows/f-11-bank-email-event-router.mjs` was
read to trace the impact and left alone, as scoped.

### Duplicate logic removed

`classifyBankEmail` and `classifyFull` each held a byte-for-byte copy of the
classification loop. The substring bug was present in **both**. They are now one
function with two entry points, so this class of fix cannot be applied to one and
missed on the other. (§8 "reuse before you build".)

## Journeys

**No journey diagram changed, and that is deliberate.** The `-actual.md` files in
`docs/journeys/` are route-and-permission maps. This change adds no route, no gate,
no role and no step — it corrects the *value* carried on a step that already exists.
Grepped `docs/journeys/*.md` for `f-11`, `mail.response`, `bank_inbox` and
`classif`: no diagram references the classifier. The changelog line records the
change against `role-funding-advisor`, the role that lives with the consequence.

## Verification

**Lint:** clean — 1594 files parse clean.

**Proof the tests actually catch the bug.** Both classifiers were loaded side by side
and run against the same emails:

```
9 of 12 assertions FAIL on main and PASS on this branch. New-code failures: 0
```

The 3 that pass on both are the approval cases, present to prove the fix does not
over-correct into reading approvals as denials.

**Test counts — read the caveat, the headline number is not the whole suite.**

| | branch | clean main (4f551ff1) |
|---|---|---|
| tests | 7161 | 7137 |
| pass | 7151 | 7127 |
| **fail** | **7** | **7** |
| skipped | 3 | 3 |

**The same 7 failures, by name, on both.** None are new. They are:

- `*** no route's gate is left unverified ***`
- `hasLLC is missing only when no company is on the file; opened is reported only when true`
- `S-23 has Invoice this client and mints a payment link`
- `computeKpis counts funded rounds, not clients.funded`
- `registry: every routed api/ handler and live public/app desk is listed or explicitly unmonitored`
- `repair and funding offers map to contract template keys`
- `start.html lands on apply.fundhub.ai/apply with a1+ref, not the CF root`

**CAVEAT — the database tests never ran, in either measurement.**
`scripts/run-suite.mjs` line 80 is `if (code !== 0) process.exit(code)` after the unit
phase. The unit phase is red on `main`, so the runner exits and the **131
`*.pg.test.mjs` files are never spawned at all** — they do not even appear as skips in
the summary above. Run on their own with `DATABASE_URL` unset: **675 tests, 57 pass,
0 fail, 618 skipped.** The 6 pg files that import the mailgun adapter were also run on
their own: 56 tests, 12 pass, 0 fail, 44 skipped. No import errors.

So the honest count of assertions that **actually executed and passed** on this
branch is **7151 + 57 = 7208**, with 621 not measured for want of a database.

**Environment:** macOS (Darwin 25.6.0), worktree `agent-aff7ff77095f78d1a`,
`DATABASE_URL` unset. **No database was connected. No environment variable was set or
unset. `npm run verify:e2e` was not run. No email was sent or received.**

`npx tsc --noEmit` (§6 item 2) was not run: there is no `tsconfig.json` in this repo,
so it checks nothing. No UI changed, so no Playwright check applies (§6 item 4).

## Compliance

**Not flagged.** §7 lists dispute logic, credit-repair messaging, fee timing, refund
behaviour, payment rails, consent capture, and credit-pull type. This change touches
none of them: it classifies an inbound email and the result drives an internal task
and an internal card stage. Nothing customer-facing is produced, no message is sent,
no fee or credit-pull behaviour moves.

Stated plainly so it can be overruled in one line if wanted: the emails being read
include adverse action notices, and the bug meant a declined client's internal record
said approved.

## Separate finding — not fixed here

`docs/journeys/CHANGELOG.md` line 3 on `main` is a stray **`<<<<<<< HEAD` merge
conflict marker**, with no matching `=======` or `>>>>>>>`. It is committed in
`4f551ff1`, it pre-dates this work, and it is left alone under scope discipline.

## Why this was not split (CLAUDE.md §0)

One file, one function, one bug, and the tests are the deliverable — a second agent
would have to touch the same forty lines. The parent thread had already split the
batch; this is one workflow of it.

**Model:** Opus — debugging classification logic where being wrong moves a real
client's funding card. Current is Opus. Match.
