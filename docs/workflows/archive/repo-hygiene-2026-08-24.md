# Repo hygiene — 2026-08-24

**Status: WRAPPED (committed).** W2 ignore + index untrack + agentify on disk.  
No disk deletes. No force-push. No product code edits in this wrap.

**Do not touch:** live product code (`src/`, `api/`, `public/app` core, Present/closer paths) unless a later message names that path. Never commit `.env` / `credentials/` / secrets.

**Related:** `.cursor/rules/agentic-audit-guardrails.mdc`. Older inventory: `docs/workflows/repo-purge-candidates-2026-08-21.md`.

---

## Why things keep getting lost (proven)

| Cause | Evidence |
|---|---|
| Huge evidence in git + on disk | `docs/workflows` ≈ **803M**; was **~5,779 tracked** evidence files |
| Fresh untracked dumps | Today: company-sim / linkedin / ads evidence — **ignored**, stay on disk |
| Evidence ignore + untrack | **W2 done** — ignore rules + `git rm --cached` (files on disk) |
| Branch + stash sprawl | **17** local branches; **35** stashes; **6** worktrees (plan only — no deletes) |
| Dirty `main` leftovers | Product WIP left **unstaged** on purpose (oauth, seed, ghl-doc, money-chain, portal) |
| Policy only in chat historically | Skills/rules/hooks now committed (W3) |

---

## Parallel split (5 workflows)

| ID | Owns | Status | Owner |
|---|---|---|---|
| **W1** | Evidence inventory + KEEP/ARCHIVE/GITIGNORE/MOVE proposals | `done` | hygiene session 2026-08-24 |
| **W2** | `.gitignore` + index untrack of tracked evidence | `done` *(wrap commit)* | wrap session 2026-08-24 |
| **W3** | Skills/rules/hooks discoverability | `done` *(wrap commit)* | wrap session 2026-08-24 |
| **W4** | Branch / stash / commit-policy cleanup plan | `done` *(plan only — no deletes)* | hygiene session 2026-08-24 |
| **W5** | Today’s sim / LinkedIn / ads leftover triage | `done` | hygiene session 2026-08-24 |

---

## W3 — Agentify on disk (committed)

| Path | Role |
|---|---|
| `.cursor/skills/fundhub-repo-hygiene/SKILL.md` | Inventory + labels |
| `.cursor/skills/fundhub-version-control/SKILL.md` | VC / lose-work prevention |
| `.cursor/rules/repo-hygiene-vc-router.mdc` | alwaysApply router |
| `.cursor/hooks.json` + `.cursor/hooks/warn-secret-stage.cjs` | Warn on secret-ish stage |
| `.cursor/rules/agentic-audit-guardrails.mdc` | Agentic audit fences |
| `.cursor/rules/audit-vs-fix-router.mdc` | Points at hygiene/VC + agent loop |

---

## W2 — Ignore + index untrack (done)

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

**Self-verify (agent, wrap):**

| Check | Result |
|---|---|
| `git check-ignore` company-sim / linkedin evidence | matched |
| company-sim evidence on disk | yes (~7.9M) |
| ui-audit / audit-crm evidence on disk after untrack | yes |
| Product WIP still dirty, not in wrap commits | yes |

---

## W1 leftovers (no disk delete this wrap)

| Ref | Path | Status |
|---|---|---|
| B1–B3, B5–B18, … | Huge SAFE dumps | **GITIGNORE + untracked from index** — still on disk; ARCHIVE move later if Chris wants |
| B4 | `e2e-verify-run5-evidence/` | **ASK** if still needed as live-playwright proof (on disk, not in index) |
| B19 | `bland-agents-prove-evidence/` | **ASK** |
| Branches / stashes | 17 / 35 | Plan only — delete only after Chris go |

---

## W4 leftovers (not done — need separate go)

- Delete merged local branches (check worktrees first)
- Stash triage one-by-one (no bulk drop)
- Product WIP commits (oauth / ghl-doc / money-chain / portal / seed) — **separate**, not this wrap

---

## W5 — Today’s boards

| Path | Wrap |
|---|---|
| `repo-hygiene-2026-08-24.md` | KEEP — this board |
| `company-sim-2026-08-24.md` | KEEP — board text |
| `linkedin-connect-2026-08-24.md` | KEEP — board text |
| `ads-revenue-model-2026-08-24.md` | KEEP — board text |
| `*-evidence/` for those | GITIGNORE — on disk only |

---

## Change manifest (wrap)

| Action | Paths |
|---|---|
| Ignore | `.gitignore` evidence + scratch block |
| Index untrack | ~6k evidence paths + artifacts/jokes (disk kept) |
| Boards | this file + today workflow `.md` boards |
| Agentify | skills, routers, hooks, agentic-audit guardrails |
| **Not** in wrap | product `src/`/`api/`/`public/`/`db/` WIP; scripts; evidence trees on disk |

---

## Chris go options (next — after audit)

- `ARCHIVE SAFE B` — move huge dumps off hot tree (optional; already untracked)
- `delete merged locals` — after worktree cleanup
- Product commits — name the concern (oauth / docgate / etc.)
- Fixer items — after E2E audit FAIL list
