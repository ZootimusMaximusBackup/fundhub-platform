# Push-live audit — 2026-08-27

One shared board for four audits run to figure out what is committed, merged, and deployed vs. what is still sitting unshipped, before anything gets pushed live.

## A — Local working tree

The tree is dirty but almost everything looks like real, finished work — not leftover noise. There is one real risk worth flagging: 12 important "owner decision" note files got deleted from disk (unstaged) with no clear replacement found anywhere else in the repo.

## 1. What's dirty right now

- **13 files are staged** (ready to commit if someone runs `git commit`): a new workflow doc, the client control panel page, 3 new icon files, and 9 backend/test files for a new "business incorporation date" feature.
- **About 115 files are modified but not staged**: `.cursor` rule files, 12 deleted memory notes, several backend files, and about 80 `public/app/*.html` pages that each got a small favicon tag added.
- **About 40 files are new and untracked** (git doesn't know about them at all yet) — mostly `docs/workflows/*.md` planning boards and a handful of one-off scripts under `scripts/tmp*`.

One thing changed since the snapshot you gave me: `docs/workflows/thread-collision-2026-08-27.md`, which your snapshot called "untracked," is now **staged**. Someone else's session in this shared folder must have run `git add` on it between then and now. I read it — it's a real, well-written status board, not junk (see point 4 below).

## 2. Is this real work, or leftover noise from another session?

**Real work, as far as I can check.** I opened the biggest and riskiest-looking diffs by hand, not just the file list:

- **The journey doc changes** (`docs/journeys/*-actual.md`, auto-generated flowcharts) are not an accidental revert. The route counts genuinely went up (for example, clients went from "165 of 195 routes blocked" to "166 of 196 blocked") because a real new route and a real new access rule were added in the code. The changelog file has detailed, dated entries (2026-08-25) that match what I found in the code. This is the system working as designed — CLAUDE.md requires these docs to be regenerated whenever the code changes.
- **The favicon rollout** (3 new small icon files, plus a 3-line tag added near the top of about 80 pages) is simple and consistent across every page. Nothing looks broken or half-done.
- **The "when was this business incorporated" feature** is a complete, connected chain: the sign-up form asks the question → the API validates and saves it → the database stores it → the underwriting math uses it → the client screen displays and lets staff edit it. All pieces match each other. Test files for this only had lines *added*, none removed or weakened.
- **The `.cursor/rules/*` changes** are dated, explained rule updates (e.g., "owner override 2026-08-25: don't ask Chris to QA, only do it if he offers"). They read like intentional policy edits, not corruption.
- **The AI model change** (`src/agents/model.mjs`) switches the system to try OpenAI first and fall back to Anthropic, with a clear comment explaining why ("owner-set 2026-08-25: use OPENAI_API_KEY for now"). A matching new test file exists for it.
- I searched the whole diff for leftover conflict markers (the `<<<<<<<` kind you get from a bad merge) — found **none**, staged or unstaged.

Nothing I looked at reads like it was silently reverted or half-applied by a different, unrelated session.

## 3. The MM file: `public/app/client-control-panel.html`

This file has two separate layers of change stacked on top of each other:

- **Staged** (the bigger chunk, ~170 lines): adds the "when was this business incorporated" question and a save button to the client screen, adds two small buttons to log "bank said yes / bank said no" against a lender application, and fixes a couple of small display bugs (a status label, a "waiting on credit pull" message that should clear once scores are actually on file).
- **Unstaged** (on top of the staged version, 3 lines): just the same favicon tag every other page got.

So: the staged part is a real feature. The unstaged part is the same small icon change as everywhere else. Nothing conflicting between the two layers — they touch different parts of the file.

## 4. The deleted memory files — this is the one thing to slow down on

Twelve files under `.serena/memories/` are gone from disk (deleted, but not yet staged for commit). These are not throwaway notes — they're recorded owner decisions and operating rules, including:

- Rules for the collections/AR calling agent (money and compliance-flagged)
- The rule that the "inquiry phone remover" feature is on hold
- What "harden it" means when Chris says it
- The rule that testing means a human-style click-through, not just a script
- Rules for a "Josh setter" AI script, a context-fetcher policy, a doc-chase policy, and a few short one-line owner notes

I checked whether this content moved somewhere else first (like into `.cursor/rules/` or `CLAUDE.md`) before being deleted — that's a normal, safe reason for a deletion like this. I could only confirm that for **one** of the twelve (the "test means human click" content is echoed, in updated form, inside `.cursor/rules/test-means-human-click.mdc`, which itself has real, dated edits). For the other eleven, including the collections/AR compliance rules and the inquiry-phone-remover hold, I could not find the content preserved anywhere else in the repository.

I could not find any note, commit message, or document explaining *why* these were deleted. It's possible this was an intentional cleanup by another session that just hasn't finished (the matching new/updated files haven't been written yet), or it could be an accidental delete. As of right now, on disk, that information only exists in git history — if this delete were committed and then the history were rewritten later, it would be gone for good.

## 5. Untracked files (not staged, not part of your original snapshot's \"modified\" list, but worth knowing about)

About 40 new files sitting in the folder that git doesn't track at all — almost all are dated `docs/workflows/*.md` planning/status boards from recent sessions (this is the normal way this repo's multi-agent system coordinates, per CLAUDE.md), plus a few one-off scripts under `scripts/tmp*` and `scripts/tmp-hole*`. None of these will be committed unless someone explicitly runs `git add` on them, so they're not a "commit accidentally" risk right now — just clutter to be aware of.

**Risks:**
- The 12 deleted owner-decision memory files (collections/AR rules, inquiry-phone-remover hold, harden/test-means definitions, and others) have no confirmed replacement — losing them for good is the real risk here, not committing bad code.
- Everything else checked (favicon rollout, incorporation-date feature, journey doc regeneration, .cursor rule edits, AI model provider switch) looks complete and internally consistent — low risk to commit as-is.
- This is a shared checkout other sessions may be using right now — the state I captured is a snapshot and could already be stale by the time you read this.

**Recommendation:**
Safe to commit now, if you want to: the favicon rollout, the incorporation-date feature (already partly staged), the journey doc regeneration, the .cursor rule updates, and the AI model provider switch. None of it looked half-finished or conflicting.

Leave alone / do not commit yet: the deletion of the 12 `.serena/memories` files. Before that deletion gets committed, someone should confirm on purpose that those owner decisions were moved somewhere else (or are genuinely no longer needed) — right now I can't prove that for 11 of the 12. Since this is read-only audit, I did not touch, restore, or stage anything.

## B — Branch and commit audit

Local main is 102 commits behind GitHub's main (not ahead, not diverged — just stale). Of ~60 branches, almost all are already merged. Only two branches hold clean, real, unmerged work: fix/hole-12-invoice (one day old) and docs/thread-collision-2026-08-27 (a notes file). The old vc/save-2026-08-25 branch — the one a prior audit flagged as "~9,000 lines stranded" — is mostly already shipped; only about 4 files and some migration numbers are still real gaps, and that was already written down in this repo's own notes. Six other side branches that looked like live work (commission payouts, 4 repair-engine branches, an UnderwriteIQ fix, a homepage survey fix, a Twilio call fix) turned out to be old snapshots whose content is already on main — safe to ignore or delete.

## 1. Is local main ahead of or behind GitHub?

Behind, not ahead. `git fetch origin` pulled new history but changed nothing on disk.

- `origin/main` has **102 commits** that local `main` does not have.
- Local `main` has **0 commits** that `origin/main` does not have.

Nothing was lost. Local `main` is just an old copy — nobody has been building on top of it, so there is no conflict to untangle. (Also: the current checkout is on `gitbutler/workspace`, not `main` — that's the branch with the uncommitted files you're seeing in `git status`.)

## 2. All the branches

There are about 30 local branches and 30 matching remote ones (plus a few that only exist on one side). I checked every single one against `origin/main` the strict way — "is every commit on this branch already inside main's history" — not just by name.

**Result: the huge majority are already merged.** Anything named `fix/hole-*`, `chore/*`, `polish/*`, `tmp/*`, `ui/*`, and most of the recent `fix/*` branches from the last few days are fully absorbed into main already. Those are safe to delete — deleting a merged branch loses nothing, GitHub already has the work under `main`.

Only **10 branches** are NOT fully merged. I checked what's actually inside each one, not just the branch name, because branch names in this repo (like "fix/present-matches-underwriteiq") sound like live work even when they're actually old snapshots that already shipped a different way.

## 3. The vc/save-2026-08-25 branch — the "~9k stranded lines" branch

There's only **one** `vc/save-*` branch (not several) — `vc/save-2026-08-25`. It has 12 commits not on main, and a raw line-count diff makes it look like ~9,300 lines of lost work.

**That number is misleading**, and this repo already has a note explaining why (`docs/workflows/thread-collision-2026-08-27.md`, written 2026-08-27, same day as this audit). Short version: main kept moving after this branch was created, so most of those "missing" lines are really just main's newer version of the same files. The real picture from that note:

| | |
|---|---|
| Files where main's copy is already newer — ignore | 217 |
| Files genuinely missing from main, worth a look | 39 (11 are actual product code, not tests/docs) |

I re-checked 5 of those flagged files today:

- `src/payments/commas-safe-copy.mjs` — **still missing from main**
- `src/company-brain/transcribe.mjs` — **still missing from main**
- `src/company-brain/meet-local-whisper.mjs` — **still missing from main**
- `api/campaigns/meta-agency.mjs` — **still missing from main**
- `src/adplatforms/meta.mjs` — **this one has since landed on main.** One less gap than the note claimed.

There's also a real landmine in this branch: it has 3 database migration files numbered 259, 260, and 261 — but main *already used those same three numbers* for different, already-shipped changes. If anyone ever applies this branch's migrations as-is, they'd silently run both versions in a random order. Two of the three set affiliate commission pay rates, so that one needs your sign-off before anyone touches it, not a coder's judgment call.

**Bottom line on vc/save-2026-08-25: do not merge the branch. A few individual files inside it are worth pulling out one at a time**, which is exactly what the existing note already recommends.

## 4. Other branches — checked file-by-file, not just by name

I found 8 more branches that were not yet merged. I opened each one and compared its actual file changes to what's on main today (not just the branch name or commit message).

**Real, unshipped, worth merging:**

- **`fix/hole-12-invoice`** (made 2026-08-26, 1 day old) — Confirmed genuinely new. It makes the "Invoice this client" button actually write an invoice record, instead of only creating a payment link with nothing behind it. Clean, small, touches one feature. This is money/billing related, so it needs the COMPLIANCE REVIEW REQUIRED sign-off this repo's rules already call for — not a new ask, just flagging it per your own rule.
- **`docs/thread-collision-2026-08-27`** — Just the one notes file described above in section 3. No code. Already sitting in your current working files, just not on main yet. Zero risk to merge.

**Looked like live work, turned out to already be shipped (safe to delete, nothing to merge):**

- `feat/commission-payout-crm` — I checked: the "approve commission" and "mark commission paid" features it adds are **already live on main**, built a different way. This branch is a leftover copy.
- `feature/repair-ws-b-engine`, `feature/repair-ws-c-inbound`, `feature/repair-ws-d-emails`, `feature/repair-ws-e-dashboard` (4 branches, all from 2026-08-21, part of an older "repair engine" build) — I checked their database migration files: main has files with the exact same names already. This work already shipped under different commits. Nothing new left inside these four.
- `fix/present-matches-underwriteiq` — Checked closely: main's code already has the exact fix this branch was trying to make (showing the same loan number on two different screens), and main's version is newer and better-tested. If this branch were merged, it would actually **remove** a newer, more-correct fix and put an older, buggier one back. Do not merge this one — it would make things worse, not better.
- `fix/homepage-survey-negatives` — Checked every file it touches: all already identical on main. Nothing left to merge.
- `prove/journeys-ar-calls` — Same story: the actual code (phone call handling) is already on main word-for-word. Only a notes file is new, and it's low value on its own.
- `fix/staff-profile-edit` / `fix/staff-start-date-display` (two branch names, same one commit) — This is **older** than main, not newer. Merging it would delete things main currently has (an agreements viewer, a notification toggle, some menu items). Do not merge — this is a step backward, not forward.
- `fix/ci-green-main` — An old test-fixing branch from 2026-08-21; superseded by newer test fixes already on main.

## Files I looked at, for reference

- `/Users/zootimusmaximus/fundhub-platform/docs/workflows/thread-collision-2026-08-27.md` — the existing repo note this audit leans on and re-verifies
- Compared against `origin/main` at commit `f11f2b42` (post-fetch)

**Risks:**
- fix/hole-12-invoice writes to the invoices table and touches payment links — needs the COMPLIANCE REVIEW REQUIRED sign-off before it ships, same as your own rule already says.
- The vc/save-2026-08-25 migration files numbered 259/260/261 collide with three different migrations already on main under the same numbers. If anyone ever applies that branch wholesale, both versions would try to run, in whatever order alphabetical sorting picks — not a safe outcome. Two of the three set affiliate commission pay rates.
- Do not merge fix/present-matches-underwriteiq or fix/staff-profile-edit / fix/staff-start-date-display — both are older than what's already on main, and merging either would remove work that currently exists, not add anything.

**Recommendation:**
Worth merging now: fix/hole-12-invoice (real, one day old, small, clean — flag COMPLIANCE REVIEW REQUIRED per your own rule since it touches invoices/payment links) and docs/thread-collision-2026-08-27 (just a notes file, zero risk). Worth a slow, one-file-at-a-time look, not a branch merge: vc/save-2026-08-25 — pull out the 4 still-missing files (commas-safe-copy.mjs, company-brain/transcribe.mjs, meet-local-whisper.mjs, campaigns/meta-agency.mjs) individually, and get your call on the two affiliate-commission migrations before anyone renumbers and applies them. Leave stranded / safe to delete: feat/commission-payout-crm, feature/repair-ws-b/c/d/e-*, fix/ci-green-main, fix/homepage-survey-negatives, fix/present-matches-underwriteiq, fix/staff-profile-edit, fix/staff-start-date-display, prove/journeys-ar-calls, and every branch git already shows as fully merged (roughly 45 of the ~60 total). None of these have anything main doesn't already have — two of them (present-matches-underwriteiq, staff-profile-edit) would actively make things worse if merged.

## C — GitHub PRs and CI

No open pull requests right now — the queue is empty, so there is nothing waiting for a merge click. The last 5 runs of the test robot on main show 3 failures and 2 cancels, but that matches the known, already-explained pattern (a flaky "screens" browser check), not a new break.

**1. Open pull requests: zero.**
I checked `ZootimusMaximusBackup/fundhub-platform` and there are no open PRs at all. The 10 most recent PRs (#244–#253) are all either merged into main already or closed. Nothing is sitting open, so there's nothing to review, nothing with conflicts, and nothing "ready to merge."

**2. What the test robot says about main (last 5 runs):**

| When (UTC) | What it was testing | Result |
|---|---|---|
| 23:18 | PR #244 merge | FAILED |
| 23:16 | PR #243 merge | Cancelled (a newer push came in first) |
| 23:02 | PR #249 merge | FAILED |
| 23:01 | PR #253 merge | Cancelled |
| 22:48 | PR #252 merge | FAILED |

**3. Why the failures aren't a red flag.**
I opened the most recent failing run (the one after PR #244) and looked at what actually broke. Two of the three test groups passed clean:
- The database tests: passed.
- The "real Postgres" tests: passed.
- The "screens (real browser)" check: this is the one that failed.

Your own notes say this exact pattern — main showing red because of the browser-screens check, while the database suite itself is clean — is a known, already-tracked situation, not a surprise. So this isn't a new thing breaking; it's the same known noisy check.

The two "cancelled" runs aren't failures either — they got cancelled because someone pushed a newer change while the check was still running, so GitHub just skipped straight to testing the newer one.

**4. Per-PR CI checks, classification, and "ready to merge" list — not applicable.**
There are no open PRs, so there's nothing to classify as ready / needs work / stale, and nothing to check individually.

**Risks:**
- Main's CI shows failures on the browser-screens check, but per project notes this is a known/expected pattern tied to that specific check, not the database or core test suite.
- This audit only looked at the last 5 runs on main and did not dig into whether the screens check has been red for a long stretch or just started — worth a closer look if it matters for a decision.

**Recommendation:**
No PRs to merge — the open-PR list is empty. Nothing is ready, nothing needs work, nothing is stale, because there is nothing open right now.

## D — Deployment status

Production is fully caught up with main. The live site is running the exact same code as the newest commit on GitHub, and the database has 0 pending changes. No deploy is needed right now.

**Short answer: production and main are the same. Nothing is behind.**

### 1. Confirmed I'm looking at the right site
`netlify status` worked fine (it was NOT blocked, unlike the note in CLAUDE.md about this environment). It showed:
- Site: `transcendent-wisp-888771`
- Live URL: `https://fundhub.ai`
- Logged in as Chris Stanbridge, team Fundhub

This matches what the task asked me to check.

`netlify env:list --context production --plain` also worked. I'm only reporting the **names** below, as asked — 70 variables are set for production, covering things like the database connection, Twilio, Mailgun, Resend, Meta/LinkedIn/Threads ad accounts, Bland, Commas, Postgrid, CRS credit-report API, Inngest, and encryption keys. Nothing looked missing that the app would need.

One thing worth flagging once: the `--plain` flag is supposed to hide secret values, but for a handful of variables it printed the **full, unmasked value** instead of dots (the database password and the Anthropic API key were two of them). I did not put any of those values in this report or anywhere else. Worth knowing for next time someone runs that exact command with `--plain`.

### 2. Latest production deploy vs. main
I pulled the deploy history directly from Netlify's API (this worked too — no blocked connection). The most recent production deploy:
- Commit: `f11f2b42ac134e9253f57372387106fe083f2dca`
- Title: "Merge pull request #244: Pipeline design polish"
- Status: ready, published 2026-08-27 23:19 UTC

I checked that against `git rev-parse origin/main` in this folder: also `f11f2b42ac134e9253f57372387106fe083f2dca`.

**Same commit. Zero commits behind.**

(Side note, not a deployment problem: your local checkout here is on a GitButler workspace branch with a lot of uncommitted changes, and your local `main` bookmark is 102 commits stale — but that's just this laptop's local git state. It has nothing to do with what's actually live, since Netlify deploys straight from GitHub's `main`, not from this folder.)

### 3. Live health check
I called `https://fundhub.ai/api/health` directly. It answered:
- `ok: true`
- database: up
- migrations: 217 applied, **0 pending**

Zero pending migrations means the live database is fully caught up — nothing is waiting to be applied.

### 4. Build/version info
The deploy record itself confirms the live site is running commit `f11f2b42ac...` (PR #244), which is the same commit as the tip of `origin/main`. That's the clearest version signal available; there's no separate on-page version number to cross-check.

### 5. Bottom line
Production is caught up with main. Not behind at all. No deploy needed today.

**Risks:**
- None found for deployment state itself — production matches main and migrations are fully applied.
- Minor, unrelated finding: netlify env:list --context production --plain printed a few variable values unmasked instead of dots (the database URL and the Anthropic API key were two). Not caused by this audit's actions beyond running the read-only command the task asked for, and no values were repeated anywhere in this report.

**Recommendation:**
No deploy needed — production already matches the latest main commit (f11f2b42a) exactly, 0 commits behind, and the live health check shows 0 pending database migrations. No blockers, no blocked network calls encountered (netlify CLI and the API worked fine in this run). Only thing worth a look later, not a deploy blocker: `netlify env:list --plain` unmasked a couple of secret values on screen — might be worth checking why that flag isn't redacting everything it should.

## Status

pending — awaiting owner decision on what to commit/merge/deploy
