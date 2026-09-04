# What the credit repair letters SHOULD contain — simulated clients

Written 2026-09-03. Read-only study of the code. Nothing was changed and nothing was run against a database.

**The short answer up front: for the simulated clients, the system should produce ZERO letters.** Not one. The Stage button on the specialist desk should come back with the message "The credit file looks clean — nothing to dispute." If it says anything else, something is wrong. The rest of this page explains why, and what would have to change for letters to appear.

---

## Part 1 — What goes in

`scripts/sim/push-credit.mjs` puts a fake credit file on a client that already exists. It never calls a real bureau.

### The repair client (Sim Two-Repair, profile `repair`)

Scores, in FICO 9 points:

| Bureau | Score |
|---|---|
| Experian | 588 |
| Equifax | 602 |
| TransUnion | 595 |

Five accounts. **Important: all five accounts are written onto all three bureaus.** The script builds one report per bureau and copies the whole list into each one. So Experian, Equifax and TransUnion each show the same five accounts.

| Account | Type | Limit | Balance | Rate | Account number | Opened | Condition |
|---|---|---|---|---|---|---|---|
| Capital One Platinum | Credit card | $3,000 | $2,870 | 29.99% | SIM-CAP1-002 | 2021-03-02 | 30 days late, 2 lates, $185 past due |
| Credit One Bank | Credit card | $1,500 | $1,490 | 31.49% | SIM-CRED1-001 | 2022-09-14 | Paid as agreed |
| Midland Credit Management | Collection | $0 | $1,840 | 0% | SIM-MCM-001 | 2024-02-20 | Collection |
| Portfolio Recovery Associates | Collection | $0 | $960 | 0% | SIM-PRA-001 | 2024-07-08 | Collection |
| Synchrony Bank / Care Credit | Credit card | $2,500 | $2,500 | 26.99% | SIM-SYNC-001 | 2020-11-30 | Charge-off, 1x30 1x60 3x90 |

Every account also carries: last reported 2026-08-28, last activity 2026-08-20, owned by the person alone, status "Open", 24 months reviewed.

Two inquiries: Capital One on Experian 2026-02-11, Credit One on Equifax 2026-03-02.

The file's "as of" date is written as **2019-01-15** on all three bureaus. That date matters later.

### The trial client (Sim Three-Trial, profile `trial`)

Scores: Experian 612, Equifax 620, TransUnion 609.

Three accounts, again copied onto all three bureaus:

| Account | Type | Limit | Balance | Account number | Opened | Condition |
|---|---|---|---|---|---|---|
| Capital One Spark | Credit card | $8,000 | $950 | SIM-CAP1-001 | 2021-01-20 | Paid as agreed |
| Midland Credit Management | Collection | $0 | $1,840 | SIM-MCM-001 | 2024-02-20 | Collection |
| Synchrony Bank / Care Credit | Credit card | $2,500 | $2,500 | SIM-SYNC-001 | 2020-11-30 | Charge-off |

One inquiry: Discover on TransUnion, 2026-04-19. Same "as of" date of 2019-01-15.

---

## Part 2 — How a letter gets made

The path is: the desk's **Stage** button → `POST /api/repair/generate` → `src/repair/analyze.mjs` → the Metro 2 rule engine → letters saved to the database. Nothing is mailed. Mailing is a separate human click (Send).

The rules, in order:

1. **Permission first.** No letters at all unless the client has a *signed* credit repair agreement, or a live dispute authorization on file. No paper, no letters, and the answer is "No signed repair agreement or staff authorization on file."
2. **Find the newest credit file** for that client. None on file, answer is "No credit file on record."
3. **Run the rule engine on each bureau's report separately.** The engine has 38 checks. Thirty look at one account, eight look at the whole file (name, address, inquiries).
4. **A "violation" is the unit of work, not an account.** This is the part that is easy to get wrong. The system does not write a letter because there is a collection on the file. It writes a letter because a *specific rule* — like "the balance and the status contradict each other" — caught a specific defect. No rule caught anything, no letter. The code literally refuses to build a letter with zero rule-backed findings.
5. **One letter per bureau, per round.** All of that bureau's findings go into one letter. So the most you can ever get in one round is three bureau letters: Experian, Equifax, TransUnion.
6. **Plus furnisher letters.** On Round 1 only, any finding the engine marked as a collection gets an extra "prove this debt" letter sent to the collection company itself — but only if that company's mailing address is already stored in the system. No stored address, no letter, and a warning is recorded instead.
7. **What goes in the letter body.** For each finding: the rule number, a plain name for it, the Metro 2 field, how serious it is, the account name and last four digits, the reason, what was seen versus what was expected, and the law it rests on. Then a citations block and a closing. The header carries the client's name, mailing address, last four of their social if known, and the bureau's name.

---

## Part 3 — What should come out

I ran the real rule engine over the real simulated data. No database, no writes — just the pure math part of the system, exactly as the live endpoint calls it.

**Result: zero violations, on every bureau, for every profile.**

| Profile | Experian | Equifax | TransUnion | Furnisher letters |
|---|---|---|---|---|
| repair (Sim Two-Repair) | 0 | 0 | 0 | 0 |
| trial (Sim Three-Trial) | 0 | 0 | 0 | 0 |
| funding | 0 | 0 | 0 | 0 |
| blueprint | 0 | 0 | 0 | 0 |
| academy | 0 | 0 | 0 | 0 |

### The checkable table — what to expect on the walkthrough

| # | What you do | What SHOULD happen |
|---|---|---|
| 1 | Open Sim Two-Repair on the specialist desk | The client appears |
| 2 | Click Stage, with NO signed repair agreement | Message: "No signed repair agreement or staff authorization on file." Zero letters. |
| 3 | Click Stage, WITH a signed repair agreement | Message: "The credit file looks clean — nothing to dispute." Zero letters. |
| 4 | Look for letters to Experian / Equifax / TransUnion | None. None saved, none listed, Send stays unavailable. |
| 5 | Look for a validation letter to Midland or Portfolio Recovery | None. |
| 6 | Repeat all of the above for Sim Three-Trial | Identical. Zero letters. |

**If you see any letter at all from the simulated data, that is a bug and it should be reported, not celebrated.** A letter that appeared here would be a claim the engine cannot back with evidence.

### Why zero, in plain words

A credit report is not the same thing as the furnisher's raw data file. The bureau only shows an outside party a summary. Most of the exact code fields the dispute rules test are simply not in it, and this system flatly refuses to guess them. That refusal is deliberate and it is written down in the code with the reasoning: a wrong guess in a mailed letter is the exact thing a furnisher uses to throw the dispute out without investigating.

Concretely, out of the simulated data the engine can see the creditor, the bureau, the account type, the date opened, the balance, the past due amount, the reported date and the ownership code. It cannot see the account status code, the payment rating, the payment history, the date of first missed payment, the bankruptcy indicator, or the original creditor. Fifteen of the thirty-eight checks read the account status code alone, so those fifteen stay silent.

And the fields it *can* see in the simulated file do not contradict each other. So nothing fires.

The two file-level rules that work without those hidden fields are "the same company pulled twice on one day" and "this inquiry is older than two years." The sim's inquiries are all unique and all recent, so neither fires either.

---

## Part 4 — UNVERIFIED

Things I could not trace in code, stated as gaps rather than filled in with guesses.

1. **UNVERIFIED — whether the simulated clients have a signed repair agreement.** The check reads the `contracts` table for a signed contract whose type is credit repair. `push-credit.mjs` does not create one. Whether the ClickFunnels opt-in earlier in the walkthrough creates one, I did not trace. If it does not, Stage stops at step 2 above and never even reaches the engine.
2. **UNVERIFIED — whether Midland Credit Management and Portfolio Recovery Associates have mailing addresses stored.** Furnisher letters need a stored address. I did not query the address table (read-only task, no database access). This is moot while the violation count is zero, but it would matter the moment it is not.
3. **UNVERIFIED — the client's mailing address.** The letter header needs one. The code will still write a letter without it and just flags `identity_complete: false`. Whether the sim clients have an address on file, I did not check.
4. **UNVERIFIED — the exact wording of the standard openings, demands and closings.** Those come from a rotating phrase bank in `src/metro2/letters/prompts.mjs`, chosen by a number derived from the client id. I did not enumerate every possible phrasing.
5. **UNVERIFIED — the DIY letter pack and the Optimize roadmap page.** Both use the exact same engine call, so both should also produce nothing from this data, but I only proved the specialist desk path end to end.

---

## Part 5 — Findings

Five things worth acting on. Ordered by how much they cost.

### Finding 1 — The simulated "damaged" file cannot produce a single letter. The repair walkthrough has nothing to show.

This is the headline. The sim is described as a file "with collections and a charge-off," which reads like it should generate disputes. It generates none, and it never could, because the fields the dispute rules need are not in the data the sim writes. Anyone walking the repair path expecting to see letters will find an empty desk and reasonably conclude the letter system is broken. It is not broken — it is correctly refusing. But the simulation is not fit for demonstrating the deliverable.

To make the walkthrough show real letters, the sim would need to write data that trips at least one rule honestly. The cheapest honest ones, going by the engine's own test fixture, are a stale reported date (an account whose "last reported" is a long way before the file date) and the same company appearing twice on one day in the inquiry list. Neither is in the sim today.

### Finding 2 — The file date is 2019-01-15 while every account reports 2026-08-28. That is impossible.

The simulated report says it was compiled in January 2019, but every account on it was last updated in August 2026 — seven years in the future relative to the file date. The rule that catches stale reporting measures the gap between those two dates, and a negative gap means it never fires. Fixing the file date to today would be one line and would make the sim internally sensible. (It still would not produce letters on its own.)

### Finding 3 — The simulated account numbers have no usable last four digits.

Account numbers in the sim look like `SIM-CAP1-002`. The system pulls the last four *digits* out, and that string has only three digits in it, so the answer comes back empty. Every simulated account therefore has no account number in the system's eyes.

This matters in three places: letters would say "Account: Capital One Platinum" with no "ending 1234"; matching the same account across two bureaus is done on creditor plus last four, so cross-bureau comparison rules can never fire; and matching a bureau's written reply back to the account it is about is also done on last four. Real account numbers in production do not have this problem, but it means the sim cannot exercise any of that machinery.

### Finding 4 — The sim writes each account onto all three bureaus, which is not how a real damaged file looks.

The script assigns a bureau to each account in the top-level summary list, spreading them across Experian, Equifax and TransUnion in turn. But the per-bureau reports — which are what the letter engine actually reads — each get the complete five-account list. So the letter engine sees every account on every bureau. A real file usually has items missing from at least one bureau, and several dispute strategies turn on that difference. The sim cannot produce that situation.

### Finding 5 — There is no code path that turns "this is a collection" or "this is a charge-off" into a dispute, by design.

Worth stating plainly because it is the most likely misunderstanding. The presence of a collection does not itself create a letter. The engine only disputes *reporting defects* — contradictions, impossible dates, missing required fields. A collection that is reported accurately and completely produces nothing, correctly. If the business expectation is "every negative item gets a letter," that expectation and this code disagree, and the disagreement is a product decision, not a bug.

### No compliance flag

Nothing here changes dispute logic, fee timing, or customer-facing claims. This document is a read-only description.

---

## Where the truth lives

- Simulated data: `scripts/sim/push-credit.mjs`
- Endpoint: `api/repair/generate.mjs`
- The orchestration — permission, rounds, one letter per bureau, furnisher letters: `src/repair/analyze.mjs`
- What a credit report can and cannot show, with the reasoning: `src/metro2/normalize.mjs`
- The 38 checks: `src/metro2/checks/`
- The letter body: `src/metro2/letters/generate.mjs`
- The desk's Stage button: `public/app/inquiry-remover.html` line 3794
