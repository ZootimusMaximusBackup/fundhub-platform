# Creative Factory declutter — 2026-08-17

**COMPLIANCE REVIEW REQUIRED** — this batch moves a table of CROA / FTC Act / FTC Endorsement Guides rules off a marketing screen. No enforcement logic is touched; only what is shown and where the reference lives.

**Owner ask, verbatim:** "Strip internal explanation text and file references. The CROA/FTC compliance rules table with statute citations does not belong on a marketing screen — move it somewhere appropriate or collapse it. Refresh the layout. Do not invent data."

**Owner-set decision (recorded, not up for review):** do BOTH. On screen the block-reason list becomes a closed section in plain words with no statute numbers. The full table with citations moves to `docs/compliance/creative-block-reasons.md`, generated from the code that enforces it.

**Screen:** `public/app/creative-factory.html` (2275 lines at start of batch, HEAD = 7be91a0)

## Task list

| Task | Owner | Files owned — nobody else may touch these | Status |
|---|---|---|---|
| A — ground brief + the screen edit | agent-A | `public/app/creative-factory.html` | **DONE** (orchestrator fixed one defect after — see below) |
| B — new home for the legal rules | agent-B | `docs/compliance/creative-block-reasons.md` (new) | **DONE** |
| C — sibling screens (social-studio, brand-studio) | — | — | NOT LAUNCHED — out of the owner's ask, parked |
| D — journeys `-actual.md` + changelog | agent-D | `docs/journeys/*-actual.md`, `docs/journeys/CHANGELOG.md` | **DONE** |
| E — checks + live proof | agent-E | evidence folder only | **BLOCKED** — checks done by the orchestrator and green; live proof impossible while fundhub.ai answers 503 `usage_exceeded` |

## Shared context brief (ground once, fan out)

- The screen has 13 panels, coded `CF-00`..`CF-12` in HTML comments and eyebrow labels.
- `CF-07 · BLOCK REASON CATALOGUE` is the table in question: columns `Code | Rule set | Match | Severity | Applies to | Citation`, 29 rows on live.
- The 29 rows come from three places in code, not one: `db/migrations/047_compliance_rules.sql` (12 seeded rows), `src/compliance/screen.mjs` (8 engine codes), `src/compliance/targeting.mjs` (9 Meta special-ad-category codes, no citation, no severity). Verify this — do not take it on trust from this line.
- Known builder-facing text visible to a user (non-exhaustive, agent A produces the full list): `src/creative/generate.mjs:31-32` style file references in the job-state legend, `PLACEHOLDER set in 052 — AWAITING SIGN-OFF` in the readiness table, a `Show request URLs` rail, raw JSON dumps in the detail drawer, and the `CF-00` codes.
- Harness for live evidence: `docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs`. Live target is `https://fundhub.ai`. Local `netlify dev` is not a valid target — it answers 503 under one screen's normal read burst.
- Baseline before this batch, per `ui-audit-2026-08-17.md`: `npm run lint` clean; `npm test` has pre-existing reds; `npx tsc --noEmit` cannot run (no `tsconfig.json` in this repo).

## The established pattern this batch must match

Item 10 of the owner's list was Social Studio (`docs/workflows/social-studio-plain-2026-08-17.md`): "codes stripped, plain names, builder detail moved behind a closed 'How this works' section instead of sitting in the page body", matching Command Center and Affiliate.

The idiom already in the tree is a closed `<details>`. `public/app/affiliate.html:233` with the CSS at `:111-115`:

```html
<details class="scopebar" style="margin-top:14px">
  <summary class="st">What you can see</summary>
  <span class="st">…plain-language explanation…</span>
</details>
```

Creative Factory must read the same way. Do not invent a new disclosure widget.

## Change manifests

Agents do NOT edit this board while code is being edited. Each writes ONE file:
`docs/workflows/creative-factory-declutter-evidence/manifest-<lane>.md`. The orchestrator merges them here.

## Lane B — merged manifest (2026-08-17)

Wrote `docs/compliance/creative-block-reasons.md` (250 lines). The `docs/compliance/` folder did not exist before this — CLAUDE.md §7 points at it, nothing had created it.

**Counts re-measured from source, all three matched the brief:** 12 seeded rows (`047_compliance_rules.sql`) + 8 engine codes (`src/compliance/screen.mjs`) + 9 Meta targeting codes (`src/compliance/targeting.mjs`) = **29**. Every row on the screen traces to real code. **No invented rule, citation or severity was found, so there was no hole to fill.**

**Link anchor for Lane A:** `docs/compliance/creative-block-reasons.md#every-block-reason` (heading verified on disk, line 104).

**Screen claims checked against code:** "credit-repair creative always needs a person" — TRUE, and the setting that would switch it off is never read. "credit-repair ads cannot run on TikTok" — TRUE, blocked in three separate places.

**Screen caption that is wrong:** "Each reason stops the work." True for 27 of 29. The two approval reasons hold the work for a person instead. Relayed to Lane A; must not be reused as-is.

**Gaps found — recorded, not filled:**
1. Campaigns are not screened today. The campaign checker is real code, but nothing hands it a campaign. Its only callers are pause / resume / budget change, which are correctly exempt.
2. Nothing in the product can create a campaign or ad set — no button, no route reaches that code. The 9 Meta targeting rules only fire during ad-set creation, so none of them can fire today. Written and tested, not reachable.
3. All 12 seeded rules are set to "stop". The "warn and keep going" severity was built and is unused.
4. Two copy-screening paths (website copy, queued marketing copy) leave no record that a screening happened.

## Lane A — merged manifest (2026-08-17)

`public/app/creative-factory.html`: 409 insertions, 479 deletions. Now 2205 lines (was 2275).

**Verified by the orchestrator, not taken on trust:**
- Statute citations remaining in the file: **0** (`grep -cE 'U\.S\.C|CFR|CROA 15|FTC Act'`).
- Every remaining `.mjs:` / `.sql:` / `CF-0x` string sits inside a `/* … */` JavaScript comment or is a property name in code — **none is visible to a user**.
- The four closed `<details class="scopebar">` sections exist, with the CSS at `:249-255`, matching the Affiliate idiom.
- Panel order is now partner scope → usage → generate and decide → jobs → library → review queue → brand kits → Reference (closed).

**Defect found by the orchestrator and fixed.** Lane A linked the collapsed section to `../../docs/compliance/creative-block-reasons.md#every-block-reason`. `netlify.toml` sets `publish = "public"` and `docs/` sits outside `public/`, so on live that link would have been a **404** — a control that promises a page the site does not serve. (Citing a repo doc on a screen is also already logged as a fault on the main UI audit board: Social Studio citing `docs/STILL-MISSING.md`.) The link was replaced with plain text: the full cited list is kept with the company compliance rules and is not shown on this screen. The reference page itself is unchanged and still the right home for it.

**Screen caption corrected:** "Each reason stops the work" → 27 of 29 stop the work, 2 hold it for a person. Sourced from Lane B's code reading.

**Left open by Lane A, both needing the owner:**
- 390px still scrolls sideways by ~109px. Cause is NOT this screen — it is the session name chip that `shell.js` injects into the top bar of every screen. Already on the main audit board; needs its own job.
- Five summary tiles sit in one row; `docs/UI-STANDARDS.md` says never five. All five are real numbers, so removing one would delete real information. Owner's call.
- Some stop messages come from the checking engine and still contain technical words like `ai_generated`. Left exactly as the engine says them, so the screen cannot disagree with what a stopped creative actually shows. Making those plain means editing `src/compliance/` — a separate job.

**Working-tree hazard, recorded because it cost real time:** other agent sessions are editing this repo concurrently. One ran a command that discarded every unsaved change in the tree, twice, including Lane A's. Lane A recovered from its own backup both times. `main` also moved under this batch (HEAD was `7be91a0` at kickoff, `9ec9c25` by the time Lane A finished). Lane A's and Lane B's output is backed up outside the repo. Lanes D and E are instructed never to run a tree-discarding git command.

## Checks — measured by the orchestrator on the shared tree, 2026-08-17

- `npm run lint` → clean, 1297 files.
- `npm test` → **5634 tests, 5629 pass, 2 fail, 3 skipped**. The two failures are `the extraction is faithful to the code` and `an endpoint excused from the org filter still passes the session's org to its store`.
- **The first failure was proven pre-existing**, not caused by this batch: a clean `git worktree` at HEAD (`9ec9c25`) runs `scripts/journeys/generate.test.mjs` → 20 tests, 19 pass, 1 fail, same subtest. Measured today, in this environment, per CLAUDE.md §12.
- `npx tsc --noEmit` cannot run — no `tsconfig.json` in this repo. Not faked. (DOC-GAP, already recorded on the main audit board.)
- Caveat, stated plainly: other sessions are editing this same tree, so these counts include their work as well as this batch's.

## Lane D — merged manifest (2026-08-17)

**No `-actual.md` file changed, and that is the correct result — verified independently by the orchestrator, not taken on trust.** `npm run journeys:check` → `docs/journeys is up to date (9 files)`. The journey pages are generated from routes and role gates; this batch changed screen wording and panel order and touched neither. The screen calls the same eight endpoints before and after (seven `/api/creative/*` plus `GET /api/partner-marketing/usage`). Hand-editing those files to "document" this batch would have broken the suite, because the suite regenerates and compares them.

One entry appended to `docs/journeys/CHANGELOG.md`.

**Gaps found, recorded and NOT reconciled (CLAUDE.md §4 forbids editing `-intended.md`):**
1. All eight `-intended.md` files say Creative Factory is **4 routes**. It has been **7** since 2026-08-02 — the same day those pages were written. Pre-existing.
2. `white-label-intended.md` §5 says the usage card shows "tokens used this month vs a 250,000 cap". The card is now headed "Writing budget" and says **words**, and the cap is whatever the usage endpoint returns — 250,000 is only the default, and a partner may be set to a different one.
3. No `-intended.md` file has ever mentioned the on-screen block-reason table or its citations. Nothing said it belonged there, and nothing says it should go. No intended journey was broken either way.

## Working-tree reconciliation before commit (orchestrator)

Another session's in-flight nav restructure had leaked into `creative-factory.html` while Lane A was recovering from the tree being wiped: the file had lost the `Subscriptions` nav row and carried a `Contracts` → `Contract templates` rename that belongs to the contracts/documents batch, not this one. **The whole `<aside class="side">` block was restored byte-for-byte from HEAD**, so this commit carries only the declutter. That other batch will land its nav change across all 34 screens in its own commit.

**Proof this batch adds no test breakage** — the decluttered file was copied into a clean `git worktree` at HEAD and the shell/nav suites run there:
- `src/http/app-nav-matches-shell.test.mjs` → 27 pass / 7 fail **with** our file, and 27 pass / 7 fail **without** it. Identical. Those 7 are pre-existing at HEAD.
- `src/http/routes.test.mjs` + `src/http/mobile-shell.test.mjs` in the same clean worktree → **59 pass, 0 fail**.
- In the live shared tree the same nav test shows 31 failures, because another session has changed `shell.js` and has not yet copied it into the screens. Not this batch, and not fixable from here.

## Committed

`0be3c22` — "Take the builder text and the law citations off Creative Factory."
Three files: `public/app/creative-factory.html`, `docs/compliance/creative-block-reasons.md`, `docs/journeys/CHANGELOG.md`. Staged path-by-path; the changelog was staged as HEAD-plus-our-line-only so the contracts batch's entry stayed in the working tree as theirs to commit. **Not pushed. Nothing is live.**

## PUSHED — and the live site is down, for a reason that is not this change

`0be3c22` + `dea8019` pushed to `main` at ~04:28 UTC 2026-08-18 on the owner's instruction ("Push it").

**https://fundhub.ai returns HTTP 503 `{"error":"usage_exceeded","message":"Usage exceeded"}` on EVERY path** — homepage, every screen, and `/api/*`. Netlify has paused the project because the account is over its usage allowance.

Measured, not guessed:
- `netlify api listSiteDeploys` → **15 deploys in the last hour**, the newest at 04:21:50 UTC. They are spaced roughly two minutes apart and carry other sessions' commit titles (hiring board, pipeline board, hiring screen, contracts/documents).
- **No deploy was ever created for `0be3c22` or `dea8019`.** The push landed on `main`; Netlify did not start a build for it.
- This is the failure mode CLAUDE.md §11 already records from 2026-08-06: too many builds burn the month's credits and the live site is paused.

**Nothing was retried.** Re-deploying costs another build and would make it worse. Fixing the allowance is a billing decision and belongs to the owner alone.

**Consequence for this batch:** the code is on `main` and will go live with the next successful build. Lane E cannot capture live proof until the site answers again.

## WHERE THIS STOPPED — 2026-08-18, read this first if you pick it up later

**The work is done and safe on `main`.** Two commits: `0be3c22` (declutter) and `dea8019` (budget card says tokens, 250,000 cap named).

**It is NOT on the live site yet.** fundhub.ai recovered from the `usage_exceeded` outage and answers 200 again, but it still serves the OLD page — checked directly: 10 statute citations still on live, no closed reference sections, no tokens caption. Netlify never built the commits; the queue was frozen during the outage and nothing has triggered a build since.

**To finish, one action:** trigger a build of `main` — `netlify api createSiteBuild --data '{"site_id":"5905dba4-9942-480c-a510-813a3fe2b073"}'`, or Netlify project → Deploys → Trigger deploy. (The orchestrator was blocked from running this by the local permission classifier — not a Netlify problem.)

**Know before deploying:** `origin/main` moved to `8503b8c` ("Make the CRM text bigger, the layout wider, and stop the panels jumping") from another session, which sits ahead of this batch. A build publishes that too. It was not reviewed by this batch.

**After the build, the only thing left is Lane E:** live proof shots on fundhub.ai with `docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs`. Nothing else is outstanding.

## Blockers and open questions

**OQ-1 — owner decision, not blocking this batch.** Gaps 1 and 2 above mean the campaign guardrail is built but not switched on. Either "not finished yet, and that is fine" or "we believed this was live and it is not." The code cannot say which. Raised for the owner; nothing in this batch depends on the answer.
