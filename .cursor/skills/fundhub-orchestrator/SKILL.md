---
name: fundhub-orchestrator
description: Runs the full build-to-verified loop autonomously after plan approval. Triggers - build and verify, full loop, run it to done, orchestrate, ship it end to end.
---

# Fundhub Orchestrator

Wires the four protocols into one autonomous chain. Chris speaks exactly twice: "go" at the plan gate, and reviewing the final board. Everything between runs without him.

## The chain

1. **PLAN** — load fundhub-builder, run its Step 1 plan gate (all seven questions). STOP. Wait for "go." This stop is never skipped, never inferred, never satisfied by anything except Chris saying go in this session. If `scripts/gate-relay` is running, write that stop to `.fundhub-relay/gates/<id>.json` (decision-shaped question, options `GO` / `QUESTIONS`) and `node scripts/gate-relay/index.mjs wait <id>` so Chris can answer from his phone. Same for later OPEN-QUESTION / BLOCKED stops. The relay writes the decision file; it never edits app code.
2. **BUILD** — Builder executes under its own rules. Produces the screen, the `-intended.md`, four-state screenshots, control-click evidence, Lighthouse run.
3. **AUDIT** — dispatch a fresh subagent as fundhub-ui-auditor (and fundhub-perf-auditor if a page was created) against the LIVE deployed result. The build agent never audits its own work — different agent, fresh context, reads only the `-intended.md` and the standards.
4. **FIX** — findings from step 3 become tickets. Dispatch fundhub-fixer subagents, one ticket each, smallest diff, evidence per fix. OPEN-QUESTION and role-lens (§10) rows are NOT tickets — they queue for Chris.
5. **RE-VERIFY** — a fresh auditor subagent reproduces every FIXED row's original check with its own evidence. CONFIRMED-FIXED or REGRESSION.
6. **LOOP** — regressions and new findings go back to step 4. Loop until the board has zero open CRITICAL/HIGH rows, or a loop limit hits.
7. **PRESENT** — stop. One block: what was built, board state, evidence paths, the OPEN-QUESTION queue, anything BLOCKED. No success claims — the board is the claim.

## Hard limits (the trauma rules)

- **Two chances per ticket.** A fixer that fails twice marks BLOCKED and the loop moves on. No infinite retry.
- **Three loops max.** If the board isn't clean after three audit-fix-verify cycles, stop and present what's blocked. Something structural is wrong and grinding won't fix it.
- **Deploy gate:** the chain may commit and push to trigger the preview/prod build ONLY if the plan gate declared it and Chris's "go" covered it. Otherwise everything proves locally and the final block says "ready to ship, not shipped."
- **Never touched, ever, without an explicit line in the approved plan:** payments/Commas, live client records, GHL workflows, env/secrets, existing passing tests, anything with a real phone number or real email on the other end.
- **Budget guard:** if model usage in the session crosses ~80% of remaining quota, checkpoint the board and stop cleanly rather than dying mid-fix.
- **All subagents inherit READ-ONLY vs WRITE scope from their protocol.** Auditors never write app code. Fixers never touch files outside their ticket. Builder never audits itself.

## What still comes to Chris (by design, not limitation)

- The "go" at the plan gate.
- OPEN-QUESTION and §10 role-lens decisions.
- Approving the `-intended.md` as true ground truth (the system's honesty rests on this).
- Anything involving a live dollar, a live client, or a live phone call.

## Invocation

"Build X and run it to done" → full chain. "Run the loop on the existing board" → starts at step 4 against a named board. Either way, the final output is a board and evidence folders, never a paragraph saying it worked. (build and verify / full loop / run it to done / ship it end to end → load fundhub-orchestrator.)
