# Pipeline board — make the book triageable (2026-08-30)

**COMPLIANCE REVIEW REQUIRED** — this change reads the funding-tier gate's data and shows funding status on a board every staff role can open. Per CLAUDE.md §7 the label goes on the summary. It is a marker, not a recommendation.

Branch: `feat/pipeline-waiting-on-triage`, off `main` at `6e14b85c`.
Files: `api/dashboard/pipeline.mjs`, `public/app/pipeline.html`, `docs/UI-STANDARDS.md`, `src/http/pipeline-screen.test.mjs`, `src/http/pipeline.pg.test.mjs`, `e2e/pipeline-waiting-on.spec.mjs` (new), `docs/journeys/CHANGELOG.md`.

---

## 1. What a person can do now that they could not before

Open the Pipeline board and, in one look, see **how many of the clients on this rail are waiting on somebody here** — and which one has been waiting longest, by name.

Before, the board could tell you that *this one client* had sent a text nobody answered, or that *this one client* had a bank approval with no dollar amount on it. It never added them up. With forty cards across four columns, the only way to answer "what needs me today" was to read forty cards.

You can also now filter the board by who the next move belongs to: us, a bank, the client, or nobody-has-recorded-it.

## 2. The number was wrong before it was worth showing

The count of "waiting on us" is built partly from an existing flag: *a bank said yes and nobody has recorded how much*. That flag was over-reporting in three separate ways, and each one would have made the new headline claim more work than really exists.

| # | What it did | Why it was wrong |
|---|---|---|
| 1 | Counted approvals somebody had already written off | `applications.approval_excluded_at` records — with a name and a time on it — that an approval does not count, because it was withdrawn or never used. The Client Control Panel has always respected that. This board did not, so the two screens disagreed about the same client and the board kept asking a question that had been answered. |
| 2 | Counted every round the client has ever had | One blank amount left behind in round 1 kept flagging through rounds 2 and 3, forever. It is now scoped to the client's newest round. |
| 3 | Showed a funding fact on every rail | One database query serves all eight boards, so the same client's **Sales** card and **Inquiry Removal** card carried a funding chip nobody looking at those boards can do anything about. It is now computed only on the two funding rails. |

**Proven, not asserted.** The old handler was put back on disk and the new database test failed; the new handler was restored and it passed. That is the whole point of the test.

## 3. What is on screen

A new row between the rail switcher and the filter bar, hard left:

- **WAITING ON US** as a small label, with the count under it at metric size.
- **One line under that**, naming one card: *"Longest wait: Sam Turner — 10d in stage, New Lead."* Clicking it scrolls to that card and rings it.
- To the right, three counters carrying **words** — "on a bank", "on the client", "nothing recorded". Clicking any of them filters the board. The card count and the money move up beside them.

### "Us", not "me"

Nothing in this system assigns a card to a person. `cards.owner` is never written by production code — only demo seeds set it — so every real card's footer reads "unassigned". A per-person number would have been invented. The screen says "us".

### A card can only ever be in one bucket

A card can be sitting in Round Submitted **and** have a text nobody answered. "Us" wins first, because a reply we owe is something a person here can do right now. So us + bank + client + nothing recorded always equals the card count. If they double-counted, the top row of the screen would contradict itself.

### The rule is deliberately narrow

- **Us** — an unanswered inbound message, or an approval with no dollar amount. Both are real records, not guesses.
- **A bank** — the card is in *Round Submitted*.
- **The client** — the card is in *Action Required*.
- **Everything else** — "nothing recorded". Said in exactly those words on screen, never as "nothing to do". Guessing a party from a stage name nobody agreed on is the kind of number that looks real and is not.

### A dash is not a zero

Before a rail answers, and after a rail fails to answer, every figure is a dash and the line underneath says the number is unknown. A 0 there would tell a funding advisor that nothing needs them, which is the one thing an unanswered read can never prove.

## 4. Also fixed

- **"Waiting on" is a fifth filter**, including *"Us — an approval amount"*, so the flag that has been on every card since 2026-08-29 is finally something you can filter by.
- **Sort gains "Amount needed first"**, longest wait first within it.
- **The age filter now reads the clock.** It used to re-read the words already printed on the card ("4h in stage"), which `age()` had already rounded to the nearest hour or day. So "over 3 days" was decided by a number that had been rounded before anything compared it. It now reads the raw timestamp.
- **`docs/UI-STANDARDS.md` §12.6 corrected.** Both examples it gave of "status is never colour alone" — `.card.held` and `.hold-badge` — are real CSS that has never once painted, because nothing ever adds either class. The section now cites the live counters and says outright that an example which has never run cannot show that it works.

## 5. What I refused, and why

| Asked / suggested | Not done | Reason |
|---|---|---|
| Wire or remove the dead "Held only" filter | Left exactly as it was | It matches nothing today and the `— held` figure is a permanent dash. Wiring it means reading `round_hold_reason`, which is funding-tier data behind the Gate B compliance check, onto a board every role can open. Removing it is the owner's call. Either way it is a decision, and doing it silently is worse than leaving it. The guard that pins the dash is untouched and still green. |
| Source `total_approved` honestly and fill that tile | Left as an honest blank | A SUM over a table with no rows returns 0, and a 0 there reads as "no bank has ever approved anything". I cannot check from here whether production holds any approval rows. An honest blank beats a confident zero. |
| A "gone quiet" counter | Not built | The board endpoint returns two booleans and no last-message timestamp. "Quiet for 9 days" cannot be said from what the card carries, so it was not said. |
| Reuse `gatherListSignals` on the board for open tasks | Not done | It would have inherited the compliance gate, which is genuinely attractive — but it is a second read of a different shape on a 500-card board, and the buckets turned out to need no new data at all. The stage key was already in the response. A smaller correct change beat a larger one. |

**One thing to flag rather than assert:** the board still does one raw `applications` read that is not behind the funding-tier gate — the "Amount needed" chip, which shipped on 2026-08-29. I narrowed it to the funding rails and the current round rather than adding a second one. Whether that read should sit behind the gate is Chris's call.

## 5a. Correction after adversarial review (2026-08-31) — the ring did not ring

A reviewer measured this branch instead of reading it, and found that the one new thing §3 promises — *"clicking it scrolls to that card and rings it"* — **scrolled but did not ring.** The finding was right. It is fixed on this same branch.

**What was broken, in plain language.** You click "Longest wait: Sam Turner". The board scrolls to Sam's card. Nothing marks it. On a rail with forty cards, Sam's card is one of a dozen on screen and there is no way to tell which one you were sent to.

It was worse than nothing happening. Every card on this board carries a soft shadow that makes it sit up off the page. The broken rule **switched that shadow off** on the one card it was supposed to highlight. So for the two seconds after the jump, the card you had just been sent to was the only flat one on the board — the one card that looked *less* real than the rest. The feedback was backwards, not missing.

**Why.** The rule asked for a ring painted in `--spectrum`. `--spectrum` is not a colour, it is the six-colour gradient the brand uses for stripes and bars. A shadow can only be painted in a single flat colour, so the browser threw the whole line away and used its default, which is "no shadow at all". The same `--spectrum` eleven lines further down is fine, because that one paints a *background*, and a background can be a gradient. The token looks proven sitting right next to the rule it breaks.

**The fix is one line.** Keep the card's normal shadow, and add a 3px ink ring on top of it:

`box-shadow:var(--panel-shadow),0 0 0 3px var(--ink)`

Ink rather than the reviewer's suggested `--accent`: `--accent` is the sixth stop of the tenant's colour ramp, and a white-label company with one pale hue can leave it near-invisible against the board behind it — the exact §12.6 failure this branch spent a section on. Ink is the same validated colour the chosen headline counter already fills with, so the card you were sent to and the counter you pressed read as one act.

`.card.fh-spot:hover` is named in the selector too. `.card:hover` is written later in the file at the same strength and wins the tie, so without it the ring vanished the moment the pointer crossed the card. Measured, not guessed: stripping `:hover` out of the selector in the live page dropped the ring to the ordinary hover shadow immediately.

**Why nothing caught it, and what catches it now.** The only check was `toHaveClass(/fh-spot/)` — it proved a label was stuck on the card and said nothing about whether anything appeared. It passed green for the whole life of the dead rule. Both replacements were run against the old CSS first and **both fail on it** while the old class check still passes:

- `e2e/pipeline-waiting-on.spec.mjs` — reads what the browser actually painted and compares it to an untouched card in the same column, because "looks exactly like its neighbours" is the failure being tested for. It also hovers the card, so the tie above cannot come back.
- `src/http/pipeline-screen.test.mjs` — refuses any shadow, outline, border-colour or text-shadow on this screen that names `--spectrum`. This one runs on every `npm test`; Playwright is a separate command.

**The uncomfortable part, recorded rather than smoothed over.** §4 of this document says this branch corrected UI-STANDARDS §12.6 because both of its examples were CSS that had never painted. This branch then shipped a third dead rule, eleven lines from one of them, in the same commit. §12.6 now carries that too, with the lesson that the previous correction missed: *the class being applied is still not proof that anything paints.*

## 6. How it was checked

**Re-measured in full after the §5a correction (2026-08-31), on a fresh worktree at branch tip, not carried over from the run above.**

- **Lint** — clean, 1611 files.
- **`npx tsc --noEmit`** — exit 0. Worth knowing: `tsconfig.json` exists now (added 2026-08-27) and has `checkJs:false`, so this gate parses and resolves every `.mjs` but only *type-checks* files carrying `// @ts-check`. It is a real gate, not the vacuous one it used to be, but it is a narrow one.
- **Unit phase** — **7329 tests, 7316 pass, 10 fail, 3 skipped.** Before the correction this branch measured 7326 / 7313 / 10 / 3, and `main` measured 7315 / 7302 / 10 / 3. **The same ten failures by name at every one of the three points.** The correction adds 3 unit tests; the branch adds 14 over `main`.
- **The pipeline `font-size:10px` offender is not this branch's.** `src/ui/screen-standard.test.mjs` names `pipeline.html: font-size:10px` (`.c-msg-badge`). It is on `main` verbatim and predates all of this work. Left alone on purpose — dead type is `fix/my-numbers-dead-type`'s job, not this branch's (§8 scope discipline).
- **Database phase** — `npm test` never reaches it: the runner exits after the unit phase when it is red, and it is red on `main`, so **every pg file skips silently while the summary still reads green.** Run by hand, flag *before* the file list at `--test-concurrency=1` exactly as `scripts/run-suite.mjs` does, against a scratch Postgres 16.14 (Homebrew, macOS) created for this work with all **219** migrations applied to it empty, and **dropped afterwards**: **1956 tests, 1927 pass, 28 fail, 1 skipped** — identical to the pre-correction run, which is what a CSS-and-tests change should produce. All 28 are partner-isolation / row-level-security tests, the class CLAUDE.md §12 says fails when the connection role owns the database. Every one of the 13 pipeline endpoint tests passed.
- **Playwright, my screen** — `pipeline-waiting-on` + `pipeline-honest`: **18 pass, 0 fail**, including the new computed-style ring test.
- **Playwright, everything that touches this screen** — `pipeline`, `pipeline-honest`, `pipeline-waiting-on`, `screens-smoke`, `verification-security`, `funded-amount`, `sales-dashboards`, `sidebar-roles`, `conveyor-ui-times`, `demo-mode`: **119 pass, 0 fail.** That includes "pipeline at 1280px has no console errors" and the same at 390px.
- **The two new gates were proven to bite.** The old CSS was put back on disk and both failed; the fix was restored and both passed. The pre-existing `toHaveClass` check passed against the broken rule in the same run, which is exactly why it was not enough.
- Never CI. Never production. `verify:e2e` never run. No environment variable set or unset. Scratch database dropped.

### The original run, kept for comparison

- **Unit phase** — 7326 tests, 7313 pass, 10 fail, 3 skipped. With this diff stashed in the same worktree: 7315 / 7302 / 10 fail / 3 skipped. **The same ten failures by name.** 26 tests added.
- **Database phase** — run by hand, one file at a time exactly as the runner would, against a scratch Postgres 16.14 created for this work with all 219 migrations applied to it empty, dropped afterwards: **1956 tests, 28 fail, 1 skipped**, against **1955 / 28 fail / 1 skipped** with the diff stashed. The identical 28, every one a partner-isolation test.
- **Playwright, the three pipeline specs** — 13 new browser tests in `e2e/pipeline-waiting-on.spec.mjs`, covering a 40-card board, a failed read, an empty rail, the click-to-jump, the filter, and 390px. Run with `screens-smoke` and `funded-amount`: **73 pass, 0 fail.**
- **Playwright, the whole suite** — 339 tests, **284 pass, 29 fail**. Not one of the 29 is a pipeline spec. `pipeline-waiting-on`, `pipeline-honest`, `funded-amount`'s board tests, `screens-smoke`'s pipeline load, and `verification-security`'s "pipeline at 1280px / 390px has no console errors" all ran and all passed. Of the 29, nine are `live-*` specs that need a live backend and cannot pass under the no-backend config at all. The other twenty live in seven files (`agent-editor`, `calendar`, `controls-persist`, `crm-flows`, `integration-round`, `lenders-inquiry-ops`, `messaging-inbox`), and those seven files were run twice — once as committed, once with `main`'s `pipeline.html` and `pipeline.mjs` checked out over the top: **20 fail / 79 pass both times, the identical failure list, character for character.** They are pre-existing.

  > Worth knowing for the next person: two Playwright runs at once on this repo poison each other. They share the fixed port in `playwright.config.mjs` and the `test-results` directory, and the collision shows up as `page.goto` timeouts in whichever specs happen to be running — failures that look like real screen bugs and are not. Run one at a time.
- **`src/ui/screen-standard.test.mjs`** names the same three offenders before and after. None of them is `pipeline.html`.
- Never CI. Never production. `verify:e2e` never run. No environment variable set or unset.

## 7. Screenshots

Marked up per CLAUDE.md §8 — red boxes, numbered, one caption per mark in a legend on the image. Forty cards, not three.

`docs/workflows/pipeline-triage-2026-08-30-evidence/`

- `01-before-1440.png` — the board as `main` has it
- `02-after-1440.png` — the same forty cards, with the headline
- `03-after-phone-390.png` — 390px
- `spot-before.png` — **the §5a correction.** The jump has fired. Mark 1 is the card it sent you to and it has *no* shadow; mark 2 is an ordinary card beside it that still has one, so the jumped-to card is visibly the flattest thing in the column. The legend carries the computed value: `none`.
- `spot-after.png` — the same click, same cards. Mark 1 now carries a black ink ring **and** keeps its shadow; mark 2 is unchanged, which is what makes the difference readable. The legend carries the computed value in full.

That folder is gitignored (`.gitignore:29`), so the images sit on disk beside this file rather than in the commit. `_shoot.mjs` in the same folder regenerates all three: it swaps `pipeline.html` for the committed version, shoots, and puts it straight back.

> A copy served from a different filename does not work and fails *silently*: `shell.js` checks the screen name against the signed-in role's list and redirects anything it does not recognise, so the first "before" shot came back showing the **after** page with a two-second-later clock on it. A wrong screenshot that looks right is worse than no screenshot.
