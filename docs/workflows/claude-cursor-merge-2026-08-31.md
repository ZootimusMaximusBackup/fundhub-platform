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
| W1 | Symlink the 10 `.cursor/skills/*` dirs into `.claude/skills/` | Claude (this session) | `done` |
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
| `grok-no-displays` | 29 | yes | n/a | **DO NOT IMPORT, DO NOT EDIT** — owner-set: out of scope |

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

---

## Owner decision — 2026-08-31: Claude does not click, full stop

**Owner-set, final.** Chris:

> "For Claude, I don't want you to go through and start clicking on things
> because you just take forever and it uses up a lot of resources. I'd rather
> have Grok do that, which is automated. Don't add the actual physical clicking
> like a person. Playwright is 100% fine. And you can test the code on each
> button, so you can see that it's firing, which you can assume is working."

### The bar for Claude on a UI change

1. Live Playwright, **100/100** against the deployed site. Unchanged — this
   still counts and still gates.
2. **Per-button fire check in code** — trace each control to its handler and
   show it fires. Seeing it fire is sufficient. Assume it works from there.
3. **No human click-through by Claude.** Not "agent walks the path in a
   browser," not a manual pass, not a person-like motion. Removed for Claude.

### Who owns the physical click pass

**Not Claude's concern.** Owner-set 2026-08-31: leave it out. Claude does not
perform it, does not schedule it, does not ask who will, and does not mention
it in a task report. The step simply is not in Claude's definition of done.

### This resolves conflict B

Conflict B asked whether a green Playwright run is "done." Answer: for Claude,
yes — Playwright 100/100 plus the per-button fire check. CLAUDE.md §6 item 4
gets the strict Playwright half written in, and does NOT get a human-click
requirement.

### W3 must amend these, not just import them

| File | What changes |
|---|---|
| `CLAUDE.md` §6 item 4 | "Playwright check on any UI change" → live 100/100 + per-button fire check. No Claude click pass. |
| `test-means-human-click.mdc` | Retitle/scope to Grok. Its core claim — "a green Playwright run alone does not count, the agent must click like a person" — is now **false for Claude**. Do not import as written. |
| `live-playwright-100-before-manual.mdc` | Drop "After that score... the agent still does the human click path" and the 2026-08-25 "agent walks it" override, for Claude. The 100/100 gate itself stays. |

### Conflict F — WITHDRAWN

Raised and closed the same day. Owner-set 2026-08-31: leave Grok out entirely.
`grok-no-displays.mdc` is not to be edited, imported, or reasoned about in this
migration. It stays exactly as it is, Cursor-only, untouched. No open question
remains here — do not re-raise it.


---

## W1 — Skills linked (COMPLETE)

`.claude/skills/` now holds 10 symlinks pointing at `../../.cursor/skills/<name>`.

Verified:
- All 10 resolve — `SKILL.md` readable through every new path.
- Git stores all 10 as **mode 120000** (symlink), not 100644 (copy).
  Total diff: 10 files, 10 insertions. One line per link, no content duplicated.
- Every skill's frontmatter carries `name` and `description`, and every declared
  `name` matches its directory. Claude Code can discover on all ten.
- `.cursor/` is byte-for-byte unchanged. `git status --porcelain .cursor/` is empty.
  Cursor keeps working exactly as before.
- `npm run lint` clean (1747 files).

**NOT yet proven:** Claude Code loads its skill list at session start, so this
session cannot see the links it just made. First proof is a **fresh** Claude Code
session in this repo — the ten `fundhub-*` skills should appear in its skill list.
Until someone opens that session, discovery is expected, not demonstrated.

**Branch also brought current with `main`** (was 53 behind). Merge was clean, no
conflicts. Conflict surface for this batch is two paths nothing else touches:
`.claude/skills/` (new) and this board file (new).

### Change manifest — W1

Files added: `.claude/skills/<10 names>` — symlinks only, no content.
Files modified: this board.
Code, config, routes, journeys, exports, props: none touched.
`.cursor/` : untouched.


---

## W1 — DISCOVERY PROVEN, 2026-08-31

Not "expected" any more. The ten skills appeared in a live Claude Code session
skill list minutes after the links were pushed:

fundhub-agent-tester · fundhub-auditor · fundhub-builder · fundhub-fixer ·
fundhub-orchestrator · fundhub-perf-auditor · fundhub-repo-hygiene ·
fundhub-system-map · fundhub-ui-auditor · fundhub-version-control

`.claude/workflows/avatar-builder.js` and `deep-research.js` load alongside them.

The board's earlier "NOT yet proven" note is superseded. W1 is done and observed.

---

## Owner decision — 2026-08-31: conflict A resolved

Chris, asked whether screenshot marks should be boxes or circles:

> "Draw around the object in question."

**The shape is not the rule. Enclosing the exact element is the rule.**

Box or circle, whichever fits the thing being marked — a wide toolbar wants a
box, a round avatar wants a circle. What is forbidden is marking *near* the
element, marking the surrounding chrome, or pointing with an arrow alone.
Draw around the object itself.

W3 writes this into both homes so they stop disagreeing:
- `CLAUDE.md` §8 currently says "red boxes" → becomes draw around the element.
- `audit-screenshot-markups.mdc` currently says "numbered red circles + yellow
  arrows" → same wording.

Everything else about marks is unchanged and still required: red, numbered when
there is more than one, legend line per mark burned into the PNG.

**Conflict A is closed. No open questions remain on this batch.**
