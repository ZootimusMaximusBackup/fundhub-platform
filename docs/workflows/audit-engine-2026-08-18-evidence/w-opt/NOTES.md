# W-OPT findings

Ground truth: journeys do not name optimize or letters (**MISSING**). Specialist desk says **Send letters** only when a letter body is ready, and nothing mails until that click. Chris’s 2026-08-18 order is the checklist.

## What broke

**The credit-file optimize machine is the wrong module.** `src/optimize/` changes ad budgets (ROAS, cost per lead, how often an ad shows). It does not read this client’s credit file. Ran it anyway. No rule fired. No spend ceiling exists for this work.

**Simulate did not make a letter pack.** There is no `letters_generated` table. That name is a pipeline stage, not a place letters are stored. Real letter table is `dispute_letters`. This client had **0** letter rows before we generated. Empty after simulate is a miss if the machine is supposed to ship a pack.

**The real letter builder cannot read the simulated file.** The stored CRS dump has four accounts, but not in the bureau-report shape the letter code wants (`bureaus.EX/EQ/TU` plus `sourceType`). So the builder found **zero** problems and made **zero** dispute letters. Only three how-to text pages. No HTML. No PDF letter.

**Those how-to pages do not name the four seeded accounts.** No Chase, no Amex, no Capital One, no Toyota. No lorem. The pack also did **not** invent collections or charge-offs — it just had no account letters at all.

**We did not mail. We did not save letters to the database.** Save-to-disk writes the `documents` table, not `letters_generated`, and it does not send paper. PostGrid was not called.

## W-TEAR

W-OPT left **no** new rows.

A later `documents` row on this client (`w-desks-ftc-audit.pdf`) is from W-DESKS, not this unit.

## Evidence

- `w-opt/proofs.json`
- `w-opt/03-optimize-output.json`
- `w-opt/02-before-query.json`
- `w-opt/05-designed-from-crs.json`
- `w-opt/06-designed-pack.json`
- `w-opt/07-content-check.json`
- `w-opt/samples/` (instruction text only)
