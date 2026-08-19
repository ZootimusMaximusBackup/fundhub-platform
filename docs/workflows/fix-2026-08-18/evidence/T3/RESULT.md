# T3 — what was fixed, and the proof for each item

**COMPLIANCE REVIEW REQUIRED** — consent capture and credit-pull type.

Step 1 (`REPRO.md`) re-walked every item live before anything was written. This file is step 2:
what changed, and the evidence per item. Test baseline and the correction to it: `BASELINE.md`.
Adversarial check of all five build units: `VERIFY.md`.

## Honest limit on the proof, stated up front

The fixes are **not deployed**. Deploys happen when Chris merges, and this thread must never run
`netlify deploy`. So the live site still shows the broken behaviour, and it will until merge.
What is proved here is: the broken state proved live before the change, and the fixed state proved
against a real Postgres and a real browser locally. The live re-proof belongs to the deploy preview
after merge. Nothing below claims a live green it did not get.

## Item by item

| Item | State | Proof |
|---|---|---|
| T3-01 · underwrite $0 on a funded seed | **FIXED** | Same seed, read exactly as `/api/read/underwrite` reads it: before `available []`, score 0, combined $0. After `available ["experian","equifax","transunion"]`, score 731, utilisation 17.44%, inquiries 7, combined **$939,500**, fundable true. Asserted in `underwriteiq.pg.test.mjs:256/271/274` |
| T3-02 · `scoreModels` never written | **FIXED** | Seed now writes top-level `scoreModels`; round-trips through the real `mergeBureauReports` |
| T3-03 · `result.bureaus[].scores[]` never written | **FIXED** | Seed now writes `result.bureaus` |
| T3-04 · six `custom_fields` counts never written | **FIXED** | Written via the existing `mergeCustomFields` helper. They are what moves the total from $412,500 to $939,500 |
| T3-05 · no `card_liabilities` row | **FIXED (worked around)** | 4 rows now land. Needed a workaround: `src/liabilities/index.mjs:65` omits `accountIdentifier`, so the seed carries `account_ref` too. **The real one-line fix is another thread's** — see blockers |
| T3-06 · tradeline ingest works | **STILL WORKS, not broken** | 4 tradelines, plus two things that were wrong and are now fixed: every APR was null, and `is_demo` was never set on tradelines despite a comment claiming it was |
| T3-07 · the DB test passes on a shape the live app never produces | **FIXED** | New test exercises the RAW seed with no emit step. Measured failing before the fix, passing after |
| T3-08 · engine correct on native inputs | **STILL WORKS** | `fixtures.test.mjs` 15/15 |
| T3-09 · all three buttons refuse, no consent | **HALF FIXED — say this plainly** | A signed consent contract now writes the consent row. But the pull still cannot succeed: it now fails at the SECOND gate instead of the first. See "the honest headline" below |
| T3-10 · signing writes no consent row | **FIXED** | `src/handlers/contract-consent.mjs`, gated on authorization subtype, revocation-safe, replay-safe |
| T3-11 · 422 "no identity on file" | **NOT FIXED — open owner decision** | Reproduced live on all three bureaus, not just Experian. The fix needs a decision Chris has not made yet |
| T3-12 · buttons look the same either way | **FIXED** | The panel now reads `GET /api/consent/capture` before offering the button. Proved: the screen fires that call now and did not before |
| T3-13 · no safe way to test a pull | **FIXED** | `simulate: true` replaces exactly one thing — the vendor call. Stamped in five places, invents no numbers, writes no outcome tier, fails closed on an unclear value |
| T3-14 · demo seed feeds nothing downstream | **FIXED** | Same root as T3-01 |
| T3-15 · funding letter will not generate | **DIAGNOSIS WAS WRONG — corrected** | `funding-letter-pdf.mjs` is not a renderer, it stores already-made files. The audit called the wrong function. The real cause was the missing `result.bureaus`, fixed in the seed; the letter pack now also reports the true reason instead of a bare "empty_pack" |
| T3-16 · closer dashboard shows dashes | **FIXED** | Before: **3 network calls, zero data reads.** After: **7 calls**, including deal-math, closer-call, tradelines and lender-matches. Measured in a real browser on pristine HEAD vs this branch — `ui/ui-before.json` vs `ui/ui-after.json` |
| CCP utilisation box | **FIXED, honestly** | Shows "not measured" when nothing measured it. It never shows 0 for unknown — a real bureau pull genuinely does not record utilisation, and pretending otherwise would be a made-up number |
| CCP dead buttons | **PARTLY** | GHL Contact deleted (GHL is cut over). Bank Inbox left alone — T8's. Raw Report **left disabled on purpose**: the data to link it is not on the wire, and an enabled button with nothing behind it is the exact failure the comment in that file exists to prevent |
| consent screen bounced to Pipeline | **ALREADY FIXED by T0** | Not re-fixed. `repro/03-consent-capture.png` |

## The honest headline Chris needs

**The bureau buttons still will not work after this merge.** There are two locks on that door, in
series. This thread fixed the first one. The second one — the client's identity — needs a decision
only Chris can make, and it is written up at the end of the task report. Anyone testing after merge
will see the error message change from "no soft-pull consent on file" to "no identity on file".
That is progress, and it is not a working button. Saying otherwise would be the exact "green badge
over a dead control" failure this batch exists to stop.

## Tests

Measured on my own scratch Postgres `fundhub_t3`, worktree `/tmp/wt-T3`.

```
baseline (origin/main c860b8c) : 5845 tests · 5842 pass · 3 fail
with T3                        : 5923 tests · 5920 pass · 3 fail
```

**+78 tests, all passing. The same three pre-existing failures, no new ones.** They are named and
attributed in `BASELINE.md` — one is T9's file, one is journey-generator drift already on `main`,
and one only fails because a local run connects as the database superuser.

The 109 database-test files never run under `npm test` (it exits at the first unit failure, and
`main` already has three). They were run by hand against this branch and against a pristine copy of
`main` on the same database, compared failure by failure: **zero failures appear on this branch that
do not also appear on `main`.**

`npx tsc --noEmit` is in the definition of done and **cannot pass in this repo** — there is no
`tsconfig.json`, so it type-checks nothing and exits 1 identically on untouched `main`.
