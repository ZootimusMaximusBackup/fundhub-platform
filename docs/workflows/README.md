# Workflow boards

A board is how parallel agents talk to each other (CLAUDE.md §0 and §5). One
board per batch. It holds the task list, who owns what, and the change manifests.

## Which board is live?

**The ones in this folder.** Finished boards move to `archive/`.

That is the whole rule, and it is deliberately not written down anywhere else.
A note saying "board X is the current one" is a fact that rots the moment it
stops being true — which is exactly how this folder got to 197 files that all
looked equally current, with no way for a fresh agent to tell which one to read.
The folder listing IS the answer, so it cannot disagree with itself.

## When you finish a batch

    git mv docs/workflows/<batch>.md docs/workflows/archive/

Do it in the last commit of the batch, the same way `-actual.md` journeys are
updated in the same commit as the code (§4). A board left here after its work
landed is the same lie as a stale journey.

## Archived on 2026-08-27

153 boards dated 2026-07-31 to 2026-08-24. Nothing was deleted — every file
moved with its history and is still readable under `archive/`. Boards from the
last three days were left here, and boards that were uncommitted at the time
(somebody's live work) were not touched at all.
