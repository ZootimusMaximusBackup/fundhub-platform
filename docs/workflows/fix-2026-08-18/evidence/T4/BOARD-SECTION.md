# T4 — Inquiry desk & dispute letters · manifest (wave 2)

Branch `fix/T4-inquiry-repair` · worktree `/tmp/wt-T4` off `origin/main` @ `c860b8c`
Evidence: `docs/workflows/fix-2026-08-18/evidence/T4/` (read `README.md` first, then `STATUS.md`)

**COMPLIANCE REVIEW REQUIRED** — this thread touches dispute letters and credit-repair
behaviour. No customer-facing claim about credit outcomes was written or changed.

## What actually shipped

**The Specialist desk was dead on arrival and now loads.** One cause, six symptoms.
`data.js` is loaded with `defer`, so the helper it defines does not exist yet while the
block below it is being read. That block checked for the helper, did not find it, and
quietly quit — so the work queue kept "Loading inquiry queue…" forever, the four tiles
kept their dashes, and the bureau chips kept a hardcoded 0. Fixed by waiting for the page
to finish loading, the same way `client-control-panel.html` and `messaging.html` already do.

**Send worked again.** The button reached for a toolbox called `VIEW` that the page never
creates — it is called `FHInquiryView`. Two more places reached for the same missing name
behind a guard, which is why every case row showed a raw status and a dash for Call.

**Clearing an inquiry stopped half-working.** Two separate write-path bugs, each of which
committed a change to the database and then reported failure to the user.

## Files touched — all inside T4's owned list

`public/app/inquiry-remover.html` · `api/inquiry-cases.mjs` · `src/inquiries/work.mjs` ·
`src/inquiries/work.pg.test.mjs` · `src/http/inquiry-cases.pg.test.mjs` (new)

One file outside the list, deliberately, see below: `src/http/calendar-paint.test.mjs`.

**Menu rows needed from T0: none.** No new screen, tab, page or row was added.

## The one file I touched that I do not own

`src/http/calendar-paint.test.mjs` — T7 built a registry of screens still carrying the
deferred-script bug, and its own failure message is an instruction to the fixing thread:
*"inquiry-remover.html (T4) is fixed — delete its line from KNOWN_UNFIXED in this file."*
Leaving it would have left the suite red. I deleted that one line and moved the screen onto
the must-stay-clean list so the bug cannot come back. This is T7's designed hand-off, not a
reach across — but it is a file edit outside my list and it is flagged here on purpose.

Useful side effect: T7's scanner is an **independent** confirmation that the boot fix is real.

## Requests for other threads — I could not fix these, they are not my files

| # | File (owner) | Problem | Why it matters |
|---|---|---|---|
| 1 | `src/register-all.mjs` (**shared/T16**) | `registerRepairHandlers()` is never called from here — only from the background-jobs module. | A repair event raised while someone is using the site reaches **no listener at all**. It does not error and does not warn; it silently does nothing. Any repair fix that relies on events is invisible on the website half of the system. |
| 2 | `src/workflows/c-06-crs-results-router.mjs` (**T6 / workflows**) | The "this client is repair-only" branch applies a tag and stops. Nothing ever announces that a repair client exists. | This is **why the Repair desk is empty**. Across the whole live database, **zero** clients have a repair card. The desk is telling the truth. One line in that branch fixes it. |
| 3 | `src/demo/simulate-client.mjs` (**demo/seed owner**) | It stores a client's credit file as one flat list with no per-bureau breakdown. The letter engine reads per-bureau and finds nothing. | This is **T4-01**. The reader is correct for real credit pulls; the simulator writes a shape production never produces. Fixing the reader instead would make the letter engine accept data it should refuse. |
| 4 | `src/metro2/inbound/handler.mjs` (**metro2 inbound owner**) | `handleInboundResponse` has no caller anywhere in the codebase except its own test. | This is **T4-16**. The database lock people blamed is already gone (see corrections). What is missing is that nothing ever calls the function. |
| 5 | `src/metro2/diy/deliver.mjs` (**metro2 diy owner**) | Never passes the "client authorised disputes" flag, so the check that reads it can never fire. | This is **T4-09's** live half. The consent is captured correctly and one signature already exists — nothing reads it back. |

## Corrections to the audit record — please do not re-file these

Checked read-only against the **live production database** as the app's own unprivileged
role on 2026-08-19. Raw output: `evidence/T4/before/live-db.json`.

- **The six credit-dispute tables are NOT locked.** The audit recorded them as switched-on
  with no key, so the app could read nothing. `db/migrations/200_dispute_rls_policies.sql`
  fixed that and **it is applied on live** — it is in the applied-migrations list. All six
  now carry a policy, and `repair_decision_log` returns 2 real rows. Nothing to do.
- **A dispute authorization HAS been signed.** The audit recorded 0 ever. There is **1**.
- **`inquiry.removed` HAS fired.** The audit recorded the count as 0 across the whole
  system. It is **1**. Two of the three ways to fire it were broken; both are fixed here.
- **"There is no table to store letters" is wrong as written.** `dispute_letters` exists and
  always has. It has no *writer* — the three functions that can fill it are called by nothing.
- **The stuck-files block is hidden by empty data, not by role.** The Specialist role passes
  the permission check cleanly. An in-code comment on that screen claims the opposite and
  will send the next reader down the wrong path.

## Blockers no code change fixes

- **Pressing Send on a real inquiry case mails a real credit bureau.** T4-06 asked for that
  button to be proven from the Specialist's own login. It was not pressed, and it should not
  be pressed casually — this is a live consumer-finance action. The crash that stopped it is
  fixed and proven in a browser; the live press is Chris's call.
- **`INQUIRY_API_BASE` is not set.** Phone inquiry is deliberately on hold, so the Call and
  Hold columns stay blank by design. **Not a bug — do not "fix" it.**
- **The funding-round hop is not in the written journey.** Finishing an inquiry is supposed to
  start the next funding round. `docs/journeys/role-inquiry-remover-intended.md` does not
  describe that step at all, so T4 did not build it. On live, the "Start next funding round"
  to-do exists and `funding_rounds` for that client is still **0**. Needs an owner decision
  about what should happen, then T2's money chain to do it.
