# Claude Code / Cursor config merge — 2026-08-31

**Batch owner:** Chris
**Branch:** `claude/codus-features-eval-1sn0hf`
**Decision (owner, 2026-08-31):** Keep BOTH tools working. Cursor stays exactly as it is.
One copy of every file. Claude Code reaches them by link, not by copy.

## The problem in one line

Claude Code loads only `CLAUDE.md` and `.claude/`. Every skill and rule in this
repo lives in `.cursor/`. So in Claude Code — this chat, the phone, the web —
the audit/fix router never fires and none of the ten skills exist.

`.claude/` currently contains one file: `settings.json`.

## Tasks

| ID | Task | Owner | Status |
|---|---|---|---|
| W1 | Symlink the 10 `.cursor/skills/*` dirs into `.claude/skills/` | unclaimed | `pending` |
| W2 | Conflict audit: 21 rules vs CLAUDE.md (read-only) | Claude (this session) | `done` |
| W3 | Load the always-on rules in Claude Code without renumbering CLAUDE.md | unclaimed | `blocked` → unblocked by W2 |

W1 and W2 are independent. W3 waits on W2's table below.

---

## W2 — Conflict audit (COMPLETE)

**Read:** all 21 files in `.cursor/rules/` (845 lines), all 342 lines of `CLAUDE.md`,
and `.claude/settings.json`. Nothing was edited.

**Counts:** 21 rules — 19 `alwaysApply: true`, 2 glob-scoped.
10 skills, 767 lines, no helper scripts, all tracked in git.

### Table

| Rule | Lines | Always | CLAUDE.md covers it? | Verdict |
|---|---|---|---|---|
| `audit-vs-fix-router` | 67 | yes | **no** | MERGE — highest value. This is the verify agent. |
| `full-end-to-end-audit` | 108 | yes | §0 names its path | **ALREADY WORKS** — leave as-is |
| `agentic-audit-guardrails` | 70 | yes | partly (§5 cap, §11 key) | MERGE, trim restatements |
| `commas-catalog-hands-off` | 42 | yes | no | MERGE |
| `pulse-registry` | 31 | yes | no | MERGE |
| `redundancy-before-ui-polish` | 48 | yes | no | MERGE |
| `sim-assume-paid` | 27 | yes | no | MERGE |
| `three-step-repair` | 32 | yes | no | MERGE |
| `one-issue-per-thread` | 30 | yes | no | MERGE |
| `ux-guidance-urls-first` | 57 | yes | no | MERGE |
| `repo-hygiene-vc-router` | 33 | yes | no | MERGE (may self-solve once W1 lands) |
| `product-is-live` | 25 | yes | partly (§11 INNGEST) | MERGE |
| `live-playwright-100-before-manual` | 31 | yes | §6 item 4, vaguely | MERGE — see conflict B |
| `test-means-human-click` | 26 | yes | §6 item 4, vaguely | MERGE — see conflict B |
| `one-step-adhd` | 16 | yes | §10, partly | MERGE the extra |
| `secrets-env-law` | 43 | yes | **§11 Env law — heavily** | TRIM to the delta |
| `owner-scope-minimal-diff` | 41 | yes | **§8 — says so itself** | TRIM to the delta |
| `verify-scratch-only` | 22 | yes | **§12 — says so itself** | TRIM to the delta |
| `ui-standards` | 15 | glob | **§3 says the same thing** | TRIM to the delta |
| `audit-screenshot-markups` | 52 | glob | **§8 Annotated screenshots** | TRIM — see conflict A |
| `grok-no-displays` | 29 | yes | n/a | **DO NOT IMPORT** — about Grok sessions, inert in Claude Code |

### Contradictions — findings for Chris, NOT reconciled

Per CLAUDE.md §4, gaps are reported, not silently fixed. Five found.

**A. Screenshot marks: boxes or circles?**
CLAUDE.md §8 says draw **red boxes**, arrows when helpful.
`audit-screenshot-markups.mdc` says **numbered red circles + yellow arrows**.
Same deliverable, two different instructions. An agent obeying CLAUDE.md draws
the wrong shape. Needs one answer.

**B. Is a green Playwright run "done"?**
CLAUDE.md §6 item 4 says "Playwright check on any UI change" — that reads as
sufficient. Two owner laws say it is not:
- `live-playwright-100-before-manual` — must be **100/100 against the deployed
  site** (`fundhub.ai`, `apply.fundhub.ai`). The local harness does not count.
- `test-means-human-click` — after 100/100 the agent still walks the page in a
  browser like a person. A green suite alone is never a UI test.
As written, §6 is weaker than the law. An agent reading only CLAUDE.md ships on
a green script.

**C. The 5-agent cap lives in two places.**
CLAUDE.md §5 "Cap at 5 concurrent agents" and `agentic-audit-guardrails`
"Cap concurrent agents (~5)". Same number today. Two homes drift.

**D. `INNGEST_EVENT_KEY` stays on — stated three times.**
CLAUDE.md §11, `product-is-live.mdc`, `agentic-audit-guardrails.mdc`.
All agree today. Three homes for one law.

**E. `one-step-adhd` vs the required dumps.**
The rule bans multi-step dumps and writes an exception for CLAUDE.md §0's split.
No exception is written for §9's five-part task report, which is also a dump.
Harmless today; worth one line so a future agent does not "fix" it.

### Structural findings for W3

1. **Two rules are glob-scoped, not always-on** (`ui-standards` →
   `public/app/**`, `audit-screenshot-markups` → evidence folders). Importing
   them as always-on loads them on every turn including turns that never touch
   a screen. They belong in a path-scoped file or a skill, not the standing set.
2. **`grok-no-displays` must not be imported.** It governs Grok sessions in
   Cursor. In Claude Code it is dead weight that reads as a grant.
3. **`full-end-to-end-audit` already works in Claude Code** because §0 names its
   full path and tells the agent to follow it. It is the only rule that does.
   That path is the template for how the rest should be wired.
4. **Import count, after the above:** 16 rules, not 21.

---

## Change manifest — W2

Files read: `.cursor/rules/*.mdc` (21), `.cursor/skills/*/SKILL.md` (10, headers +
`fundhub-auditor` in full), `CLAUDE.md`, `.claude/settings.json`, `package.json`.
Files written: this board only.
Exports/props/routes/journeys touched: none.
