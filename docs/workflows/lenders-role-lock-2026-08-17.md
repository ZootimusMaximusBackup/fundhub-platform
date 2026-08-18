# Lenders role lock — 2026-08-17

Batch board. Agents coordinate through this file. Read it before you start.
Write your manifest here before you report complete.

## What Chris asked for

> The Lenders list should only be visible to the funding advisor and the owner.
> Nobody else should see or touch it. Restrict at the server, not just by hiding
> the nav item.

## Role decision — READ THIS BEFORE WRITING CODE

**Allowed:** `owner`, `admin`, `funding_advisor`
**Blocked:** `closer`, `sales_manager`, `inquiry_specialist`, `setter`, and every
principal role (client, affiliate, partner).

Two judgement calls are baked in here. Both are recorded so nobody re-derives them,
and both are Chris's to reverse — not an agent's.

1. **`admin` stays in, alongside `owner`.** Every other set in `ROLE_SETS`
   (`FINANCE`, `OPS`, `HIRING`) pairs owner and admin. Chris was told this
   assumption was being made and did not object. To cut admin, remove it from the
   set in `src/http/read-api.mjs` — one word.

2. **`read/lender-matches` is OUT OF SCOPE and stays on `ROLE_SETS.STAFF`.**
   That endpoint is a different feature — the "which lenders fit this client" box
   on `closer-dashboard.html` and `client-control-panel.html`. It is not the
   Lenders list and Chris did not name it. Locking it would silently break a
   closer's daily screen, which is not an agent's call to make
   (`.cursor/rules/owner-scope-minimal-diff.mdc`). Chris was told this and can flip
   it: it is one line in `api/read/lender-matches.mjs`.
   **Do not lock it. Do not "while I was in there" it.**

## Starting state (measured, 2026-08-17)

All five lender endpoints gate on `ROLE_SETS.STAFF` = owner, admin,
funding_advisor, closer, inquiry_specialist, setter, sales_manager. A closer can
read the entire lender database today with one request and no screen.

`public/app/shell.js` carries `lenders.html` in `ALL`, so it renders in every
staff sidebar.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | Server lock — narrow role set on 4 endpoints + tests | agent-w1 | done |
| W2 | Screen + nav gate in shell.js | agent-w2 | done |
| W3 | Live proof, 4 roles, on fundhub.ai | — | blocked (needs W1+W2 deployed) |
| W4 | Journeys `-actual.md` + changelog | agent-w4 | pending |

## Scope fences — do not cross

- **W1 owns** `src/http/read-api.mjs` and `api/**lender*`. Nobody else edits those.
- **W2 owns** `public/app/shell.js` and the nav tests. Nobody else edits those.
- **W4 owns** `docs/journeys/*-actual.md` + `CHANGELOG.md`. Never edits an
  `-intended.md`.
- Nobody touches `api/read/lender-matches.mjs`. See decision 2 above.

## Change manifests

_(agents append below)_

### W1 — server lock on the lender database (done, 2026-08-17)

**Files touched (5 changed, 1 added)**

| File | What changed |
|---|---|
| `src/http/read-api.mjs` | Added ONE new set: `LENDERS: new Set(["owner","admin","funding_advisor"])`, commented in the same style as FINANCE / OPS / HIRING. `STAFF` untouched. |
| `api/read/lenders.mjs` | `requireRole(... ROLE_SETS.STAFF)` → `ROLE_SETS.LENDERS`. Also corrected the stale header comment that said "funding advisors and closers both need the list". |
| `api/lenders.mjs` | `requireRole(... ROLE_SETS.STAFF)` → `ROLE_SETS.LENDERS`. |
| `api/read/lender-observations.mjs` | `requireRole(... ROLE_SETS.STAFF)` → `ROLE_SETS.LENDERS`. |
| `api/lender-observations.mjs` | `requireRole(... ROLE_SETS.STAFF)` → `ROLE_SETS.LENDERS`. |
| `src/http/lenders-role-gate.test.mjs` | NEW. 9 tests. Lives in `src/http/` because `npm test`'s glob is `src/**` + `scripts/**` only (CLAUDE.md §12). |

Only the `requireRole` argument changed in the four handlers. `requireAuth`, the
`org_id` / `isUuid` check and every other line are exactly as they were.
No routes added, no exports added, no props changed, no dependencies.

**The role set is now**

* `/api/read/lenders` (GET), `/api/lenders` (POST), `/api/read/lender-observations` (GET),
  `/api/lender-observations` (POST) → **`ROLE_SETS.LENDERS` = owner, admin, funding_advisor.**
* `closer`, `sales_manager`, `inquiry_specialist`, `setter` now get **403 forbidden**
  with no rows in the body.
* `/api/read/lender-matches` → **UNCHANGED, still `ROLE_SETS.STAFF`.** Not touched.
  Board decision 2. A test now pins it open so nobody narrows it by accident.

**Test results (measured 2026-08-17, this machine, `DATABASE_URL` unset)**

| Command | Result |
|---|---|
| `npm run lint` | PASS — `lint: 1296 file(s) and inline script(s) parse clean` |
| `npx tsc --noEmit` | exit 1 — **there is no `tsconfig.json` in this repo**, so tsc prints its help text and exits 1 no matter what the diff is. Pre-existing, not caused by this change. See "Found but not fixed". |
| `node --test src/http/lenders-role-gate.test.mjs` | **9 tests, 9 pass, 0 fail** |
| `node --test src/http/routes.test.mjs src/http/auth-gate.test.mjs` | 18 tests, 17 pass, 1 fail — the failure is `company-brain/threads` and `company-brain/upload` being unrouted, another workflow's in-flight handlers. All four lender handlers are still routed. |
| `node --test` on every lender-touching test file | **195 tests, 195 pass, 0 fail** (`lenders-role-gate`, `read-endpoints-org-scope`\*, `closer-ui-honest`, `auth-gate`, `read-api`, `dashboard-role-gate`, `company-brain/access`+`affiliate`+`store`, `lenders/match`, `lenders/lenders`, `proxy-endpoints`, `app-nav-reachability`, `proxy/launch`, `adapters/lendflow`) — \*minus the one pre-existing `company-brain-affiliate.mjs` failure below. |
| `npm test` (full) | 5641 tests, 5625 pass, **13 fail**, 3 skipped. **None of the 13 are lender-related.** The count moved during the session (4 fails earlier, 13 later) because several workflows are writing this working tree at the same time. 442 `.pg.test.mjs` tests skip with `DATABASE_URL` unset — so this is a partial result, not full green. |

**Checked, as instructed**

* `src/http/read-endpoints-org-scope.test.mjs` — its lender entries are about SQL
  org-scoping, not roles. Unaffected. Its one failure names
  `company-brain-affiliate.mjs`, not a lender endpoint, and it failed before this
  change too.
* `src/http/closer-ui-honest.test.mjs` — 4 tests, 4 pass. Its only lender line
  asserts the closer dashboard calls `lender-matches`, which is deliberately still
  open. Nothing to fix, and no assertion anywhere encodes "a closer can read the
  Lenders list" as intended behaviour.

**Found but deliberately NOT fixed**

1. **W4: the journeys are stale because of this change, and W4 owns fixing them.**
   `scripts/journeys/generate.test.mjs` → "the journeys are not stale" fails. I
   regenerated into a scratch folder to see exactly what moved: **113 changed
   lines, and every one of them traces to this lock** — 65 lines are the four
   lender routes' role lists, and the rest are the per-role route counts that
   shift as a result (e.g. closer "Blocked — 51 routes" → 53). `npm run journeys`
   fixes it. I did not run it: `docs/journeys/**` is W4's scope fence.
2. **`npx tsc --noEmit` cannot pass in this repo.** There is no `tsconfig.json`,
   so tsc has no inputs, prints its help and exits 1. There is exactly one
   TypeScript file (`src/lib/rbac.ts`) and nothing type-checks it. CLAUDE.md §6
   lists this command as a gate, so the gate is currently a no-op that always
   reports failure. Not fixed — adding a tsconfig is a new config Chris did not
   ask for.
3. **Pre-existing failures, unrelated to lenders, left alone:**
   `gifts/message-blaster: a gate is referenced but its shape was not recognised`
   (journeys extraction); `the expected list is exactly what db/ holds` (three new
   untracked `db/migrations/174-176` files from another workflow); `an endpoint
   excused from the org filter still passes the session's org to its store`
   (`company-brain-affiliate.mjs`); `routes: every handler file under api/ is
   routed` (`company-brain/threads`, `company-brain/upload`); plus company-brain
   and contracts screen tests. All belong to other in-flight workflows.

**Incident — my mistake, worth reading**

To measure a baseline I ran `git stash push -u`, forgetting this working tree is
shared by every workflow in flight. That briefly reverted other workflows' files
too. I restored my five files from `stash@{0}` and verified every other stashed
file against the tree afterwards: `my-numbers.html`, `my-numbers.js`,
`company-brain/retrieve.mjs` and `sales/metrics.mjs` came back byte-identical, and
`company-brain/review.mjs` in the tree is now AHEAD of the stashed copy. Two files
— `public/app/sales-floor.html` (3 lines) and `public/app/sales-floor.js`
(9 lines) — differ from the stashed copy in ways I could not safely reconcile
without overwriting a live agent's file, so I left them alone. **`stash@{0}` has
NOT been dropped; it is the recovery record.** Whoever owns sales-floor should
diff against it before committing:
`git diff 'stash@{0}' -- public/app/sales-floor.js public/app/sales-floor.html`.
Nobody should run `git stash` in this tree while a batch is running.

**Not committed.** All changes left in the working tree for the orchestrator.

### W2 — nav gate: the row moved with the gate (done, 2026-08-17)

**Files touched — 3 changed, 0 added, 0 deleted**

| File | What changed |
|---|---|
| `public/app/shell.js` | Added ONE new list, `var ADVISOR_ONLY = ["lenders.html"];`, in the same shape and comment style as `FINANCE_ONLY` / `CLOSER_DESK_ONLY` / `SALES_FLOOR_ONLY` / `HIRING_ONLY`. Excluded it in `staffTabs()`. Changed `ROLE_TABS.funding_advisor` from `"staff"` to `"funding_advisor"` and added one `allowedFor()` branch, exactly the mechanism `closer` and `sales_manager` already use. Rewrote the `lenders.html` comment in `ALL` — it said `ROLE_SETS.STAFF`, which W1 has now made false. |
| `src/http/app-nav-reachability.test.mjs` | Lifts `ADVISOR_ONLY` from the shell like it already lifts the other six lists; subtracts it from `STAFF_TABS`; pins `ADVISOR_ONLY` in the fixture-honesty test; one new case for the advisor; `lenders.html` added to the closer and sales-manager negative assertions. |
| `e2e/sidebar-roles.spec.mjs` | Advisor and owner now expect the Lenders row; closer, sales_manager and setter now expect it absent. Two test names updated to say so. |

**Nothing else was touched.** No renames, no reformatting, no new dependency, no
route, no config. `api/**`, `src/http/read-api.mjs` (W1) and `docs/journeys/**`
(W4) were not opened for writing.

**How the gate resolves per role** — measured, not assumed. I evaluated the real
`allowedFor()` / `homeFor()` out of `shell.js` rather than re-implementing them:

| Role | Sees Lenders? | Screens | How it resolves | Home |
|---|---|---|---|---|
| `owner` | **YES** | 33 (all) | `"*"` → `ALL.slice()` — **unchanged, not special-cased** | command-center |
| `admin` | **YES** | 33 (all) | `"*"` → `ALL.slice()` — **unchanged, not special-cased** | command-center |
| `funding_advisor` | **YES** | 11 | `staffTabs()` (10) + `ADVISOR_ONLY` (1) | client-control-panel |
| `closer` | no | 12 | `staffTabs()` + `CLOSER_DESK_ONLY` | closer-dashboard |
| `sales_manager` | no | 13 | `staffTabs()` + `SALES_FLOOR_ONLY` + `FINANCE_ONLY` | sales-floor |
| `setter` | no | 10 | `staffTabs()` | pipeline |
| `inquiry_specialist` | no | 10 | `staffTabs()` | inquiry-remover |
| `client` / `affiliate` / `partner` | no | 1 / 1 / 4 | explicit arrays | own portal |
| unknown role (typo) | no | 10 | falls back to `staffTabs()` | closer-dashboard |

`staffTabs()` no longer contains `lenders.html`. That one fact is what removes the
row from all four blocked staff roles at once.

**Typing `/app/lenders.html` straight into the address bar — CONFIRMED WORKING,
NOT REBUILT.** `shell.js` already handles this in two places and I changed
neither: `routeAway()` on the cached-role pass, and the `ok.indexOf(PAGE) === -1`
branch on the session pass, both calling `location.replace(homeUrl(role, ok))`.
`lenders.html` loads `shell.js`, so the bounce fires. Every blocked role's home is
a screen that is really in its own list, so nobody lands on a blank page or a
403 shell. **Proved in a real browser**: closer → `closer-dashboard.html`,
sales_manager → `sales-floor.html`, setter → `pipeline.html`. All three passed.

**The ~34 screen HTML files were NOT edited, and must not be.** Every screen
carries `<a class="navitem" href="lenders.html">` inline. That is the design, not
a duplication bug: `mountSidebar()` replaces the whole inline `<aside>` with
`SIDEBAR_HTML` on load, then `gateLinks()` hides the rows the role may not open.
`src/http/app-nav-matches-shell.test.mjs` actively **requires** every inline
sidebar to carry the same rows in the same order as `SIDEBAR_HTML` — deleting the
Lenders row from those files would turn that test red on all 34. One list in
`shell.js` is the whole change.

**Test results — measured 2026-08-17, this machine, `DATABASE_URL` unset**

| Command | Result |
|---|---|
| `npm run lint` | **PASS** — `lint: 1296 file(s) and inline script(s) parse clean` |
| `npx tsc --noEmit` | exit 1 — no `tsconfig.json` exists, so tsc prints help and exits 1 on any diff. Pre-existing; W1 recorded the same thing. |
| `node --test src/http/app-nav-matches-shell.test.mjs src/http/app-nav-reachability.test.mjs` | **77 tests, 77 pass, 0 fail, 0 skipped** |
| `npx playwright test` (my own gate assertions) | **8 of 8 pass** — 5 nav-visibility roles + 3 address-bar redirects |
| `npm test` (full) | 5641 tests, 5625 pass, **13 fail**, 3 skipped |

**About that 13.** My baseline before touching anything was **4 fail**. I
confirmed none of the extra nine are mine — they are other workflows writing this
same tree while I worked, and the set kept changing between runs (`routes: every
handler file under api/ is routed` failed in one run and passed in the next once
somebody routed the company-brain handlers). The named failures are the two
journeys ones (W4's, and W1's change is what made them stale), `contracts.html`
markup, `company-brain.html`, the `db/` migration manifest, and the org-filter
one. **None touch the nav or the shell.** The three files I changed are read by
the nav tests only, which are 77/77 green.

**No test was weakened, skipped or deleted.** Nothing in the suite encoded
"every staff role sees Lenders" as intended behaviour, so there was no such
finding to report. What did exist was a **mirror that would have gone quietly
wrong**: `app-nav-reachability.test.mjs` rebuilds `staffTabs()` by lifting the
shell's lists by name. Adding `ADVISOR_ONLY` to the shell without adding it there
would have left the test's `STAFF_TABS` still holding `lenders.html`, so
`CLOSER_TABS` and `SALES_MANAGER_TABS` would have gone on asserting a closer sees
the Lenders row — and it would still have passed, because it compares its own
copy against itself. Updating the mirror is what keeps it honest.

**Found but deliberately NOT fixed**

1. **`e2e/sidebar-roles.spec.mjs` is stale about `command-center.html`, and its
   local `OWNER_ADMIN_ONLY` is two entries where `shell.js` now has twelve.** The
   advisor test asserts a funding advisor SEES `command-center.html`, but
   `shell.js` put that screen in `OWNER_ADMIN_ONLY` (owner decision 2026-08-17,
   beta screens to the owner's rail). Those two disagree today. I did not touch
   it — it is a different owner decision's leftover, not the lenders lock.
2. **The whole `e2e/sidebar-roles.spec.mjs` file currently cannot run.** All 7
   tests die with `ReferenceError: FHData is not defined` on
   `/app/pipeline.html`, thrown before any nav assertion is reached. **I verified
   this is not mine**: I reverted `shell.js` to `HEAD`, re-ran, got the identical
   failure, and restored my file. `pipeline.html` loads `proxy-apply.js`
   without `defer` at line 981 while `data.js` — which defines `FHData` — is
   deferred at line 980, so the non-deferred script runs first. Another
   workflow's in-flight edit. Not fixed: `pipeline.html` is not mine and this is
   not the lenders lock.
3. **`src/lib/rbac.ts` is a second, contradictory role map** and it also lists
   `app/lenders.html`. It uses an entirely different role vocabulary
   (`admin|staff|partner|affiliate|client` — no `funding_advisor` at all) and is
   imported by nothing but `scripts/build-artifact.mjs`. It is the only
   TypeScript file in the repo and nothing type-checks it. It did not need
   changing for this lock, but two role maps that disagree is the kind of thing
   that surfaces months later. Written down, not fixed.
4. **`npx tsc --noEmit` is a gate that cannot pass** (CLAUDE.md §6 lists it).
   Same finding W1 recorded. Adding a `tsconfig.json` is new config nobody asked
   for.

**Not committed.** All changes left in the working tree for the orchestrator.

## Blockers and open questions

- **Open (Chris):** lock `read/lender-matches` too, or leave closers their match
  box? Proceeding with "leave it" — the literal reading of what he named.
