# Company Audit — Finance OS W1–W10

**Date:** 2026-07-31
**Branch:** `claude/finance-os-audit-w1-w10-7jkl5x`
**Baseline compared against:** `4830465`
**Scope:** the eleven commits that landed Finance OS workflows W1–W10, migrations 075–089, and the two new screens.

This report is written to be read by someone who does not read code. Technical terms are explained where they appear.

---

## 1. Executive Summary

The eleven commits broke nothing. Every test that failed before them still fails, the same 24 of them, with the same names. No test that used to pass now fails. On top of that the work added 695 passing tests. That part is genuinely good news and it was checked hard — see section 2.

What the audit found is a different problem: the code is safe against itself and unsafe against the future.

Three things stand out.

**One. There is no wall between companies.** Every table records which company owns each row. Every signed-in request already knows which company the person works for. Almost no staff-facing read endpoint compared the two. Today the database holds exactly one company, so nothing leaks. The day a second company is added — an insert, not a code change — an employee of company A can read company B's consumers' credit limits, balances, interest rates and bank data. Nothing in this repository fails when that day arrives. This is finding C1 and it is the reason the audit is not a pass.

**Two. Ten of the ten workflows are built; roughly half cannot be reached by a human.** Thirteen modules across W2, W4, W5, W6, W7 and W8 have no production caller at all. Subscriptions, card liabilities, bank links, recurring bills, cash-flow projections, reminders and alerts have no route and no screen. An owner switching an alert rule on gets nothing, ever. This is not a crash; it is a reporting gap. Ten features look delivered and about four are usable.

**Three. Two live screens showed numbers that were not real.** The Banking Surface screen has no data source — nothing anywhere writes bank accounts — and it left a hard-coded sample block reading "Personal 2,400.00" and "Unclassified 9,000.00" on screen under a named client's name. It also added credit-card headroom into the same total as cash. Both are fixed.

**Counts.** 1 critical, 21 major, 18 minor, 10 compliance items requiring human legal review.

**Fixes applied.** 22 findings were fixed and committed on this branch, covering the critical finding and all 21 majors, plus five minors. 31 `[AUDIT FIX]` commits are on the branch. Nothing was pushed to `main`.

**Verdict.** NOT READY for a second company or for a consumer-facing launch. CONDITIONAL for continued single-company internal use. The shortest path to ready is in section 8.

---

## 2. Priority Zero — Test Regression Verdict

**Verdict: ZERO REGRESSIONS. The eleven commits introduced no new test failures and fixed none.**

Two earlier agents disagreed on this. Agent A said no regressions. Agent B said 13 regressions. Agent A is correct, and Agent B's number is a counting error, not a different result.

**How it was checked.** Two separate real Postgres databases, one per tree, in two separate checkouts, so the shared working copy was never touched. Four full test runs per tree, not two, because the first pair looked unstable.

- Baseline `4830465` → 50 migrations → failures: 24, 24, 25, 24
- `origin/main` `d6a5f94` → 66 migrations → failures: 40, 24, 25, 24

Deterministic failures on both trees: **exactly 24**. The two sets were compared by test name, not by count: 24 shared, 0 baseline-only, 0 main-only.

**Why Agent B saw 41 and 28.** Node's test output is nested. When a child test fails it prints a failure line, and its parent group prints a second failure line for the same problem. When a whole group is abandoned, every test inside it prints a failure line too, marked "cancelled by parent". Counting raw failure lines therefore counts the same problem several times. The arithmetic matches Agent B's numbers exactly:

- baseline: 24 real + 4 parent roll-up lines = 28 (B reported 28)
- main: 24 real + 12 cancelled-children + 5 roll-up lines = 41 (B reported 41)

B's "13 regressions" is 41 minus 28. It is subtraction on two inflated totals, not a comparison of test names. No test name is main-only.

B also ran main once, on a brand-new database, and caught a real but intermittent problem (below). Running it again collapses it back to 24.

**The flake, named.** One error, one cause: `insert or update on table "sessions" violates foreign key constraint "sessions_staff_id_fkey"`. Test files run at the same time against one shared database. A suite that deletes staff rows pulls the ground out from under any suite that is building a login at that moment. It hit `conversations-read` (16 tests) on one run and `campaign-endpoints` (the suite plus 12 cancelled children) on another. `git diff 4830465 origin/main` shows `conversations-read.pg.test.mjs`, `campaign-endpoints.pg.test.mjs` and `hiring.pg.test.mjs` are **byte-identical between the two trees**. A file that did not change cannot be a regression caused by the change.

A separate flake, `src/hiring/hiring.pg.test.mjs :: scores cannot be deleted — they are the audit trail`, failed 1 run in 4 on **both** trees. Same flake both sides, not a regression.

**Correction to the documented trap.** `CLAUDE.md` §12 predicts ~29 failures on a fresh database dropping to ~24, blamed on five order-dependent `inquiries` suites. The 24-versus-29 shape is right; the cause is stale. Across all 8 runs, **zero** `inquiries` tests failed. The extra failures on a cold run now come from the sessions/staff race above. §12 should be corrected.

**Also worth recording:** main adds 695 passing tests (2,342 → 3,037) and grows from 83 test suites to 128.

---

## 3. Audit Scorecard

Verdict rules: **FAIL** = at least one critical or major finding in that area. **WARN** = minor findings only. **PASS** = nothing found. **NOT ASSESSED** = the check was not run.

| Domain | Verdict | Critical | Major | Minor | Notes |
|---|---|---|---|---|---|
| Regression vs baseline | PASS | 0 | 0 | 0 | 24 pre-existing failures, identical by name on both trees. |
| Security / Auth | FAIL | 1 | 4 | 2 | The whole-company boundary (C1) plus four gate failures. All fixed on this branch; ten endpoints from C1's list remain open. |
| Testing / Reliability | FAIL | 0 | 4 | 3 | Two concurrency bugs proven against real Postgres; two brand-new live endpoints had zero tests. |
| Schema / Data Integrity | FAIL | 0 | 2 | 3 | A cancelled client could never re-subscribe; two tables had no enforced link to bank accounts, refused on a stated reason that was false. |
| Business Logic | FAIL | 0 | 2 | 2 | Cash and credit-card headroom added into one total; an overdrawn flag that inverted on cards. |
| Seams / Dead Code | FAIL | 0 | 4 | 5 | Thirteen modules with no production caller. The alerts feature had no storage layer at all. |
| UI / UX | FAIL | 0 | 2 | 3 | Two screens registered but unlinked and with no way out; a bank screen gated to every staff role. |
| Operational Readiness | FAIL | 0 | 2 | 0 | The health check could not report a database that was behind; no monitoring, no alerting, no runbook, no CI. |
| Performance | FAIL | 0 | 1 | 1 | An unbounded, unindexed listing that reads and sorts the whole table. |
| Compliance | FAIL | — | — | — | 10 open items. None are code defects to fix; all need a human with legal authority. See section 5. |
| Spec consistency | NOT ASSESSED | — | — | — | The `/workspace/fundhub-docs` spec comparison was skipped. See Open Decisions. |

---

## 4. Findings

Ranked most severe first. `file:line` points at the place to look.

### CRITICAL

---

#### C1 · Any signed-in employee can read every other company's clients, credit files and bank balances
**`src/tradelines/store.mjs:84`** · Security / Auth · **PARTIALLY FIXED — commit `b4e8ddb`**

**What is wrong.** Every table records which company owns each row, and every request already knows which company the signed-in person works for. Not one staff-facing read endpoint compared the two.

**Failure scenario.** Call `GET /api/read/documents` with no client id. It returns rows for every company, each carrying a client id. Feed any of those ids to `GET /api/read/tradelines?client_id=…`, whose query is `WHERE client_id = $1` with no company check, and you get that consumer's credit limits, balances and interest rates. Repeat against `/api/read/banking-surface` and `/api/read/finance-os`.

**Live or latent.** Latent. `db/schema/001_init.sql:36` seeds exactly one company. It becomes live on an INSERT, not a code change, so nothing in this repository fails at the moment it starts leaking.

**Fix.** The company id is now a required input on the tradeline read; leaving it out raises an error instead of quietly reading everyone, and the query matches on it. Both callers (`api/read/tradelines.mjs`, `api/read/finance-os.mjs`) pass it from the signed-in session, never from the web address. New test `src/tradelines/store.tenancy.test.mjs` (3 tests, no database needed) fails on the old code and passes on the new.

**Still open — important.** The same missing check remains on ten endpoints from the finding's own list: `api/read/staff.mjs:18`, `invoices.mjs:18`, `documents.mjs:23`, `funding-rounds.mjs:16`, `inquiries.mjs:27`, `commissions.mjs:19`, `message-templates.mjs:16`, `failed-events.mjs:18`, `entitlements.mjs:33`, `conversations.mjs:52`. Each builds its own query. `api/read/banking-surface.mjs:71` was closed separately under M15. Until the remaining ten are closed, C1 is not fully remediated.

### MAJOR

---

#### M1 · Whole client book and per-client PII open to every staff role, including outside white-label partners
**`api/dashboard/clients.mjs:37`** (also `api/dashboard/client.mjs:24-60`) · Security / Auth · **FIXED — `e7e9cf5`**

**What is wrong.** Neither dashboard handler checked the person's role, only "are you signed in".

**Failure scenario.** A staff row with `role='partner'` — an outside white-label operator — gets every client's name, email, phone and funded amount, then a full single-client record including message bodies and consent flags.

**Fix.** Both now call the gate that already existed and was never used: `ROLE_SETS.STAFF` (`src/http/read-api.mjs:103`), which excludes `partner` and denies unrecognised roles. The `DASHBOARD_SECRET` path is preserved. Test `src/http/dashboard-role-gate.test.mjs` runs the real handler against a stubbed database: before, a partner got 200 with the phone number and consent flags; after, 403. All six staff roles still get 200.

**Not fixed:** `api/dashboard/pipeline.mjs:57` has the identical gap and was outside the finding. `api/dashboard/seed.mjs` uses the same bare gate and it writes rows.

---

#### M2 · The dashboard master secret is accepted from the web address
**`src/http/dashboard-auth.mjs:27`** (also `public/dashboard.html:249`) · Security / Auth · **FIXED — `bc184aa`**

**What is wrong.** A never-expiring, non-revocable, non-attributable shared secret could travel as `?key=…`. The same repository forbids exactly this for ordinary login tokens, in writing, at `src/http/middleware/requireAuth.mjs:22-23`.

**Failure scenario.** The key lands in browser history, in bookmarks, in any shared link, and in the "where did you come from" header sent to outside sites. Anyone who obtains it has permanent access to every client's name, email, phone, message history and consent flags, and nothing records who used it.

**Fix.** The query-string path is removed. The page asks for the key once and holds it for that browser tab only, and forgets a rejected key so a refresh asks again. `DEPLOY.md` no longer tells operators to paste the key into the address bar. New test `src/http/dashboard-secret-in-url.test.mjs` failed 7 of 12 assertions before, passes 12 of 12 after.

**One existing test was inverted, deliberately:** `src/http/dashboard-auth.test.mjs:43` asserted the key MUST be accepted from the address bar — it encoded the defect. The assertion was flipped with a comment, not deleted.

**Risk to communicate:** anyone holding a `?key=…` bookmark will now be asked for the key instead of loading straight in.

---

#### M3 · Three read endpoints always serve the first company, whoever is asking
**`api/read/products.mjs:19`** (also `api/read/agents.mjs:20`, `api/read/affiliates.mjs:18`) · Security / Auth · **FIXED — `25d51af`**

**What is wrong.** They filtered by company, but against a hard-coded "default company" lookup rather than the caller's own.

**Failure scenario.** Once a second company exists, its staff see company A's affiliate roster and none of their own. It is reported as "my list is empty" — which is not the symptom that matters.

**Fix.** The caller's session company is bound as a parameter. If a session somehow carries no company, the query matches no rows: an empty list, never the whole table and never the default company's list. Test `src/http/read-org-scope.test.mjs` runs without a database on purpose, because this defect is invisible on a one-company database and a database-backed test would have skipped in exactly the runs that needed to catch it.

**Not fixed:** `api/read/partners.mjs` (~line 35) has the same pattern and was outside the finding.

---

#### M4 · An employee can order a credit check on another company's client, filed under the wrong company
**`api/finance/soft-pull.mjs:136`** · Security / Auth · **FIXED — `a01bfd7`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** The comment says staff may act on any client "in their org"; the code returned true for any staff member without ever comparing companies. The write then stamps the caller's company onto the row (lines 91-93).

**Failure scenario.** A credit pull is ordered on a consumer belonging to company B, by company A which has no relationship with that person and therefore no consent on file. The record lands in company A's compliance ledger; company B has no record at all.

**Fix.** The client is now looked up against the caller's company before both the order and the history read, and a staff session with no company is refused rather than falling through. Five new cases in `src/http/finance-soft-pull.pg.test.mjs`; 4 of 5 failed before the fix, all 26 in the file pass after.

**Not verified:** whether rows already written in production sit under the wrong company. The fix stops new ones; it does not clean up old ones.

---

#### M5 · Two taps on "pull credit" create two ledger rows and two charges — PROVEN
**`src/finance/soft-pulls.mjs:212`** · Testing / Reliability · **FIXED — `2283246`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** The guard reads, then writes, with a gap in between. Two callers can both finish reading before either writes.

**Failure scenario.** Reproduced against real Postgres: three simultaneous calls all succeeded — three ledger rows, 4,500 cents billed instead of 1,500. The route is live at `netlify/functions/api.mjs:187`. One question about a person's credit, recorded three times and charged three times.

**Fix.** New migration `db/migrations/090_soft_pull_one_open_per_client.sql` adds a unique index allowing one open pull per client, and the insert now yields to a winner and re-reads instead of writing a second row. The migration **closes** duplicate open rows created by earlier races (status `cancelled`, with a stated reason) — it deletes nothing, so the audit trail survives. Two new tests reproduce the race on connections opened *before* the race starts; using the shared pool did not reproduce it, which is why it survived review.

**Still open:** migration 090 has not been applied to production. Nothing is fixed there until it is.

---

#### M6 · The retry-safety key turns a retry into a server error — PROVEN
**`src/finance/soft-pulls.mjs:200`** · Testing / Reliability · **FIXED — `ac2bd5e` (content in `010e473`)** · COMPLIANCE REVIEW REQUIRED

**What is wrong (as reported).** Same read-then-write gap, but here the database does enforce uniqueness, so the second write raised a duplicate-key error that nothing caught (it is not in `CLIENT_DATA_ERRORS`, `src/http/read-api.mjs:45-50`), and `netlify/functions/api.mjs:334` returned a 500. Twelve of twelve concurrent runs failed. The existing test at `src/finance/soft-pulls.pg.test.mjs:368` replays sequentially and never reaches the branch.

**Status of the reported symptom.** Already closed by the M5 fix (`2283246`). Re-proved absent across four concurrency shapes: no rejections, one row, no duplicate-key error.

**A worse bug found in the same guard, and fixed.** The uniqueness index is keyed on (company, retry key) — **the client is not in it**. The existing race test used one key AND one client, so the retry key's own behaviour was never isolated. Racing two *different* clients under one key: both callers were handed the same row. The caller asking about client Y received client X's soft-pull request — who asked for X's credit to be pulled, why, and what it cost — while Y's request was never written and the caller was told everything was fine. It reproduces sequentially too, so it is not race-only. In plain words: two people's credit-check requests could get crossed, one person's request would vanish, and the screen would show someone else's record.

**Fix.** A reused retry key whose stored row belongs to a different client is now refused with a 409 the endpoint already knows how to convert, so it can never reach the 500 path. Two new tests fail before and pass after.

**Commit caveat.** The code and tests are physically in `010e473`; a parallel workflow staged the whole tree while this fix was mid-flight and swept both files into its own commit. `ac2bd5e` is an empty commit carrying the correct message and evidence. History was not rewritten, because other agents' work was in the same commits.

---

#### M7 · The all-or-nothing protection on three critical writes does nothing in production
**`src/inquiries/work.mjs:214`** (also `src/banking/store.mjs:70`) · Testing / Reliability · **FIXED — code `4289b27`, test `42ba6af`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** The check `if (typeof db.connect !== "function") return fn(db)` is always true, because the production database handle (`src/db.mjs:32`) is `{ query }` only. So the "all of these writes succeed or none of them do" protection was switched off everywhere it mattered.

**Failure scenario.** Live: a dispute-attempt row commits while the counter update fails, so the screen shows two attempts and the audit table holds three, on a consumer's credit-dispute record. Latent: saving a detection deletes a bill's supporting charges and then fails to insert, leaving a bill asserting a monthly charge with nothing behind it.

**Fix.** The probe now falls back to acquiring a dedicated connection from the shared pool. A working version already existed at `src/finance/soft-pulls.mjs:484-489`. Two regression tests pass the *real* exported handle and point the database at a dead port, so the unprotected path cannot pass silently. Both were proven to fail against the pre-fix code, showing the exact three unprotected statements.

**Why it survived review:** the existing tests stub a fake handle that *does* have `connect()`, so they always took the protected branch and could never exercise the choice. That is minor finding m9.

**Left open on purpose:** the fourth copy of this bug, `src/pii/index.mjs:200`, is compliance item K1 and was not touched.

---

#### M8 · Banking Surface is live, has no data source, and left invented dollar figures on screen
**`public/app/banking-surface.html:183`** (also `api/read/banking-surface.mjs:71`) · Business Logic / UI / Seams · **FIXED — `7942271` then `3e83cfd`**

**What is wrong.** Nothing anywhere writes bank accounts — zero inserts outside tests, and the Plaid account reader returns "not implemented" — so every real client returns zero accounts. The screen returned early *before* writing to the page, leaving the hard-coded sample block at lines 84-92 showing "Personal 2,400.00" and "Unclassified 9,000.00" under a named client. The only contradiction was an 11-pixel banner at the bottom.

**Failure scenario.** A staff member opens a real client, sees $11,400 of bank balances that do not exist, and repeats them to the client.

**Fix.** Three paths were still broken after the first partial fix: the empty-result early return, any failed read (403 when Plaid is unconfigured, 400 on a stale id, 503, offline), and the window between page load and the read finishing. Once a client id is in the address, the sample block is replaced immediately with a neutral loading state; empty results say "No bank accounts on file for this client"; a failed read clears the fabricated money and says why. Test `src/http/banking-surface-screen.test.mjs` runs the page's own script in a sandbox: 5 of 10 failed before, 10 of 10 pass after. With no client named, the sample block and its "sample" label deliberately remain.

**Contrast:** `finance-os.html` does not have this bug, because `src/finance/os-grid.mjs:171` always returns seven rows.

---

#### M9 · Banking Surface was switched on for every staff role although bank connections were never approved
**`api/read/banking-surface.mjs:58`** (also `public/app/shell.js:24`) · UI/UX + Compliance-adjacent · **FIXED — `e0ecb11`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** A readiness check exists (`src/banking/plaid.mjs`, `isPlaidEnabled`, `REQUIRED_ENV` at line 60) and nothing in production called it — zero hits across `api/` and `src/`. The screen was also open to every staff role.

**Failure scenario.** Plaid gets switched on for one test client. The screen silently starts serving real bank balances to every staff role — closer, setter, inquiry specialist, funding advisor — with no second approval. The SOC 2 sign-off is still open (`docs/workflows/finish-the-build/W5.md:283`).

**Fix.** The readiness check landed in `7942271`. The role gate moved from every staff role to owner/admin only, and the screen moved into an owner/admin-only list in the app shell. Both conditions must now hold. Test `src/http/banking-surface-gate.test.mjs`: 14 tests, 8 red before, all green after, including that an owner is still refused when Plaid is unconfigured.

**Deliberate reversal, flagged:** the endpoint's own header argued for the wider gate ("splitting the gate would leave a closer able to see the client's cards but not their cash"). That argument was overridden and the comment rewritten to say why. If the owner disagrees, it is a one-word change back.

---

#### M10 · Banking Surface added credit-card headroom and card debt into the same total as cash
**`src/finance/banking-surface.mjs:144`** (flag at line 114) · Business Logic · **FIXED — `7942271` then `0003e5b`**

**What is wrong.** Totals summed every open account with no account-type filter. `db/migrations/081_bank_accounts.sql:85-87` states that the balance column means different things for a card ("remaining headroom") than for a chequing account ("spendable now"), and line 71 warns against exactly this.

**Failure scenario.** $2,000 in chequing plus a Visa with $9,000 owed on a $10,000 limit reported $11,000 available. The same $1,000 of headroom was also counted in the Finance OS grid, so one dollar appeared twice on two live screens. Separately, the red "overdrawn" mark was backwards on cards: a card maxed out at $10,000 owed showed as +10,000 and got no warning, while an *overpaid* card showed as -500 and was painted red. The screen warned about the healthiest card and stayed silent about the worst one.

**Fix.** Totals now count only chequing/savings accounts. The overdrawn flag is true/false only on a deposit account; on a card, loan, investment or unknown type it is "not established" rather than false, so no card row is painted red. Four new tests, two of which failed before the fix.

**Not fixed, written down:** an account whose type the bank never reported is dropped from the group totals silently and does not count toward the "unknown" tally, so a group can report a total as complete when it is a floor. Introduced by the earlier partial fix; a different defect from this one.

---

#### M11 · Bills saved to the database cannot be read back by the projector, and no test crossed that line
**`src/banking/store.mjs:232`** (also `src/banking/cashflow-seam.mjs:141`, `src/banking/cashflow-seam.test.mjs:66`) · Testing + Seams · **FIXED — `f6bfb46` then `d023a07`**

**What is wrong.** The storage layer returned raw database rows with underscore names; the consumer reads camel-case names, and one field is renamed outright (`next_expected_on` in the database versus `nextExpectedDate` in code). All 21 seam tests built their input by hand or from a live in-memory detector result. No test called the store and fed the result to the projector.

**Failure scenario.** The first person to wire these two together gets silence, not an error: every bill returns "no confident date", every id renders `undefined:undefined:monthly`, every confidence is "not a number". The screen shows a client with no bills at all.

**Fix.** A translation function was added, and then the crossing test found a second live break: the database returns dates as date objects set to local midnight, so a bill's dates did not survive the round trip. They compared unequal to what was saved, showed up in responses as `2026-05-08T00:00:00.000Z` instead of `2026-05-08`, and rendered as **the day before** for anyone east of Greenwich — a client in Tokyo would be shown every bill one day early. Four fast tests plus one real-Postgres test now cross the seam; the row is built by the writer, so the test cannot model a schema we wish we had.

**Still open, recorded not built:** there is no entry point that splits the store's flat list into the two groups the projector expects. Whoever wires the screen must not pass low-confidence guesses in as confident bills.

---

#### M12 · The real billing day is computed then thrown away, and a test locked the omission in
**`src/banking/recurring.mjs:1138`** · Seams + Testing · **FIXED — `f6bfb46`**

**What is wrong.** The detector works out the true billing day and its own comment (lines 1082-1090) says it cannot be recovered afterwards, because a bill on the 31st clamps to the 30th in a short month. The row-building function returned 16 fields and this was not one; the field name appeared in zero files, including every `.sql` file. A unit test asserted the exact 16-field set, so adding it would have broken a green test.

**Failure scenario.** Rent charged on the 31st, saved and read back, is pinned to the 30th forever — the exact bug the seam comments say a month-end test already caught in memory.

**Fix.** The field is now written and read, migration `091_recurring_bill_anchor_day.sql` adds the column with range checks, and the exact-field-set test now asserts 17 fields including it, plus a case pinning the 31st. Proved end to end: a bill on the 31st now projects 06-30, 07-31, 08-31, 09-30, 10-31, 11-30, 12-31. With the field removed it collapses to the 30th every month. Deleting the two mapping lines makes three tests fail, so the guard is real.

**To confirm:** migration 091 must be applied to any real database or the round-trip test will fail there.

---

#### M13 · The alerts feature shipped with two tables, four rules, no storage layer and no caller
**`src/alerts/evaluate.mjs:295`** · Seams + Testing · **FIXED — `3e40f61`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** `src/alerts/` had two files and no store, unlike seven other areas of this repository. Zero queries against the alerts table anywhere. Zero imports from outside the folder.

**Failure scenario.** An owner switches a rule on and gets nothing, ever. The feature looks configurable while being completely inert. The rules themselves are excellently tested — 57 tests, 99.58% line coverage — there was simply nothing past them to test.

**Fix.** A 621-line storage layer was added: it reads the company's switched-on rules, runs the existing rules against a client's data, writes alert rows, reads them back, and lets a person acknowledge, resolve or dismiss one. The rules and tables were not changed. 26 tests without a database, 22 against real Postgres, all written first and confirmed failing.

**Two silent-failure cases the tests now pin:** a rule switched on with no threshold set must refuse to fire rather than quietly using a default (that is the entire reason the rules ship blank), and an unknown value never raises an alert — a card the system cannot read is not proof a client is over the line and not proof they are under it.

**Still open:** there is still no route and no screen, so a person still cannot see these alerts. That was left deliberately rather than inventing a step nobody asked for. The alerts table has no "dismissed by" or "dismissed at" column, so who dismissed an alert cannot be recorded.

**Contrast:** migration 087 shipped with its store and a 598-line database test. This one did not.

---

#### M14 · Totalling hours from raw shift records throws instead of returning a number
**`src/shifts/timesheet.mjs:182`** · Seams · **FIXED — `756fcb9`**

**What is wrong.** The per-shift function throws in six cases, including whenever a shift was auto-closed with no evidence — that is, whenever someone forgot to clock out. The throw propagates up through the totalling functions with nothing catching it.

**Failure scenario.** Any future payroll screen that totals hours straight from the shifts table errors out for a whole week because of one forgotten clock-out. Blast radius today is nil: nothing in production imports it.

**Fix.** The totalling function now separates those rows out and estimates them exactly as the existing timesheet function already did, and returns the same payable figure, so the two can never disagree. Four new tests; three failed before. One existing test was retargeted, not weakened: a single unvouchable row on its own still throws, because one row has no other shift of that person's to infer from.

**Flag for a human:** inferred time for a forgotten clock-out now flows into the plain "hours worked" total by default, where before it stopped the total dead. That widens the reach of the wage-inference policy recorded as compliance item K8, which was merged with its flag still open.

---

#### M15 · The two brand-new endpoints had zero tests
**`api/read/finance-os.mjs:33`** and **`api/read/banking-surface.mjs`** · Testing · **FIXED — `04c3453`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** Both are live in the route map (`netlify/functions/api.mjs:131` and `:139`). Searching found only the router itself and two manual smoke scripts needing a hand-typed id and a running server. Untested: the wrong-method response, a malformed id, the role gate, and error mapping. In Banking Surface, the column list at lines 45-51 is the only thing standing between a read endpoint and the encrypted bank token one join away, and nothing asserted it.

**Failure scenario, found by writing the tests.** Banking Surface looked accounts up by client id **only**. Every row records its owning company and the session knows the caller's company; the two were never compared. An owner or admin at company A who knew or guessed a client id at company B got that person's bank balances. This is the same hole as C1, still live on this endpoint.

**Fix.** Two lines of SQL close the leak, using the company from the session and never from the web address. 26 tests now pin both endpoints: wrong method is refused before any database work, no sign-in is refused, the role gate denies by default, a missing or malformed id is refused before Postgres is touched, a bad-parameter error becomes a client error while a genuine database fault is still raised, and the query still names its columns and mentions none of the token or account-number fields. With the old SQL, exactly one case fails.

---

#### M16 · A client who cancels can never sign up again
**`db/migrations/075_subscriptions.sql:237`** (also `src/subscriptions/store.mjs:281`) · Schema / Data Integrity · **FIXED — code `010e473`, test + follow-ons `b61ca33`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** Cancelling left the end date empty, so the cancelled row's date range stayed open. The rule that stops two subscriptions overlapping looks at dates, not status, so it blocked every future signup.

**Failure scenario.** Reproduced live: the second signup fails with a raw database constraint name. No handler for that error code existed anywhere in `src/`, `api/` or `netlify/`, so the person would see a message naming a database constraint.

**Fix, three parts.** The date fix was already on the branch but had no test; the test was written and confirmed to fail against the old code with the exact reported error. The raw constraint error is now caught and replaced with "this client already has a subscription covering that date — cancel or close the current one first"; nothing that was refused before is now allowed. A third defect introduced by the earlier fix was found and closed: cancelling twice reported "no such subscription" for a subscription sitting right there.

**One existing test was corrected, not weakened:** it asserted the end date stays empty after cancelling, which is the assertion that encoded the defect, and it was already failing on this branch.

**Fee-timing question left open — see Open Decisions.**

---

#### M17 · Bank transactions and detected bills had no enforced link to bank accounts, on a stated reason that is false
**`db/migrations/085_bank_transactions.sql:181`** (also `086_recurring_bills.sql:208`) · Schema / Data Integrity · **FIXED — `74a92ea`** · COMPLIANCE REVIEW REQUIRED

**What is wrong.** The comment at `085:99-124` refuses the link because the bank accounts table "DOES NOT EXIST IN THIS REPOSITORY TODAY". `081_bank_accounts.sql:34` creates it, and 081 sorts before 085, so it already existed when 085 ran. Migration 086 then refused the same link by citing 085's reason instead of re-checking it.

**Failure scenario.** Reproduced: delete a bank login — which is what happens when a client withdraws consent — the accounts cascade away, and the transaction and bill rows survive pointing at nothing. A wholly invented account id is also accepted with no error. The bills listing filters only on company, so the projector would price payments against a disconnected account.

**Fix.** New migration `092_bank_account_fk.sql` adds both links. Nothing is deleted: each link is added unvalidated and then validated only when the orphan count is zero, so a database with orphans applies the migration, reports the count in a warning, and leaves the row for a person to resolve. Five new tests: 4 failed before, all 5 pass after. Existing test fixtures that used four account ids existing nowhere — only possible because the link was missing — now insert real rows. No assertion was changed.

**Compliance consequence, flagged:** with the link in place, a client withdrawing bank consent now also removes that account's transaction ledger and detected bills, where before those rows survived. That is a retention decision on consumer financial data and needs human legal sign-off before production.

---

#### M18 · The health check reports "up" no matter how far behind the database is
**`src/http/health.mjs:81`** · Operational Readiness · **FIXED — `584a7d7`**

**What is wrong.** It counted migration rows and reported healthy whenever the query succeeded, never comparing against what should have been applied. `netlify.toml:7` sets the build command to an `echo`, so the deploy does not run migrations, and there is no CI to run them either.

**Failure scenario.** Deploy while production is at migration 074. Health returns 200 and "up", the app shell prints "LIVE — 51 migrations applied", and every Finance OS screen fails on a missing table.

**Fix.** Health now asks the database for the *names* of applied migrations and compares them against a generated, checked-in list of all 69 files. Missing anything gives state "behind" with expected and pending counts and a plain message. No file names are included, because the health page needs no login. A checked-in list rather than a folder scan, because the deployed function is a single bundled file with no `.sql` files beside it — a folder scan would find nothing and silently pass again. A test fails if the list and the folder disagree. Two existing tests that asserted the defective contract were corrected, not deleted.

**Left undone and it matters:** the app shell now stops saying "LIVE" for a behind database but falls into the existing "NO DB" branch, which is the wrong label. And nothing still runs migrations on deploy.

---

#### M19 · No monitoring, alerting or runbook exists anywhere
**`netlify.toml:7`** · Operational Readiness · **FIXED (partly) — `20fb221`, tidy-up `25f9c32`**

**What is wrong.** No CI directory. No error-reporting or metrics dependency — the project lists exactly two dependencies. The deployment guide had no rollback, incident or on-call section. The single observability surface is the health endpoint, which `src/http/health.mjs:8-14` says deliberately always answers 200 so it will not trip uptime monitors — meaning a standard monitor pointed at it can never detect a database outage.

**Failure scenario.** Postgres stops answering at 2am. The check stays green. Nobody is told. It is found when a person opens the CRM in the morning.

**Fix.** The default always-200 behaviour is untouched, because the app's status chip depends on it. A new opt-in address returns the same information but answers with a genuine failure status whenever the deployment cannot be trusted — database unreachable, unconfigured, erroring, or behind on migrations. That is a URL an off-the-shelf uptime checker can finally go red on. `docs/RUNBOOK.md` is the human half: what each health state means, how to tell "the site is down" from "the database is down" from "the schema is behind", the command to apply missing migrations, how to roll back on Netlify, and a plainly worded list of what nobody is watching. A test parses the monitored URL out of the runbook and asks the real code whether that flag still works, so renaming it turns the test red instead of the monitor silently going green through an outage.

**Left undone, and this is the important part:** nothing is actually watching the site yet. Somebody has to point an uptime service at the strict health URL and route the alert to a phone. There is still no error reporting, no metrics, no CI and no on-call rota.

---

#### M20 · Both new screens are registered but nothing links to them, and neither has a way out
**`public/app/shell.js:24`** · UI/UX · **FIXED — `dec51cc`, corrected in `3a09841`**

**What is wrong.** Both screens were added to the allowed list, so the session chip said 25 tabs while the sidebar rendered 23 rows and no screen linked to either. Neither `finance-os.html` nor `banking-surface.html` contained a single link element — no sidebar, no logo, no back link. The only way in was typing the address by hand; the only way out was the browser's Back button. The comment at `shell.js:35-37` still claimed the list was "every screen the sidebar links to".

**Failure scenario.** The W9 and W10 deliverables are invisible to every user.

**Fix.** Both screens now appear in the Work group of the shared sidebar on every screen that carries one. The first attempt used a back control with no address, which does nothing when a page is opened from a pasted or bookmarked link; that was corrected to a real link. Access gating is unchanged — the Banking Surface row stays hidden for anyone below owner/admin, matching the endpoint gate from M9. Test `src/http/app-nav-reachability.test.mjs` reads the shell's own lists out of the source and fails if a future screen is added with no way in; it failed all four checks before the fix, including "the chip says 24 tabs but the sidebar leaves a staff role 23 rows".

---

#### M21 · The recurring-bills listing has no page size and no index it can use
**`src/banking/store.mjs:238`** · Performance · **FIXED — page size `f6bfb46`, index `ae7f1bc`/`6fa3f11` (content in `ffd0461`)**

**What is wrong.** Company is the only always-present filter and none of the table's indexes lead with it — the account, client and confidence filters are optional and null by default, and two of the existing indexes are partial on conditions the default read does not carry. So the database read the whole table and sorted it in memory. There was also no page size, and the result is one row per account × merchant × cadence across every client.

**Failure scenario.** 3,000 clients at 12 bills each is 36,000 rows read, sorted and serialised in one response inside a 10-second function budget.

**Fix.** A page size (default 500, capped at 2,000) and new migration `093_recurring_bills_org_index.sql` adding an index on company followed by the read's own sort order, so a limited read can walk the index instead of sorting the table. Not partial, deliberately. A test parses the sort order out of the code and the indexes out of the migration files, so schema and query cannot drift apart in silence; both cases failed before the fix.

**Note:** migration 093 has not been executed against a real database.

### MINOR

Eighteen minor findings. Five were fixed on this branch; the rest are recorded and open.

| ID | Title | File:line | Status |
|---|---|---|---|
| m1 | Eleven foreign-key columns on the new tables have no index, so a parent delete scans the whole child table. Confirmed by query plan on the live database. Free while tables are empty; appears the first time a real client's history is deleted, holding row locks while it runs. | `db/migrations/084_card_liability_history.sql:55` (+10 more) | NOT FIXED |
| m2 | A soft-pull's plan link is not enforced, on a stated reason that is false on this branch — the subscriptions table is created two files earlier. A pull billed to a mistyped plan id is accepted silently and vanishes from any cost-by-plan roll-up. | `db/migrations/077_soft_pull_requests.sql:145` | NOT FIXED |
| m3 | The subscription tier is free text, trimmed but never case-normalised, so "Starter" and "starter" become two plans in every count with no error. | `db/migrations/075_subscriptions.sql:110`, `src/subscriptions/store.mjs:143` | NOT FIXED |
| m4 | Alert rules read interest rates without normalising units, then turn the result into a dollar figure. A rate arriving as 24.99 rather than 0.2499 turns a $960 claimed annual saving into $96,000. The helper that resolves exactly this lives next door and is not imported. Ties to compliance item K9. | `src/alerts/evaluate.mjs:162` | FIXED — `4162523` |
| m5 | Banking Surface adds amounts in different currencies together. Migration 081 forbids this explicitly. The endpoint selects the currency and the module never references it, and the mixed total reports itself as complete, so a reader cannot tell. | `src/finance/banking-surface.mjs:144` | NOT FIXED |
| m6 | Saving a detection makes three database round trips per bill inside one open transaction — 120 sequential trips for 40 merchants, holding row locks throughout. The inner helper is carefully batched for precisely this reason; the loop around it reintroduces the pattern one level up. | `src/banking/store.mjs:195` | NOT FIXED |
| m7 | `?key=` means the dashboard secret in one file and the pipeline name in another, so the documented shared-secret route to the pipeline board is unreachable. Masked today because the browser sends a header instead. | `src/http/dashboard-auth.mjs:27`, `api/dashboard/pipeline.mjs:60` | FIXED as a side effect of M2 — `bc184aa` |
| m8 | Reading a partner's brand settings has no role check, so any staff row — including a rival white-label partner — can read another partner's colours, name and selected funnels, and use the not-found response to discover which partner ids exist. The write path is correctly gated; only the read was open. | `api/partner-brand.mjs:96` | FIXED — `441c98f` |
| m9 | The rollback test uses a fake database handle with a capability the real one lacks, so it exercises a path production never runs. The file's own header warns against exactly this. **This is why M7 survived review and merge.** | `src/banking/store.test.mjs:264` | NOT FIXED |
| m10 | A card-history row can be left permanently unlinked to the position it feeds. There are three writes, not two, and the third is a plain update; if it fails the link stays empty forever, nothing reconciles it, and one statement's worth of a client's card history silently drops out of any joined view. | `src/liabilities/store.mjs:95` | FIXED — `3a09841` |
| m11 | The concurrency branch in a tier change is never executed by any test and throws the wrong error type, so a future endpoint turns it into a server error rather than "someone else just changed this". Lowest branch coverage of any W1–W10 module at 67.57%. | `src/subscriptions/store.mjs:259` | FIXED — `ffd0461` |
| m12 | Nothing schedules the sweep that closes forgotten shifts. It is fully tested and has no caller outside tests. A person who forgets to clock out is blocked from clocking in the next day until someone fixes the row by hand. Affects pay, so it is an owner decision. | `src/shifts/store.mjs:287` | NOT FIXED |
| m13 | Thirteen modules across W2/W4/W5/W6/W7/W8 have zero production callers. Not one of the fifty-odd endpoint handlers imports any banking, liabilities, subscriptions or alerts module. Not a runtime failure, a reporting one. | `src/banking/store.mjs:1` | PARTIALLY ADDRESSED (M13's store) |
| m14 | Four documented empty seams, all honest — each returns a named refusal rather than a plausible-looking answer. Listed for completeness; no action. | `src/banking/plaid.mjs:272` (+3) | NO ACTION NEEDED |
| m15 | Exactly two to-do notes exist in the whole codebase, both cosmetic, both about two consent controls belonging on another screen. No to-do anywhere in W1–W10 code. | `public/app/ops-admin.html:432`, `public/crm.html:8974` | NOT FIXED |
| m16 | A value that is both unknown and incomplete renders as the literal string "—+". The plus means "there is more than this", which is meaningless attached to "we have no number at all" and reads as a rendering glitch. | `public/app/finance-os.html:41`, `banking-surface.html:42` | FIXED — `f7f57ae` |
| m17 | A server crash is reported to the user as a database outage. Everything other than five named statuses falls into the "database did not answer" branch, so whoever is called spends the outage checking Supabase instead of the function logs. | `public/app/data.js:83` | FIXED — `f7f57ae` |
| m18 | The confidence floor that decides whether a detected bill is safe to show has no consumer, because no endpoint and no screen renders cash flow or recurring bills at all. None of migrations 085–089's output reaches a person. | `src/banking/cashflow-seam.mjs:271` | NOT FIXED |

---

## 5. Compliance Flags — legal review only, no code fix requested

These are not bugs to fix. Each needs a human with legal authority to make a decision. Several of the fixes above are additionally marked COMPLIANCE REVIEW REQUIRED in their commit messages and must not merge to production without the same review.

**K1 · The record of who viewed a client's Social Security number is not protected the way the docs say** — `src/pii/index.mjs:200`. The module promises the access log is written in the same all-or-nothing unit as the reveal, so a failed log aborts the disclosure. It is not — it is the same broken check as M7, so the two run as independent writes. The safe direction survives by luck of statement order. What breaks is the reverse: if the decrypt fails afterwards (rotated or wrong key), the log permanently records that a named employee viewed a consumer's SSN on a request where no SSN was returned. The audit trail over-reports disclosure and cannot be reconciled. A working version of the fix exists at `src/finance/soft-pulls.mjs:484-489`; that author deliberately left this path alone saying it deserved its own review, and nobody picked it up. Flagged independently by three audit tracks. **Needs human sign-off before the fix ships — it is a behavioural change on a disclosure-recording path.**

**K2 · A credit pull is authorised by a typed sentence, not by any consent record** — `db/migrations/077_soft_pull_requests.sql:138`. Authorisation is free text with a not-blank rule. No consent id, no document reference, no signature, no client acceptance time. A soft-pull consent document type already exists (`src/documents/kinds.mjs:23`, described in `db/migrations/030_documents.sql:75` as "the C-00 soft-pull consent gate") and neither the module nor the endpoint references it. No code path checks it before a pull is filed. **Open question: is a typed reason sufficient authorisation, or must an unexpired consent document be present and checked?**

**K3 · FCRA rules are not documented near the credit-pull code, and the directory `CLAUDE.md` points at does not exist** — `src/finance/soft-pulls.mjs:1`. `docs/compliance/` does not exist. Searching the whole tree for "FCRA" and "permissible purpose" returns zero hits in migration 077, the soft-pulls module and the soft-pull endpoint. The unresolved question — permissible purpose differs for a client checking their own file versus an employee checking it — sits in a workflow narrative nobody is instructed to read. **Action: create `docs/compliance/` with the permissible-purpose rule, or amend `CLAUDE.md` §7 to point at where the rules actually live.**

**K4 · Storing real bank credentials is one environment variable away, before any of four sign-offs** — `db/migrations/080_plaid_items.sql:1`. The encrypted token column holds long-lived permission to read a real person's bank account. The engineering controls are genuinely good: AES-256-GCM, key from environment only, never logged or returned, stripped from responses, feature disabled outright when the key is absent. Four things are open: SOC 2 review of credential storage (key management, rotation, database access, retention, revocation), consent wording and capture flow, the retention and deletion answer, and whether Plaid is the chosen provider under which agreement. The author deliberately broke this repository's own auto-set-environment-variable rule and left the three Plaid variables unset. **`CLAUDE.md` §11 needs an explicit carve-out naming those three, so nobody sets them by following the standing instruction.** There is also no revocation or deletion path — no delete of a bank login exists anywhere.

**K5 · There is no data retention or deletion policy, and the public privacy page promises one** — `src/documents/README.md:155`. Searching for retention, purge or deletion logic finds only test cleanup, never production code. No expiry on raw credit-report payloads, no expiry on the PII access log, no expiry on the soft-pull ledger, no deletion path for bank logins. `public/privacy/index.html:102` tells the public that data is "deleted or de-identified" when no longer needed; no code does that. **Needs a written retention schedule per data class before it needs code.**

**K6 · Deleting a client leaves their bank transactions behind, unreachable and undeletable** — `db/migrations/085_bank_transactions.sql:187`. Reproduced on a live database. Transaction rows are deliberately kept when a client is deleted, but the accounts are cascaded away and the account link was not enforced (M17). So merchant-level spending history for a deleted person survives with no route back to the person and no route to the account. A later erasure or subject-access request cannot locate it. **This retention outcome was produced by a cascade-ordering accident, not by policy, and needs the §7 sign-off — it is a retention decision, not a schema tidy-up.**

**K7 · The hiring tool keeps the audit data but has never notified a candidate, and no bias audit exists** — `src/hiring/pipeline.mjs:122`. The posture is unusually careful: deterministic grader, no AI model, no clock, protected characteristics filtered out before scoring, cannot reject anyone, rubric version stored so a bias audit is possible, and it tracks how often humans follow the machine. Migrations 051 and 053 name NYC Local Law 144 directly. Two gaps: the scoring notice is served behind a staff role gate, so it reaches the reviewer and not the candidate; and the "candidate notified" field is read by two endpoints and written by nothing. **Open question: is the notice delivered outside this repository (job board, external ATS), and has an independent bias audit been commissioned? If not, both Local Law 144 obligations are unmet for New York City applicants.**

**K8 · The wage-inference policy was merged with its compliance flag still open** — `src/shifts/timesheet.mjs:1`. Commit `c6ae18e`'s own message says so verbatim: "merged with that flag still open". The policy values an unvouchable shift at the median of that person's own completed shifts, capped at the record's last-touched time; someone with no completed shifts gets zero and stays flagged. It cites FLSA 29 CFR 516.2 and *Anderson v. Mt. Clemens Pottery*. Nothing reads the review list, no screen shows it, and no wage rate exists anywhere to multiply the seconds by — those constants were deleted on 2026-07-31. Related to M14 and m12.

**K9 · Two alert rules produce sentences about a person's credit, one with a dollar figure attached** — `docs/workflows/finish-the-build/W4.md`. The score rule names a band; the card rule attaches a money figure. Both become claims about a credit outcome the moment they reach a client-visible screen. Mitigations are real: the code refuses adjectives like "good" or "excellent" and returns band labels only, migration 078's title column carries a not-customer-facing warning, and every rule ships switched off with blank thresholds and zero seeded rows. The saving figure is one year of rate difference on an existing balance, ignoring fees, promotional rates and approval odds — arithmetic, not a promise. Cross-reference m4: an unnormalised interest rate can inflate that figure 100-fold. **Needs human sign-off before any of it is shown to a client.** Note that M13's fix activated the path that composes these sentences into a staff-only queue; nothing transmits and no consumer sees them, but that sign-off gate is not cleared.

**K10 · Cash-flow estimates shown to a consumer — flagged, not reviewed** — `docs/workflows/finance-os-banking.md:354`. The author raised the flag for the W8 projection work and explicitly declined to raise it for the W7 detection work at line 259 of the same file. Nothing renders these estimates yet (m18), so the flag is open and not yet load-bearing.

---

## 6. Fixes Applied

31 `[AUDIT FIX]` commits are on `claude/finance-os-audit-w1-w10-7jkl5x`. The findings each one closes:

| Finding | Commit(s) | Compliance-flagged |
|---|---|---|
| C1 (partial) | `b4e8ddb` | no |
| M1 | `e7e9cf5` | no |
| M2 (and m7) | `bc184aa` | no |
| M3 | `25d51af` | no |
| M4 | `a01bfd7` | **yes** |
| M5 | `2283246` | **yes** |
| M6 | `ac2bd5e` (empty record; content in `010e473`) | **yes** |
| M7 | `4289b27` (code), `42ba6af` (test) | **yes** |
| M8 | `7942271`, `3e83cfd` | partly |
| M9 | `e0ecb11` | **yes** |
| M10 | `7942271`, `0003e5b` | partly |
| M11 | `f6bfb46`, `d023a07` | no |
| M12 | `f6bfb46` | no |
| M13 | `3e40f61` | **yes** |
| M14 | `756fcb9` | no |
| M15 | `04c3453` | **yes** |
| M16 | `010e473` (code), `b61ca33` (test + follow-ons) | **yes** |
| M17 | `74a92ea` | **yes** |
| M18 | `584a7d7` | no |
| M19 | `20fb221`, `25f9c32` | no |
| M20 | `dec51cc`, `3a09841` | no |
| M21 | `f6bfb46` (page size), `ae7f1bc` / `6fa3f11` (index record; content in `ffd0461`) | no |
| m4 | `4162523` | **yes** |
| m8 | `441c98f` | no |
| m10 | `3a09841` | no |
| m11 | `ffd0461` | no |
| m16, m17 | `f7f57ae` | no |

**Two commits are empty by necessity.** Several workflows shared one working copy. Twice, a sibling workflow staged the entire tree while another agent's fix was mid-flight, sweeping those files into its own commit. `ac2bd5e` (M6) and `ae7f1bc` (M21) are empty commits carrying the correct message and evidence; the code is in `010e473` and `ffd0461`. History was not rewritten because that would have destroyed other agents' work. **Process note for next time: stage specific paths, never the whole tree, in a shared checkout.**

**Five minor fixes (`4162523`, `441c98f`, `3a09841`, `ffd0461`, `f7f57ae`) are recorded in the branch log but no structured verification record was supplied to this report.** Their commit messages describe the change and the test; this report does not independently restate their test counts.

---

## 7. Open Decisions

These need a person, not an agent.

**1. Push target: main versus feature branch — resolved by pushing to the feature branch.** The instruction to publish this work conflicted with this repository's branch policy in `CLAUDE.md` (deploys come from `main`, and agents branch first rather than committing to it). The conflict was resolved by pushing every audit commit and this report to `claude/finance-os-audit-w1-w10-7jkl5x` and **not** to `main`. Nothing here has been merged, and nothing has been deployed. A human decides when and whether this branch merges — and given the compliance flags below, that decision should not be automatic.

**2. The `/workspace/fundhub-docs` spec comparison was skipped.** The "does the code match the written spec" domain was not assessed. No finding in this report is based on a spec comparison, and the scorecard records that domain as NOT ASSESSED rather than as a pass. If the spec matters to sign-off, that check still has to be run.

**3. Fee timing on cancellation (M16).** Cancelling now ends the subscription at the instant the client asks, when no end date is given. That is a statement about what period the client is covered for and it implies an answer to the refund question for a mid-period cancellation. The module's own documentation describes a cancellation that runs to the end of a paid period, which the new default does not match. The alternative is a one-line change once someone decides. **This is a business decision.**

**4. What a revoked bank connection destroys (M17, K6).** With the link enforced, a client withdrawing consent now also removes that account's transaction ledger and detected bills. Deleting a *client* still preserves the evidence that money moved. If the ledger must outlive a revoked connection, the referential action should change — the link should not be dropped.

**5. Whether the Banking Surface role gate is right (M9).** The endpoint's own author argued for every staff role; the audit narrowed it to owner/admin. One word changes it back.

**6. Whether Local Law 144 obligations are met outside this repository (K7).** Is the candidate notice delivered by a job board or external ATS, and has an independent bias audit been commissioned?

**7. Whether alerts should reach a screen at all (M13, K9).** The storage layer exists; no route and no screen were built, deliberately. That is a product decision gated on the wording sign-off.

**8. Nobody is watching the site (M19).** The strict health URL and the runbook exist. An actual uptime monitor pointed at it, routed to a phone, does not. That is a five-minute human action, and until it happens the finding is only half closed.

**9. Correct `CLAUDE.md` §12.** The documented trap blames the 24-vs-29 failure shape on five order-dependent `inquiries` suites. Across 8 full runs, zero `inquiries` tests failed. The real cause is the sessions/staff race in `conversations-read` and `campaign-endpoints`.

---

## 8. Production Readiness

### Verdict: **NOT READY**

Three independent reasons, any one of which is enough.

**One. Migrations 090, 092 and 093 exist in the repository and have not been applied to any real database.** Migration 091 has been applied only to a local scratch database. The deploy does not run migrations — the build command is an `echo` — and there is no CI to run them. Deploying this branch as it stands gives you code that expects tables and indexes the production database does not have.

**Two. Ten endpoints from C1 still have no company boundary.** The critical finding is partially fixed. It is latent for exactly as long as the database holds one company. This branch cannot be the version that onboards a second company or a white-label partner.

**Three. Nine compliance items are open, and eight of the applied fixes carry COMPLIANCE REVIEW REQUIRED.** Credit-pull authorisation, bank-credential storage, data retention, SSN disclosure logging, hiring notices and credit claims all sit with an unanswered legal question. This repository's own §7 says flagged changes ship only after explicit human approval. None has been given.

### Shortest path to READY

**Same day, mechanical:**

1. Apply migrations 090 through 093 to production, in order, with `db/migrate.mjs`. Confirm the health check reports "up" and not "behind" afterwards.
2. Point an uptime monitor at the strict health URL and route the alert to a phone. Steps are in `docs/RUNBOOK.md` §9.
3. Fix the app shell label so a behind database says "DB BEHIND" and not "NO DB".
4. Correct `CLAUDE.md` §12 with the real cause of the cold-run failures, and add the §11 carve-out naming the three Plaid variables so nobody sets them by following the standing instruction.

**Before any second company or white-label partner exists — this is the gate:**

5. Close the remaining ten C1 endpoints. Each builds its own query; each needs the caller's company bound in. The pattern is already set by `b4e8ddb`, `25d51af` and `04c3453`.
6. Close `api/dashboard/pipeline.mjs` and `api/dashboard/seed.mjs` (M1's leftovers) and `api/read/partners.mjs` (M3's leftover).
7. Add a test that fails when any read handler ships without a company filter, so this class of bug cannot come back one endpoint at a time.

**Before anything reaches a consumer:**

8. Get human legal decisions on K2 (consent for a credit pull), K5 (retention schedule), K9 (credit claims), K10 (cash-flow estimates), and the M16 fee-timing question. Nothing else unblocks these.
9. Decide K1 and ship the transaction fix on the SSN disclosure log.

**Before bank connections are switched on:**

10. Complete the four K4 sign-offs — SOC 2 on credential storage, consent wording and capture, retention and deletion, and the provider agreement — and build a revocation and deletion path, which does not exist today.

Until step 5 is done, this is **CONDITIONAL** for continued single-company internal use with the migrations applied. It is **NOT READY** for anything else.

---

## 9. Final Numbers

| | |
|---|---|
| Branch | `claude/finance-os-audit-w1-w10-7jkl5x` |
| Commit at report time (`git rev-parse HEAD`) | `6fa3f1103421476f154268bf4e1feb3d62644a6f` |
| Baseline compared against | `4830465` |
| `origin/main` at audit time | `d6a5f94` |
| Report generated | 2026-07-31 18:38 UTC |
| Pushed to `main` | **No — feature branch only** |

**Findings by severity**

| Severity | Found | Fixed on this branch | Open |
|---|---|---|---|
| Critical | 1 | 1 (partial — 10 endpoints remain) | 1 partial |
| Major | 21 | 21 | 0 (several with named leftovers) |
| Minor | 18 | 5 | 13 |
| Compliance (legal review) | 10 | n/a — no code fix requested | 10 |
| **Total** | **50** | **27** | — |

**Fixes applied:** 31 `[AUDIT FIX]` commits covering 27 findings. 2 of those commits are empty records whose content landed in a sibling workflow's commit (`010e473`, `ffd0461`).

**Tests**

| Measurement | Result |
|---|---|
| Baseline `4830465`, real Postgres, 4 runs | 24 deterministic failures (24, 24, 25, 24) |
| `origin/main` `d6a5f94`, real Postgres, 4 runs | 24 deterministic failures (40, 24, 25, 24) |
| Deterministic sets compared by name | 24 shared, 0 baseline-only, 0 main-only |
| Test count, baseline → main | 2,342 → 3,037 (+695 passing) |
| Test suites, baseline → main | 83 → 128 |
| Suite after audit fixes, `DATABASE_URL` unset | 2,404 passing, 0 failing, 356 skipped |
| Suite after audit fixes, real Postgres | 24 failures, same pre-existing set, diffed by name with changes stashed and unstashed |

The 356 skipped tests are the documented trap: with `DATABASE_URL` unset, every `.pg.test.mjs` file skips and the suite reports zero failures. That is expected behaviour, not a green result.

**New failures versus baseline `4830465`, by exact test name**

> **None.** Zero test names fail on this work that did not already fail on `4830465`.

**Pre-existing deterministic failures, present identically on both trees (24)** — these are the baseline, not regressions:

1. `src/compliance/invariants.pg.test.mjs :: module invariants > THE LEAK TEST: an unscoped session reads zero rows from every module table`
2. `src/compliance/invariants.pg.test.mjs :: module invariants > THE LEAK TEST: partner B reads zero rows of partner A's data`
3. `src/creative/generate.pg.test.mjs :: creative generation > a partner cannot write a job owned by another partner`
4. `src/creative/generate.pg.test.mjs :: creative generation > an unscoped read returns nothing rather than everything`
5. `src/creative/generate.pg.test.mjs :: creative generation > partner B cannot see partner A's generation jobs`
6. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > action-log — returns nothing for a partner who owns none of it`
7. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > action-log?state=revertible — returns nothing for a partner who owns none of it`
8. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > approvals — returns nothing for a partner who owns none of it`
9. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > approvals?state=blocked — returns nothing for a partner who owns none of it`
10. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > brand-kits — returns nothing for a partner who owns none of it`
11. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > brand-kits?state — returns nothing for a partner who owns none of it`
12. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > campaign detail runs and is scoped`
13. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > campaign list — returns nothing for a partner who owns none of it`
14. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > campaign list?platform — returns nothing for a partner who owns none of it`
15. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > connections — returns nothing for a partner who owns none of it`
16. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > fatigue — returns nothing for a partner who owns none of it`
17. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > fatigue?state=refresh — returns nothing for a partner who owns none of it`
18. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > jobs — returns nothing for a partner who owns none of it`
19. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > jobs?state — returns nothing for a partner who owns none of it`
20. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > library — returns nothing for a partner who owns none of it`
21. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > library?kind+format — returns nothing for a partner who owns none of it`
22. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > library?state=blocked — returns nothing for a partner who owns none of it`
23. `src/http/creative-endpoints.pg.test.mjs :: creative read endpoints > spend — returns nothing for a partner who owns none of it`
24. `src/social/social.pg.test.mjs :: social, onboarding and metering > usage events are partner-isolated`

Worth noticing: 24 of 24 pre-existing failures are **partner-isolation tests**. They were already failing before this work, and they are the same class of problem as C1. That is not a coincidence and it should inform how urgently step 5 above is taken.

**Known flaky tests (not regressions)**

- `src/hiring/hiring.pg.test.mjs :: hiring pipeline > scores cannot be deleted — they are the audit trail` — failed 1 run in 4 on **both** trees.
- `src/http/campaign-endpoints.pg.test.mjs` and `src/http/conversations-read.pg.test.mjs` — failed on 1 of 4 main runs each, both from one cause: `insert or update on table "sessions" violates foreign key constraint "sessions_staff_id_fkey"`. Both files are byte-identical between the two trees.

**Test environment left running for follow-up work**

Postgres 16 on `127.0.0.1:5432`. `fundhub_main` (66 migrations, 6 staff) at `postgres://postgres:postgres@127.0.0.1:5432/fundhub_main`, worktree at `/tmp/audit-main-tree`. `fundhub_baseline` and `/tmp/audit-baseline-tree` also still up. **The container's Postgres does not survive a container restart** — if a later session finds the connection refused, run `pg_ctlcluster 16 main start` (there is no `systemd` in this container, so `systemctl` will not work).

---

*End of report.*
