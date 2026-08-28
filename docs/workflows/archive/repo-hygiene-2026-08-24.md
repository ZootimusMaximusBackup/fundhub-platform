# Repo hygiene — 2026-08-24

**Status: W4 APPLY DONE (this session).** W1–W3 + W5 wrap already committed earlier.  
This pass: deleted merged locals, removed one clean worktree, dropped one empty stash, wrote remaining proposals.  
No disk evidence deletes. No ARCHIVE move (no KEEP/KILL marks). No force-push. No product code edits. No secret commits.

**Do not touch:** live product code (`src/`, `api/`, `public/app` core, Present/closer paths) unless a later message names that path. Never commit `.env` / `credentials/` / secrets.

**Related:** `.cursor/rules/agentic-audit-guardrails.mdc`. Older inventory: `docs/workflows/repo-purge-candidates-2026-08-21.md` (KEEP/KILL columns still empty).

---

## Why things keep getting lost (proven)

| Cause | Evidence |
|---|---|
| Huge evidence in git + on disk | `docs/workflows` ≈ **813M** disk; was **~5,779 tracked** evidence files |
| Fresh untracked dumps | company-sim / linkedin / ads evidence — **ignored**, stay on disk |
| Evidence ignore + index untrack | **W2 done** — ignore rules + `git rm --cached` (files on disk) |
| Branch + stash sprawl | Was **17** locals / **35** stashes / **6** worktrees → now **9** locals / **34** stashes / **5** worktrees |
| Dirty `main` leftovers | Product WIP left **unstaged** on purpose (oauth, seed, ghl-doc, money-chain, portal) |
| Policy only in chat historically | Skills/rules/hooks now committed (W3) |

---

## Parallel split (5 workflows)

| ID | Owns | Status | Owner |
|---|---|---|---|
| **W1** | Evidence inventory + KEEP/ARCHIVE/GITIGNORE/MOVE proposals | `done` | hygiene session 2026-08-24 |
| **W2** | `.gitignore` + index untrack of tracked evidence | `done` *(wrap commit)* | wrap session 2026-08-24 |
| **W3** | Skills/rules/hooks discoverability | `done` *(wrap commit)* | wrap session 2026-08-24 |
| **W4** | Branch / stash / commit-policy cleanup | `done` *(apply + proposals)* | go session 2026-08-24 |
| **W5** | Today’s sim / LinkedIn / ads leftover triage | `done` | hygiene session 2026-08-24 |

---

## Already done (prior wrap — do not redo)

### W3 — Agentify on disk (committed)

| Path | Role |
|---|---|
| `.cursor/skills/fundhub-repo-hygiene/SKILL.md` | Inventory + labels |
| `.cursor/skills/fundhub-version-control/SKILL.md` | VC / lose-work prevention |
| `.cursor/rules/repo-hygiene-vc-router.mdc` | alwaysApply router |
| `.cursor/hooks.json` + `.cursor/hooks/warn-secret-stage.cjs` | Warn on secret-ish stage |
| `.cursor/rules/agentic-audit-guardrails.mdc` | Agentic audit fences |
| `.cursor/rules/audit-vs-fix-router.mdc` | Points at hygiene/VC + agent loop |

### W2 — Ignore + index untrack (done)

**Ignore block** (`.gitignore`):

```gitignore
docs/workflows/*-evidence/
docs/workflows/**/*-evidence/
docs/workflows/*/evidence/
docs/workflows/fix-*/evidence/
docs/artifacts/
docs/jokes/
.playwright-mcp/
```

**Untrack:** `git rm --cached` on tracked `*-evidence/` trees + `nav-kill-…/evidence/` + `docs/artifacts/` + `docs/jokes/` (~6,238 index paths). **Files remain on disk.**

**Self-verify (go session):** `git ls-files 'docs/workflows/*-evidence*'` → **0**. `git check-ignore` company-sim evidence → matched. Disk dumps still present (~813M under `docs/workflows`).

---

## W4 — Done this session (Go apply)

### Local branches deleted (fully merged, 0 commits unique vs `main`)

| Branch | Notes |
|---|---|
| `feature/repair-a-live-prove` | deleted |
| `fix/ccp-pull-button` | deleted |
| `fix/deposit-save-product-id` | deleted |
| `fix/ghost-booking-clickfunnels` | deleted |
| `fix/nav-hide-move-ccp` | deleted |
| `fix/pipeline-new-client` | deleted |
| `fix/present-s23-pay-link` | deleted |
| `feat/closer-dashboard-screen-merge` | worktree removed (was clean) + branch deleted |

### Stash

| Action | Result |
|---|---|
| Dropped `stash@{22}` (old index; message: `On fix/controls-persist: wip`) | Confirmed **empty** (0 files even with `-u`) |
| All other stashes | **Proposals only** — see table below |

### Remaining locals (keep — unique work or open)

| Branch | ahead/behind main | Worktree? | Proposal |
|---|---|---|---|
| `feat/commission-payout-crm` | 1 / 30 | no | KEEP until merged or Chris kills |
| `feature/repair-ws-b-engine` | 2 / 45 | yes (`…-ws-b-engine`) | KEEP |
| `feature/repair-ws-c-inbound` | 1 / 43 | no | KEEP |
| `feature/repair-ws-d-emails` | 1 / 42 | yes (`…-ws-d-emails`) | KEEP |
| `feature/repair-ws-e-dashboard` | 1 / 41 | yes (`…-ws-e-dashboard`) | KEEP |
| `fix/ci-green-main` | 1 / 51 | no | ASK — likely stale vs green main |
| `fix/staff-profile-edit` | 1 / 52 | no | ASK — related to start-date branch |
| `fix/staff-start-date-display` | 1 / 52 | yes (`/private/tmp/fundhub-staff-edit`) | KEEP until worktree closed |
| `main` | ahead **3** of `origin/main` | — | hygiene commits unpushed (push only if Chris asks) |

### Remaining worktrees (5)

| Path | Branch |
|---|---|
| `/Users/zootimusmaximus/fundhub-platform` | `main` |
| `/Users/zootimusmaximus/fundhub-platform-ws-b-engine` | `feature/repair-ws-b-engine` |
| `/Users/zootimusmaximus/fundhub-platform-ws-d-emails` | `feature/repair-ws-d-emails` |
| `/Users/zootimusmaximus/fundhub-platform-ws-e-dashboard` | `feature/repair-ws-e-dashboard` |
| `/private/tmp/fundhub-staff-edit` | `fix/staff-start-date-display` |

---

## W4 leftovers — stash triage proposals (no bulk drop)

**34 stashes.** Indices shift when any drop — use the **message**, not only the number.

| # | Message (theme) | Proposal | Why |
|---|---|---|---|
| 0 | `comms-build-wip-before-main-switch` | **ASK** | Large (~82 files) — may still hold commission/comms WIP |
| 1 | `e-pre-rebase` | **DROP?** | Tiny board-only change; likely superseded |
| 2 | `pre-merge-wip` | **ASK** | Untracked repair prove PNGs only |
| 3–5, 7–9 | repair WS noise / park | **ASK** | Repair workspace parking — don’t drop until WS branches land |
| 6 | `unrelated a-prove WIP` | **ASK** | Has `repair-inbound-mail.test.mjs` |
| 10 | `wip-before-finish-check` | **ASK** | Cockpit/repair mix (~24 files) |
| 11 | `nav-kill` pre-switch | **DROP?** | Old nav-kill parking |
| 12–16 | main / cloud-agent parking | **ASK** | May overlap product WIP already on disk |
| 17–21 | money-chain / inquiry-removal | **ASK** | Inquiry-removal WIP lives here — do not drop while that lane is open |
| 22 | `wip before org-brand-crm` | **ASK** | Has `docs/CONTROLS-AUDIT.md` only |
| 23–33 | controls / company-brain / chat-widget / agent-editor | **ASK** | Old parking; likely superseded but not proven |

**Safe next stash action (one at a time):** Chris says `drop stash <message substring>` for a named row, or `keep all stashes`.

---

## W1 leftovers (no disk delete this pass)

| Ref | Path | Status |
|---|---|---|
| B1–B3, B5–B18, … | Huge SAFE dumps | **GITIGNORE + untracked from index** — still on disk (~650M+); ARCHIVE only after Chris marks KEEP/KILL or says `ARCHIVE SAFE B` with destination |
| B4 | `e2e-verify-run5-evidence/` (~82M) | **ASK** if still needed as live-playwright proof |
| B19 | `bland-agents-prove-evidence/` | **ASK** |
| Purge board A/C/E rows | vendor / root clutter | Still unmarked on `repo-purge-candidates-2026-08-21.md` |

**Proposed ARCHIVE destination (not applied):** `docs/workflows/_archive/2026-08/` or off-repo external drive — wait for go + KEEP/KILL.

---

## W5 — Today’s boards

| Path | Wrap |
|---|---|
| `repo-hygiene-2026-08-24.md` | KEEP — this board |
| `company-sim-2026-08-24.md` | KEEP — board text (dirty from other agents — leave alone) |
| `linkedin-connect-2026-08-24.md` | KEEP — board text |
| `ads-revenue-model-2026-08-24.md` | KEEP — board text |
| `*-evidence/` for those | GITIGNORE — on disk only |

---

## Change manifest

### Prior wrap (already committed on `main`, ahead of origin by 3)

| Action | Paths |
|---|---|
| Ignore | `.gitignore` evidence + scratch block |
| Index untrack | ~6k evidence paths + artifacts/jokes (disk kept) |
| Agentify | skills, routers, hooks, agentic-audit guardrails |
| Board | this file (earlier wrap text) |

### This Go session (local only — board edit + git branch/stash ops; **not committed** unless Chris asks)

| Action | Result |
|---|---|
| Deleted 8 merged local branches | listed above |
| Removed 1 clean worktree | closer-dashboard merge |
| Dropped 1 empty stash | controls-persist empty `wip` |
| Updated this board | status + W4 apply + stash proposals |
| **Not** touched | product WIP; other agents’ boards; evidence on disk; remotes; force-push |

---

## Self-verify (go session)

| Check | Result |
|---|---|
| Evidence paths still in index | **0** |
| Ignore matches company-sim evidence | yes |
| Merged locals with 0 unique commits gone | yes (8) |
| Worktrees with open repair/staff work kept | yes (4 + main) |
| Product WIP still dirty on `main` | yes (oauth / ghl-doc / money-chain / portal / seed) |
| Stash bulk-drop | **no** — only empty one dropped |

---

## Chris go options (next)

1. `ARCHIVE SAFE B` — name destination; or mark KEEP/KILL on purge board first  
2. `drop stash <message>` — one named stash at a time  
3. `kill fix/ci-green-main` and/or staff-profile locals after confirming worktrees  
4. `push main` — ships the 3 unpushed hygiene commits (only if he asks)  
5. Product commits — name the concern (oauth / docgate / money-chain / portal / seed) — **other lanes**
