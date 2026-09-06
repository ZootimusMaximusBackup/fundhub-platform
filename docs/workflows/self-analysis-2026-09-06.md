# Self-analysis batch — 2026-09-06

Goal: inventory how this repo and Chris's week actually work, then design agents that
produce the week's marketing scripts in the background.

Owner: Chris. Consolidated output: `docs/ops/2026-09-06-self-analysis.md`.

## Task board

| Lane | Owns | Writes to | Status |
|---|---|---|---|
| A | Automations, scripts, hooks, crons, Actions, scheduled-run infrastructure | `docs/ops/_lanes/2026-09-06-lane-a.md` | done, correction pass running |
| B | Rule files, and rules that live only in chat | `docs/ops/_lanes/2026-09-06-lane-b.md` | done |
| C | 60 days of commits by area, recurring manual tasks, hours x repetition | `docs/ops/_lanes/2026-09-06-lane-c.md` | done |
| D | Current weekly output baseline (scripts, ads, features, marketing chat hours) | `docs/ops/_lanes/2026-09-06-lane-d.md` | done |

No dependencies between lanes. All four run at the same time.
Each lane writes only its own file. The board is written by the orchestrating session only.

## Phases

1. Inventory — the four lanes above. **done**, consolidated into `docs/ops/2026-09-06-self-analysis.md`
2. Workflow questions — one at a time, to Chris, until 95% confident. **running**
3. Design, back end first — state diagrams, hours saved, build effort, ranking. **pending**
4. Save — append to the doc, add new rules to CLAUDE.md, commit. **pending**

## Blockers and open questions

None yet.

## Change manifests

Filled in by each lane when it finishes.
