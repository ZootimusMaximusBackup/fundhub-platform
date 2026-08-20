# Fulfillment Layer Phase 1 — result

**COMPLIANCE REVIEW REQUIRED.** This changes what staff are told to do about pulling
credit, and what a repair-only client is shown. Section 5.

**Branch:** `feat/fulfillment-layer-phase1` · **Commit:** 5767b471
**Not pushed, not merged, not deployed.** Chris merges.

---

## 1. What changed — one line

Every client now shows one worked-out next action, their blockers, and their funding round,
on the two screens you already have.

## 2. Where it shows

**Client Control Panel** — a block with NEXT ACTION in big, ACTIVE BLOCKERS, and FUNDING
ROUND with its Finalized state. Every existing button stayed exactly where it was.

**Pipeline** — a Fulfillment toggle. Off by default; the board is untouched until you click
it. On, you get the client list with a next-action chip per row and the six tiles. Clicking a
chip filters the list, like your Airtable v1.

## 3. The nine chips, in your order

Clear Fraud Alert → Get Consent → Pull CRS → Remove Inquiries → Collect Documents →
Review Disputes → Review Funding File → Prepare Next Round → Apply for Funding

Plus **Ready to Fund** ranked last, derived as you specified: no blockers, round not held,
documents complete. **Lock Fee** is not a queue chip. **File Prep** is dropped.

## 4. Where the numbers come from, honestly

| Tile | What it shows |
|---|---|
| Total clients | A real count |
| Needs Pull | Paid, nothing pulled, permission on file, no fraud alert — the exact same rule as the chip |
| Action Needed | Clients with at least one open task |
| **Ready** | **A dash.** No definition exists. Zero would be a lie |
| Total Prequal | Real, with the contributing client count beside it, because today it is one client |
| **Total Approved** | **A dash.** No funding round has ever been recorded. Zero would claim nobody was approved |

A sentence under Needs Pull says how many more are waiting on permission first. The list is
capped at 200 and says so when it is showing fewer than the total.

## 5. Your two rules

**No recorded consent never shows "Pull CRS."** Built twice — as ordering, and as a hard
guard that cannot be reached around. Proven on your live data: **40 of 47 records come back
"Get Consent."** Your TEST client correctly says "Pull CRS" because its permission is on file,
recorded 18 August.

**Repair-only clients never see a funding chip.** Whitelist, not blacklist, so a tier value
nobody has invented yet is refused rather than allowed. Tested against 28 junk tier values —
null, wrong case, numbers, arrays, objects that stringify to a funding tier. All refused.

Every half of both gates has a test that goes red when the half is deleted. That was checked
by deleting each one and watching it fail.

**Your ruling is implemented as you gave it:** the big slot shows only a worked-out answer or
plainly says none applies; the stored text sits underneath labelled as what is on the record,
never as an instruction. A repair-only client showing no funding step is recorded here as
correct behaviour, not a gap, so nobody reopens it later as a regression.

## 6. What you should check

1. Open a client on the Client Control Panel. Does the big NEXT ACTION line match what you
   would tell a person to do next? That judgement is the one thing no test can make.
2. On the pipeline, click Fulfillment. Click a chip. Does the filtered list look right?
3. Look at a repair-only client. Confirm no funding step and no funding money is shown.

## 7. Risk

**The tile and the chip can still drift apart in one case.** Needs Pull now matches the chip
rule exactly for the chips that outrank it. If the order is ever changed, the tile's SQL has
to change with it. There is a comment saying so at the query.

**The desktop pipeline toolbar moved.** Adding the Board/Fulfillment switch pushed the search
box 174px right and the board down 2px at 1440. Nothing was removed and the money summary did
not move, but it is not byte-identical and it would be wrong to claim it is.

Everything else: 36 screens walked, 30 pixel-identical. The two that changed are the two that
were meant to. One more is the app's front door, which forwards to the pipeline, so it is the
same change seen twice. Three are animation noise.

## 8. Left undone — deliberately

**Six things the adversary found that are NOT fixed.** Named so you can schedule them:

1. **The AI context panel still prints the stored words.** A different endpoint reads the old
   stored field and paints it under "Agent context" on the same screen. It is blank on every
   real client today because nothing writes that column — this is boarded bug 8 from Phase 0.
2. **`isFundingPath` can be fooled if called directly** with an object that stringifies to a
   funding tier. Not reachable through any screen — the derivation converts to a string first
   and refuses non-strings — but the helper itself is loose.
3. **Total Prequal includes repair-only clients.** You never said which population the counts
   should cover, so I left it and am telling you.
4. **A recorded $0 shows as a dash** on the pre-existing tiles, because that is what `main`
   does. Arguably wrong — hiding a real zero calls a known fact unknown — but changing it
   touches tiles this task was not asked to change. Your call.
5. **The lens does not retry a failed load.** Switching away and back will not re-ask; a page
   reload does. It does say what went wrong.
6. **One guard has no test that fails when it is removed** — the belt that ships the safe
   label when the consent read throws before the verdict is known. It is correct today, and
   the behaviour it protects is covered from the other direction.

**The twelve live bugs from Phase 0 are untouched,** as you instructed. They go on their own
board after this merges.

**No database proof of the row-level-security isolation work.** The Postgres tests ran as a
superuser, which bypasses it. That measurement is outstanding across the whole repo and this
branch did not change it either way.

## 9. Gates

Compared failure by failure against `main` at 33004eb8, never by count.

| Gate | Result |
|---|---|
| Lint | Clean, 1361 files |
| Unit tests | 6253 pass, 3 fail, 3 skipped — the same 3 that fail on `main` |
| Database tests | Zero branch-only failures |
| Playwright | 193 pass, 21 fail, 18 not run — identical to `main`, test for test |
| Journeys | Up to date, 9 files |
| Types | No tsconfig.json exists in this repo, so there is nothing for it to check |

**No test was weakened, skipped or deleted.** One test's premise was deliberately replaced and
is marked as such in the file: it asserted that a hand-typed task title is never rewritten,
which an adversary proved leaks. It is now three tests covering both sides of the line.

Nothing new fails. Nothing writes. No outbound calls added. No new route. The client list is
byte-identical when the lens is not asked for — proven by running both versions side by side.

## 10. Next

Merge the pull request, or tell me which of the six in section 8 to close first.
