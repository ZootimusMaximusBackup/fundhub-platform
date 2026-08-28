# Outcome plays — first slice (2026-08-26)

Not a chat bot. Not “AI match.” Not a training job.

Over time we use saved bank yes / no to pick later plays. This page names the first slice only.

## What is true today

- Staff yes / no (Approved / Denied) already writes a row on `application_decisions`.
- The play **name** stamp on that row is a different job (four-builds B1 / named-build box 15).
- Sales “learn” in `src/ops/discoveries.mjs` is lead → book → show → deposit. It is not bank / file outcomes.
- Nothing later-play code could call to read those yes / no rows (including rows with no play name).

## This slice

Save is already the yes / no row. This slice is the read later plays import:

`src/plays/outcomes.mjs` → `listOutcomesForLaterPlays`

It returns bank, file (client), yes or no, when, and the play name if one was stamped.

No new table. No new screen. No new library. No model.

## Later (not this)

- Pick a named play / mold (named-build box 2).
- Train a model. Do not start that until Chris names it.

## Prove

Fund Horse file look only. A later play can read the saved American Express Denied rows.
