# T4 — every item, checked before it was touched

Rule followed: **reproduce before you fix.** Several items on this list turned out to
be already fixed, or fixed in code but not yet on the live site. Those are reported as
found, not quietly "fixed" a second time.

Proof sources used:
- **live page** — the real HTML `https://fundhub.ai` was serving on 2026-08-18 (`before/live-inquiry-remover.html`)
- **live db** — a read-only query run against the production database as the app's own
  unprivileged role (`before/live-db.json`). SELECT only.
- **browser** — the before/after browser run (`proof-inquiry-desk.mjs`, `before/walk.json`, `after/walk.json`)
- **postgres** — a scratch database with all migrations applied, never production

## The table

| # | What was reported | Verdict now | Proof | Fixed here? |
|---|---|---|---|---|
| T4-X1 | Send button says "VIEW IS NOT DEFINED" | **was broken** | live page: the name is read twice, never created; browser: fails with the literal words | **yes** |
| T4-08 | Inquiry Send crashes, nothing mailed | **was broken** — same single cause as X1 | browser before/after | **yes** |
| T4-11 | Repair Send is the same dead button | **was broken** — same single cause | browser before/after | **yes** |
| T4-02 | "Need me" tile shows a dash | **was broken** | browser: dash before, `2` after | **yes** |
| T4-03 | Work Queue spins on "Loading inquiry queue…" forever | **was broken** | browser: stuck before, 3 rows after | **yes** |
| T4-10 | Deferred script leaves the desk blank | **was broken** — this is the single root cause of 02, 03 and the chips | browser: the data helper was never called at all before the fix | **yes** |
| T4-12 | Marking an inquiry cleared writes a to-do, not a funding round | **still true** | live db: the to-do row exists, `funding_rounds` for the test client = **0** | **partly** — see below |
| T4-07 | "inquiry.removed has never fired" | **out of date** — it has fired **once**, and two of the three ways to fire it were broken | live db: 1 event row; both broken paths fixed and proven | **the firing, yes** |
| T4-04 | Cannot open a repair file — list is empty | **still true** | live db: **0** clients anywhere have a repair card | see Unit D |
| T4-13 | The Repair desk has no files in it | **still true**, and it is system-wide, not just demo data | live db: `optimization` pipeline cards = 0 | see Unit D |
| T4-05 | Stuck-files / bureau-confirm block never appears | **still true, but not for the reported reason** | it is hidden by **empty data, not by role** — the Specialist role passes the check cleanly | no — needs a writer that is not T4's |
| T4-06 | Inquiry SEND never pressed, so unproven | **still unproven on purpose** | pressing it mails a real credit bureau — a hard stop for this thread | no — see "what Chris must decide" |
| T4-01 | Dispute letter pack comes out empty for seeded clients | **still true** | the reader is correct for real files; the **simulator** writes the wrong shape | no — not T4's file |
| T4-14 | There is no credit-file optimizer | **confirmed** — `src/optimize/` is advertising spend, nothing to do with credit | every table it touches is an ads table | see Unit D |
| T4-15 | There is no table to store generated letters | **wrong as written** — the table exists (`dispute_letters`); it has no *writer* | the three write functions have no caller anywhere | see Unit D |
| T4-16 | A bureau's mailed reply cannot be recorded | **half already fixed** | the database lock is **gone on live** (see below); the remaining gap is that the function has no caller | no — not T4's file |
| T4-09 | Dispute authorization never captured; six tables locked | **both halves out of date** | live db: **1** authorization consent exists; all six tables now carry a policy and are readable | already fixed |

## The corrections that matter most

**The six credit-dispute tables are not locked any more.** The audit recorded them as
switched-on-with-no-key, so the app could read nothing. `db/migrations/200_dispute_rls_policies.sql`
fixed that, and the live database confirms it **is applied**. Reading as the app's own
role returns rows — `repair_decision_log` has 2 of them. Nothing for T4 to do.

**"No dispute letters exist" is not a permissions problem.** It is simpler and worse:
the only three functions that can write a dispute case, its items, or a letter are never
called by anything. The tables are empty because nothing has ever tried to fill them.

**The Repair desk being empty is honest.** A client only reaches that desk if they have a
card on the "optimization" track. Nothing in the live system has ever created one — the
count across the whole database is zero. The desk's "No repair files yet" message is
telling the truth.

**The funding-round hop is missing from the written journey.** Finishing an inquiry is
supposed to start the next funding round. `docs/journeys/role-inquiry-remover-intended.md`
does not describe that step at all. T4 did **not** invent it. What T4 fixed is the part
that was plainly broken: the event now fires from all three paths instead of one.
