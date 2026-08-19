**COMPLIANCE REVIEW REQUIRED** — this branch touches dispute letters and credit-repair
behaviour. No customer-facing claim about credit outcomes was written or changed.

# T4 — Inquiry desk & dispute letters (wave 2)

## What was wrong, in plain words

**The Specialist desk never finished loading.** The page loads its data helper with an
instruction that means "run this after the page is built". But the code that uses the
helper ran *while* the page was still being built, checked for it, did not find it, and
quietly gave up. Nothing after that check ever ran. So the work queue said
"Loading inquiry queue…" forever, the four counters at the top stayed as dashes, and the
three bureau counts stayed at zero. No error appeared, because nothing had failed —
the page simply never asked.

**The Send button was broken.** It reached for a toolbox by the wrong name. Pressing it
threw an error, and the error text was printed into the button itself — which is the
"VIEW IS NOT DEFINED" the audit saw on screen. Nothing was ever mailed. Two other places
reached for the same wrong name, which is why every case row showed a raw status word and
a dash where the call state should be.

**Clearing an inquiry saved the change and then said it failed.** Two separate bugs did
this, on two different paths. In both cases the database was updated first and the failure
happened afterwards, so the specialist was told it did not work when it had. That is the
worst shape a save can have.

## How it was proven

Reproduced first, on the real site, before anything was changed:

- A signed-in walk of `https://fundhub.ai` as the Specialist on 2026-08-19 shows all four
  counters as dashes and the queue still saying "Loading inquiry queue…", with **no failed
  network request** — proof the page never asks.
- The Send crash was proven from the live page's own code **without pressing Send**, because
  pressing it would mail a real credit bureau.
- A read-only query against the live database recorded the true state of every other item.

Then fixed, and proven again:

- A browser test runs the old page and the new one through the same checks, with the data
  helper still loaded the slow way so the timing is real. **8 checks fail on the old page**
  (including the literal words "VIEW is not defined"); **all 10 pass on the new one.**
- Both save bugs have new tests that fail without the fix, against a real database. One
  fails with `invalid input value for enum inquiry_case_status: "Cleared"`; the other with
  `event name required`. Both pass after.

## Three items were already fixed — please do not re-file them

Checked read-only against the live production database:

- The six credit-dispute tables were reported as locked so the app could read nothing.
  They are **not locked** — the migration that unlocked them is applied on live.
- A dispute authorization was reported as never signed. **One exists.**
- The "inquiry removed" event was reported as never fired. **It has fired once.**

## What is deliberately NOT in this branch

- **The funding-round hop.** Finishing an inquiry is supposed to start the next funding
  round. The written journey for this role does not describe that step at all, so it was
  not invented. The event now fires correctly from all three paths; what happens next
  needs a decision and the money-chain thread.
- **Pressing Send on a live case.** That mails a real credit bureau. The crash that blocked
  it is fixed and proven in a browser; the live press is the owner's call.
- **Making the Repair desk show files.** Across the entire live database, **zero** clients
  have a repair card, which is why the desk is empty — it is telling the truth. The one
  line that would create them lives in a file this thread does not own; it is written up
  as a request on the board.

## Test position

Baseline measured on this branch point against a scratch PostgreSQL 16 database created for
this thread (never production, never `fundhub_ci`): **3 pre-existing failures**, none of them
in files T4 touches. This branch adds none — the same 3, before and after.

**A finding about the runner itself, which changes how everyone should read these numbers.**
`scripts/run-suite.mjs` runs the plain tests first and, at line 69, exits if any of them
failed — *before* it runs the database tests. Three plain tests already fail on `main`. So
`npm test` has never reached the 111 database test files, in this thread's baseline or in
anyone else's. Any failure count quoted from `npm test` on this branch describes the plain
half only. The database half was therefore measured separately; running it twice on identical
code gives slightly different results, so no single number should be treated as *the* count.
This is put on the fix board for the other threads.

`npx tsc --noEmit` is a no-op in this repository — there is no `tsconfig.json`; it is a plain
JavaScript codebase. It prints its version and exits 0. Reported here rather than claimed as a
passing typecheck. `npm run lint` genuinely passes: 1320 files parse clean.

## Evidence

Everything is under `docs/workflows/fix-2026-08-18/evidence/T4/`. Start with `README.md`,
then `STATUS.md` for the item-by-item verdict.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
