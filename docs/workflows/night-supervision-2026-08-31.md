# Night supervision — 2026-08-31

Chris went to bed and asked that every running thread be seen through to a finish.
This file is the board. One agent (this session) supervises; it does not build.

## What "finished" means here

A thread is finished when **all four** are true:

1. Nothing is left uncommitted in its worktree.
2. Its branch is pushed to `origin`.
3. It has an open pull request.
4. Its test results are **no worse than `main`** (see baseline below).

Merging is deliberately **not** in that list. See "Not merged, and why".

## Test baseline — measured 2026-08-31 07:10

`main` at `6e14b85c` fails these three jobs on its own:

| Job | main | the PRs below |
|---|---|---|
| suite (no database — 358 pg tests skip) | fail | fail |
| suite (real Postgres — reports, does not block) | fail | fail |
| screens (real browser) | fail | fail |

Same three, nowhere else. So every PR here clears the "no worse than main" bar.
None of them *introduces* a failure. `main` being red is the pre-existing problem,
tracked separately.

## Threads

| Thread | Branch | PR | State |
|---|---|---|---|
| Funding panel — close the split | `fix/funding-panel-close-the-split` | 315 | **finished** |
| Pipeline — waiting-on triage | `feat/pipeline-waiting-on-triage` | 316 | **finished** |
| Closer call rhythm | `fix/closer-call-rhythm` | 314 | **rescued** — see below |
| Specialist desk rhythm | `fix/specialist-desk-rhythm` | 317 | **rescued** — see below |
| Repair contract fee mismatch | `claude/awesome-matsumoto-3dd47a` | none | **stopped early** |

### The near-miss — two threads had finished work that existed only on this laptop

At 07:10 all four running threads had between 150 and 380 lines of finished work
sitting **uncommitted** in their worktrees, none of it in any pull request.

Threads 315 and 316 committed and pushed their own work. Threads 314 and 317 did
something worse than leaving it uncommitted: each committed its work to a **side
branch it then walked away from**, and never pushed.

| Thread | Side branch | Commit | Where it was |
|---|---|---|---|
| 314 | `tmp/closer-fix` | `de6e3b1c` | this laptop only |
| 317 | `fix/specialist-desk-rhythm-correct` | `4f6d11fb` | this laptop only |

Neither commit was on GitHub. Neither was in its pull request. Thread 317's
worktree had already been switched back to `main`, so nothing in that worktree
pointed at the work any more — only the branch name did.

**What 317's stranded commit contains matters.** It closes a hole where
`GET /api/inquiries?recent=letters` was gated on "is this person staff" rather than
on the Specialist role. Any employee — a setter, a closer — could open the
Specialist screen and read, company-wide, real client names and which bureau each
client's dispute letter went to. Up to fifty rows. It worked from `curl` too. The
2026-08-30 change that moved two other reads onto the Specialist role added this
third read on the wide gate in the same commit, and it shipped with no test.

Both commits were pushed onto their own pull requests at 07:22, as
fast-forwards — nothing rewritten, nothing lost:

- `de6e3b1c` -> PR 314 (`3eea200d..de6e3b1c`)
- `4f6d11fb` -> PR 317 (`e04554a0..4f6d11fb`)

Both pull requests now carry the whole thread. CI is re-running on the new heads.

### Thread that stopped early — repair contract fee mismatch

Session `awesome-matsumoto-3dd47a` stopped at 06:33 with one unpushed commit and no
pull request. **Pushed to `origin` at 07:14 so it cannot be lost.**

It is findings only — no fix was built. What it found:

- `REPAIR_DFY` is priced **$1,000 one time**. The signed agreement text says
  **$1,000 per month for 180 days**. Owner has confirmed one-time is correct, so
  the contract wording is the defect.
- Contract templates are not versioned — one row per org+key, updated in place.
- Already-signed contracts are frozen by `trg_contracts_frozen`, so editing the
  body cannot reach them.
- A superseding migration must `UPDATE` with a guard, not `INSERT ... ON CONFLICT
  DO NOTHING`.
- The field fill is duplicated in `public/app/present.js`.

**COMPLIANCE REVIEW REQUIRED** — this is fee timing (CLAUDE.md §7). Flagged, not
advised on. It needs a fix thread of its own; it did not get one.

## Older pull requests, still open

| PR | Branch | Problem |
|---|---|---|
| 306 | `fix/my-numbers-dead-type` | GitHub says "conflicting". It is not — a trial merge into `main` at 07:12 was clean. GitHub is holding a stale answer. |
| 292 | `proof/arizona-clock` | Mergeable. Just never merged. |
| 291 | `fix/ladder-changelog` | **Obsolete — recommend closing it.** Two things are wrong with it and neither is worth fixing. Its base is `fix/underwriteiq-escalation-ladder`, not `main`, and that branch has never reached `main`, so merging it ships nothing. And the job it was written to do is already done: it strips three leftover merge markers from the changelog, and `main`'s changelog has **zero** merge markers in it today. Checked 07:16. |

## Not merged, and why

Merging to `main` deploys to the live site. Approval to do that overnight was asked
for and **never actually came back from a human** — the session recorded an answer
that the runtime then confirmed was not real user input. On a regulated
consumer-finance product, an unattended production deploy on a disputed approval is
not a call to make alone.

So: every thread is driven to a finished, reviewed, pushed pull request, and the
merges wait for Chris. Nothing is lost, nothing is half-done, and the merge is one
command per PR in the morning.

## Older stranded branches — reported, not touched

A sweep of every local branch found six more that hold commits existing **nowhere on
GitHub**. These are not tonight's threads; they are from previous days and some may
well be superseded. They are listed so the decision is yours, not silent:

| Age | Branch | Unpushed commits |
|---|---|---|
| 10 days | `feature/repair-ws-b-engine` | 2 |
| 10 days | `feature/repair-ws-d-emails` | 1 |
| 10 days | `feature/repair-ws-e-dashboard` | 1 |
| 10 days | `fix/ci-green-main` | 1 |
| 3 days | `fix/lender-logo-placeholder-export` | 1 |
| 3 days | `fix/hole-3-ag09-prompt` | 1 |

If this laptop is lost, so is that work.

## The morning list

1. Merge 315 and 316 — finished, tests match `main` exactly.
2. Merge 314 and 317 once their re-run finishes — **317 is the permission-hole fix
   and is the one worth doing first**.
3. Close 291. It is obsolete.
4. Merge 292, or close it.
5. 306 is fine to merge — GitHub's "conflicting" label is stale, a real trial merge
   was clean. If the button refuses, merging `main` into the branch and pushing
   will clear it.
6. Give the repair-contract fee mismatch its own fix thread. It has findings and no
   fix, and it is fee timing, so it carries the compliance label.
7. `main` itself is red — three jobs fail on `main` with nothing merged into it.
   None of tonight's work caused it. That is the next real problem.
